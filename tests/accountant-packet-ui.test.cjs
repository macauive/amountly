const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const loadApp = require('./load-app.cjs')

const packetProps = { year: 2026, month: 4, start: '2026-04-01', end: '2027-03-31', currency: 'USD', basis: 'cash', disabled: false }
const user = { id: 'synthetic-owner', organization_id: null, account_type: 'freelancer', role: 'MEMBER', preferences: { fiscal_year_start: 4 } }
const expense = { id: 'synthetic-expense', user_id: user.id, amount: 12.50, currency: 'USD', expense_date: '2026-10-06', status: 'DRAFT', merchant: 'Synthetic stationery' }
function nodes(value, predicate = () => true) {
  if (Array.isArray(value)) return value.flatMap(child => nodes(child, predicate))
  if (!value?.props) return []
  return [...(predicate(value) ? [value] : []), ...nodes(value.props.children, predicate)]
}
function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.props) return text(value.props.children)
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function hookHost() {
  const slots = [], effects = []
  let index = 0, tree, key, renderRoot
  const hooks = {
    ...React,
    useState(initial) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value }]
    },
    useRef(initial) { const slot = index++; return slots[slot] ??= { current: initial } },
    useEffect(effect, deps) {
      const slot = index++, previous = slots[slot]
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => {
        previous?.cleanup?.()
        slots[slot] = { effect: true, deps, setup: effect, cleanup: effect() }
      })
    },
  }
  const dispose = () => { for (const slot of slots) if (slot?.effect) slot.cleanup?.() }
  function render() {
    index = 0
    tree = renderRoot()
    if (key !== tree?.key) { dispose(); slots.length = 0; effects.length = 0; key = tree?.key }
    while (typeof tree?.type === 'function') tree = tree.type(tree.props)
    while (effects.length) effects.shift()()
    return tree
  }
  const find = predicate => { const node = nodes(tree, predicate)[0]; assert.ok(node, 'control exists'); return node.props }
  return { hooks, render, dispose, find,
    setRoot(callback) { renderRoot = callback },
    button: label => find(node => node.type === 'Button' && text(node) === label),
    field: id => find(node => node.props.id === id),
    text: () => text(tree),
    all: predicate => nodes(tree, predicate),
    async flush() { await new Promise(setImmediate); render(); render() },
    strictReplay() { dispose(); for (const slot of slots) if (slot?.effect) slot.cleanup = slot.setup() },
  }
}
function uiOverrides(hooks) {
  const overrides = { react: hooks }
  for (const [module, names] of Object.entries({
    card: ['Card', 'CardContent', 'CardHeader', 'CardTitle'], button: ['Button'], input: ['Input'], label: ['Label'],
    textarea: ['Textarea'], badge: ['Badge'], tabs: ['Tabs', 'TabsContent', 'TabsList', 'TabsTrigger'],
    select: ['Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue'],
    dialog: ['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle', 'DialogTrigger'],
    'alert-dialog': ['AlertDialog', 'AlertDialogContent', 'AlertDialogHeader', 'AlertDialogTitle', 'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogCancel', 'AlertDialogAction'],
    table: ['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow'],
  })) overrides[`@/components/ui/${module}`] = Object.fromEntries(names.map(name => [name, name]))
  return overrides
}
// Same actual-source loader as load-app, with explicit browser globals for the download boundary.
function loadBrowserComponent(filename, overrides, globals) {
  const module = { exports: {} }, load = loadApp(overrides)
  function localRequire(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name]
    if (name.startsWith('@/')) { const base = path.resolve('src', name.slice(2)); return load(fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`) }
    return require(name)
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, require: localRequire, URLSearchParams, AbortController, Error, ...globals }, { filename })
  return module.exports
}
function packetHost(fetchResponse, props = packetProps) {
  const view = hookHost(), calls = [], downloads = [], objects = [], revoked = [], timers = new Map()
  let timerId = 0
  const BrowserURL = { createObjectURL(blob) { objects.push(blob); return 'blob:synthetic-packet' }, revokeObjectURL(value) { revoked.push(value) } }
  const document = {
    createElement(tag) { assert.equal(tag, 'a'); return { click() { downloads.push({ href: this.href, filename: this.download }) }, remove() {} } },
    body: { appendChild() {} },
  }
  const { AccountantPacketExport } = loadBrowserComponent('src/components/AccountantPacketExport.tsx', uiOverrides(view.hooks), {
    URL: BrowserURL, document,
    fetch: async (url, options) => { calls.push({ url, options }); return fetchResponse(url, options) },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
  })
  view.setRoot(() => AccountantPacketExport(props)); view.render()
  return { ...view, calls, downloads, objects, revoked, timers,
    open() { view.find(node => node.type === 'Dialog').onOpenChange(true); view.render() },
    async click(label) { view.button(label).onClick(); await view.flush() },
    setDate(id, value) { view.field(id).onChange({ target: { value } }); view.render() },
  }
}
function zipResponse(blob = new Blob(['synthetic ZIP bytes'])) { return { ok: true, headers: new Headers({ 'Content-Type': 'application/zip' }), blob: async () => blob } }

test('packet download uses only the chosen range, credentials and basis and revokes its object URL', async () => {
  const view = packetHost(async () => zipResponse()); view.open()
  view.setDate('packet-from', '2026-10-01'); view.setDate('packet-through', '2026-12-31')
  assert.equal(view.field('packet-from').min, packetProps.start)
  assert.equal(view.field('packet-through').max, packetProps.end)
  await view.click('Download ZIP')
  const [call] = view.calls, url = new URL(call.url, 'https://synthetic.invalid')
  assert.equal(url.pathname, '/api/reports/accountant')
  assert.deepEqual(Object.fromEntries(url.searchParams), { year: '2026', month: '4', start: '2026-10-01', end: '2026-12-31', currency: 'USD', basis: 'cash' })
  assert.equal(call.options.credentials, 'same-origin'); assert.equal(call.options.cache, 'no-store')
  assert.equal(call.options.signal.aborted, false)
  assert.deepEqual(view.downloads, [{ href: 'blob:synthetic-packet', filename: 'amountly-accountant-2026-10-01-2026-12-31-USD.zip' }])
  assert.match(view.text(), /Your packet is ready/)
  assert.equal(view.all(node => node.props.role === 'status').length, 1)
  for (const timer of view.timers.values()) if (timer.delay === 1000) timer.callback()
  assert.deepEqual(view.revoked, ['blob:synthetic-packet']); view.dispose()
})

test('invalid, reversed and out-of-period packet ranges never fetch even if the handler is invoked', async () => {
  for (const [from, through] of [['2026-02-30', '2026-10-31'], ['2026-11-01', '2026-10-31'], ['2026-03-31', '2026-10-31'], ['2026-10-01', '2027-04-01']]) {
    const view = packetHost(() => assert.fail('Invalid ranges must not fetch')); view.open()
    view.setDate('packet-from', from); view.setDate('packet-through', through)
    assert.equal(view.button('Download ZIP').disabled, true)
    await view.click('Download ZIP')
    assert.deepEqual(view.calls, []); assert.deepEqual(view.downloads, [])
    assert.match(view.text(), /Choose a valid date range/); view.dispose()
  }
})

test('duplicate packet requests lock immediately and cancellation prevents a late response download', async () => {
  const response = deferred(), view = packetHost(() => response.promise); view.open()
  const click = view.button('Download ZIP').onClick
  click(); click(); view.render()
  assert.equal(view.calls.length, 1)
  assert.equal(view.button('Preparing packet…').disabled, true)
  assert.equal(view.field('packet-from').disabled, true)
  await view.click('Cancel')
  assert.equal(view.calls[0].options.signal.aborted, true)
  response.resolve(zipResponse()); await view.flush()
  assert.deepEqual(view.objects, []); assert.deepEqual(view.downloads, [])
  assert.doesNotMatch(view.text(), /Your packet is ready/); view.dispose()
})

test('packet HTTP and MIME failures show safe errors and never consume or download a ZIP', async () => {
  for (const [status, expected] of [[400, /Could not prepare/], [401, /Sign in again/], [413, /shorter date range/], [429, /Try again shortly/]]) {
    const view = packetHost(async () => ({ ok: false, status, headers: new Headers(), blob: () => assert.fail('Failed responses must not become downloads') })); view.open()
    await view.click('Download ZIP')
    assert.match(view.text(), expected); assert.deepEqual(view.objects, []); assert.deepEqual(view.downloads, []); view.dispose()
  }
  const mime = packetHost(async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'text/html' }), blob: () => assert.fail('Unexpected types must not become downloads') })); mime.open()
  await mime.click('Download ZIP'); assert.match(mime.text(), /Could not prepare/); assert.deepEqual(mime.downloads, []); mime.dispose()
})

test('unexpected network and blob errors never display raw error details', async () => {
  for (const fetchResponse of [async () => { throw new Error('private-network-detail') }, async () => ({ ...zipResponse(), blob: async () => { throw new Error('private-blob-detail') } })]) {
    const view = packetHost(fetchResponse); view.open(); await view.click('Download ZIP')
    assert.match(view.text(), /Could not prepare the packet\. Try again\./)
    assert.doesNotMatch(view.text(), /private-network-detail|private-blob-detail/)
    assert.deepEqual(view.downloads, []); view.dispose()
  }
})

test('unmount aborts pending packet reads and a blob finishing afterwards cannot download', async () => {
  const blob = deferred(), view = packetHost(async () => ({ ...zipResponse(), blob: () => blob.promise })); view.open()
  view.button('Download ZIP').onClick(); await view.flush()
  view.dispose()
  assert.equal(view.calls[0].options.signal.aborted, true)
  blob.resolve(new Blob(['synthetic ZIP'])); await new Promise(setImmediate)
  assert.deepEqual(view.objects, []); assert.deepEqual(view.downloads, [])
})

function periodHost(initialUser = user, canExport = true) {
  const view = hookHost(), auth = { user: initialUser }
  const overrides = { ...uiOverrides(view.hooks),
    '@/contexts/AuthContext': { useAuth: () => auth },
    '@/hooks/useDisplayDate': { useDisplayDate: () => value => value },
    '@/components/AccountantPacketExport': { AccountantPacketExport: 'AccountantPacketExport' },
  }
  const { WorkspacePeriodReport } = loadApp(overrides)('src/components/WorkspacePeriodReport.tsx')
  let props = { invoices: [], expenses: [expense], currency: 'USD', basis: 'cash', canExport }
  view.setRoot(() => WorkspacePeriodReport(props)); view.render()
  return { ...view, setUser(value) { auth.user = value; view.render() }, setProps(value) { props = { ...props, ...value }; view.render() } }
}

test('period report shows accountant packets only for permitted standalone freelancers and binds the selected period', () => {
  const view = periodHost()
  view.field('workspace-start-year').onChange({ target: { value: '2026' } }); view.render()
  let packet = view.all(node => node.type === 'AccountantPacketExport')[0]
  assert.ok(packet); assert.equal(packet.props.disabled, false)
  assert.equal(packet.props.month, 4); assert.equal(packet.props.start, '2026-04-01'); assert.equal(packet.props.end, '2027-03-31')
  view.field('workspace-period').onChange({ target: { value: 'calendar' } }); view.render()
  const calendar = view.all(node => node.type === 'AccountantPacketExport')[0]
  assert.equal(calendar.props.month, 1); assert.equal(calendar.props.start, '2026-01-01'); assert.notEqual(calendar.key, packet.key)
  view.setProps({ currency: 'EUR', basis: 'accrual' })
  packet = view.all(node => node.type === 'AccountantPacketExport')[0]
  assert.equal(packet.props.currency, 'EUR'); assert.equal(packet.props.basis, 'accrual'); assert.equal(packet.props.disabled, true)
  const priorKey = packet.key
  view.setUser({ ...user, id: 'synthetic-next-owner' })
  assert.notEqual(view.all(node => node.type === 'AccountantPacketExport')[0].key, priorKey)
  for (const account of [{ ...user, account_type: 'personal' }, { ...user, account_type: 'business' }, { ...user, organization_id: 'synthetic-org' }, null]) {
    view.setUser(account); assert.equal(view.all(node => node.type === 'AccountantPacketExport').length, 0)
  }
  view.setUser(user); view.setProps({ canExport: false })
  assert.equal(view.all(node => node.type === 'AccountantPacketExport').length, 0); view.dispose()
})

async function taxHost(loadExpenses, options = {}) {
  const view = hookHost(), auth = { user: { ...user } }, reads = [], messages = []
  const overrides = { ...uiOverrides(view.hooks),
    '@/contexts/AuthContext': { useAuth: () => auth }, '@/contexts/AppStateContext': { useAppState: () => ({ hasCapability: () => true }) },
    '@/hooks/useDisplayDate': { useDisplayDate: () => value => value }, 'next/navigation': { useRouter: () => ({ push: () => {} }) },
    '@/components/WorkspacePeriodReport': { WorkspacePeriodReport: 'WorkspacePeriodReport' },
    '@/services/expenses.service': { getExpenses: async () => { reads.push(auth.user.id); return loadExpenses(auth.user) } },
    '@/services/invoices.service': { getInvoices: async () => [] },
    '@/services/tax.service': { getTaxFilings: async () => [] },
    sonner: { toast: { error: message => messages.push(message), success: () => assert.fail('Reads must not mutate') } },
  }
  const Page = loadApp(overrides)('src/app/(dashboard)/tax/page.tsx').default
  view.setRoot(() => Page()); view.render()
  if (options.strictReplay) view.strictReplay()
  await view.flush()
  return { ...view, reads, messages,
    async switchUser(value) { auth.user = value; view.render(); await view.flush() },
  }
}

test('tax account changes clear report records and late old-account loads cannot restore them', async () => {
  const late = deferred()
  const view = await taxHost(current => current.id === user.id ? late.promise : [])
  await view.switchUser({ ...user, id: 'synthetic-next-owner' })
  assert.deepEqual(view.find(node => node.type === 'WorkspacePeriodReport').expenses, [])
  late.resolve([expense]); await view.flush()
  assert.deepEqual(view.find(node => node.type === 'WorkspacePeriodReport').expenses, [])
  assert.deepEqual(view.reads, [user.id, 'synthetic-next-owner']); assert.deepEqual(view.messages, []); view.dispose()
})

test('tax workspace scope changes reset prior data and StrictMode discards earlier loading completion', async () => {
  const first = deferred(), changedScope = deferred(); let requests = 0
  const view = await taxHost(() => {
    requests += 1
    return requests === 1 ? first.promise : requests === 3 ? changedScope.promise : [expense]
  }, { strictReplay: true })
  assert.equal(requests, 2)
  assert.deepEqual(view.find(node => node.type === 'WorkspacePeriodReport').expenses, [expense])
  first.resolve([{ ...expense, id: 'stale-record' }]); await view.flush()
  assert.equal(view.find(node => node.type === 'WorkspacePeriodReport').expenses[0].id, expense.id)
  await view.switchUser({ ...user, organization_id: 'synthetic-next-workspace', account_type: 'business', role: 'OWNER' })
  assert.equal(requests, 3)
  assert.equal(view.all(node => node.type === 'WorkspacePeriodReport').length, 0, 'Old data is hidden while the new scope loads')
  changedScope.resolve([]); await view.flush()
  assert.deepEqual(view.find(node => node.type === 'WorkspacePeriodReport').expenses, [])
  view.dispose()
})

test('tax load errors are safe and failures after unmount do not report to the next account', async () => {
  const view = await taxHost(async () => { throw new Error('private-tax-detail') })
  assert.match(view.text(), /Could not load tax records\. Check your access and try again\./)
  assert.doesNotMatch(view.text(), /private-tax-detail/); assert.equal(view.messages.length, 1); view.dispose()
  const late = deferred(), pending = await taxHost(() => late.promise)
  pending.dispose(); late.reject(new Error('private-late-detail')); await new Promise(setImmediate)
  assert.deepEqual(pending.messages, [])
})
