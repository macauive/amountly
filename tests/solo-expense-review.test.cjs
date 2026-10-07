const test = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const loadApp = require('./load-app.cjs')

const owner = 'synthetic-owner'
const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const originalVersion = '2026-10-07T12:00:00Z'
const nextVersion = '2026-10-07T12:01:00Z'
const expense = (patch = {}) => ({ id: firstId, user_id: owner, merchant: 'Synthetic stationery',
  description: 'Synthetic purchase', amount: 12.50, currency: 'USD', category: 'OFFICE_SUPPLIES',
  expense_date: '2026-10-06T00:00:00Z', status: 'DRAFT', reviewed_at: null, archived_at: null,
  receipt_path: `${owner}/synthetic.png`, created_at: originalVersion, updated_at: originalVersion, ...patch })
class RecordSaveError extends Error { constructor(message, outcome) { super(message); this.outcome = outcome } }

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

async function host(page, initial, options = {}) {
  const slots = [], effects = [], calls = [], edits = [], reads = [], messages = []
  const auth = { user: { id: owner, account_type: 'freelancer', role: 'MEMBER', organization_id: null, is_active: true, ...options.user } }
  let rows = initial, index = 0, tree, key
  const overrides = {
    react: {
      ...React,
      useState(initialValue) {
        const slot = index++
        if (!(slot in slots)) slots[slot] = typeof initialValue === 'function' ? initialValue() : initialValue
        return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value }]
      },
      useRef(initialValue) { const slot = index++; return slots[slot] ??= { current: initialValue } },
      useCallback(callback, deps) {
        const slot = index++, previous = slots[slot]
        if (!previous || deps.some((value, i) => value !== previous.deps[i])) slots[slot] = { callback, deps }
        return slots[slot].callback
      },
      useEffect(effect, deps) {
        const slot = index++, previous = slots[slot]
        if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => {
          previous?.cleanup?.()
          slots[slot] = { effect: true, deps, setup: effect, cleanup: effect() }
        })
      },
    },
    '@/contexts/AuthContext': { useAuth: () => auth },
    'next/navigation': { useRouter: () => ({ replace: () => {} }), useSearchParams: () => new URLSearchParams() },
    'next/link': 'Link',
    '@/hooks/useDisplayDate': { useDisplayDate: () => value => value.slice(0, 10) },
    '@/hooks/useCreateAttempt': { useCreateAttempt: () => ({ unknown: !!options.unknown, message: null, reset: () => !options.unknown }) },
    '@/services/expenses.service': {
      getExpenses: async () => { const id = auth.user.id; reads.push(id); return options.load ? options.load(id) : rows },
      getReceiptUrl: async () => '/synthetic-local-receipt',
      updateExpense: async (...args) => { edits.push(args); rows = rows.map(row => row.id === args[0] ? { ...row, ...args[1], reviewed_at: null, updated_at: nextVersion } : row) },
      createExpense: () => assert.fail('Review must not create financial records'),
      archiveExpense: () => assert.fail('Review must not archive financial records'),
      uploadReceipt: () => assert.fail('Review must not replace the original receipt'),
    },
    '@/services/review.service': { RecordSaveError,
      setExpenseReview: async (...args) => {
        calls.push(args)
        if (options.review) return options.review(...args)
        rows = rows.map(row => row.id === args[0] ? { ...row, reviewed_at: args[1] ? nextVersion : null, updated_at: nextVersion } : row)
      },
      reviewWorkRecord: async (...args) => { calls.push(args) },
    },
    '@/services/projects.service': { getProjects: async () => [] },
    '@/services/time-entries.service': { getTimeEntries: async () => [] },
    '@/services/accounts-payable.service': { getVendorBills: async () => [] },
    '@/services/bills.service': { getBills: async () => [] },
    '@/services/invoices.service': { getLegacyPaidInvoices: async () => [] },
    '@/lib/expense-ai': new Proxy({}, { get: () => () => assert.fail('Review must not call AI') }),
    '@/components/TimeBillingDialog': { isTimeReserved: () => false },
    '@/components/RecordHistoryDialog': { RecordHistoryDialog: 'RecordHistoryDialog' },
    '@/components/SaveAttemptNotice': { SaveAttemptNotice: 'SaveAttemptNotice' },
    sonner: { toast: { error: message => messages.push(message), success: message => messages.push(message) } },
  }
  for (const [module, names] of Object.entries({
    card: ['Card', 'CardContent', 'CardHeader', 'CardTitle'], button: ['Button'], badge: ['Badge'],
    input: ['Input'], label: ['Label'], textarea: ['Textarea'],
    select: ['Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue'],
    dialog: ['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'],
    'alert-dialog': ['AlertDialog', 'AlertDialogContent', 'AlertDialogHeader', 'AlertDialogTitle', 'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogCancel', 'AlertDialogAction'],
    table: ['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow'],
  })) overrides[`@/components/ui/${module}`] = Object.fromEntries(names.map(name => [name, name]))
  const Page = loadApp(overrides)(`src/app/(dashboard)/${page}/page.tsx`).default
  function render() {
    index = 0
    tree = Page()
    if (key !== tree.key) {
      for (const slot of slots) if (slot?.effect) slot.cleanup?.()
      slots.length = 0; effects.length = 0; key = tree.key
    }
    while (typeof tree?.type === 'function') tree = tree.type(tree.props)
    while (effects.length) effects.shift()()
    return tree
  }
  const find = predicate => { const result = nodes(tree, predicate)[0]; assert.ok(result, 'control exists'); return result.props }
  const button = label => find(node => node.type === 'Button' && text(node) === label)
  const flush = async () => { await new Promise(setImmediate); render(); render() }
  render()
  if (options.strictReplay) {
    for (const slot of slots) if (slot?.effect) slot.cleanup?.()
    for (const slot of slots) if (slot?.effect) slot.cleanup = slot.setup()
  }
  await flush()
  return { render, flush, find, button, calls, edits, reads, messages, text: () => text(tree),
    buttons: label => nodes(tree, node => node.type === 'Button' && text(node) === label),
    links: () => nodes(tree, node => node.type === 'Link').map(node => node.props.href),
    field: id => find(node => node.props.id === id),
    async switchUser(id) { auth.user = { ...auth.user, id }; rows = []; render(); await flush() },
    dispose() { for (const slot of slots) if (slot?.effect) slot.cleanup?.() },
  }
}

test('solo inbox keeps reviewed drafts visible with exact record links and separate review counts', async () => {
  const view = await host('review', [expense(), expense({ id: secondId, reviewed_at: nextVersion }), expense({ id: 'foreign', user_id: 'foreign' })], { strictReplay: true })
  assert.match(view.text(), /Needs review \(1\)/)
  assert.match(view.text(), /Reviewed \(1\)/)
  assert.doesNotMatch(view.text(), /different owner|administrator|Submitted for review/)
  assert.equal(view.buttons('Mark reviewed').length, 1)
  assert.equal(view.buttons('Clear review').length, 1)
  assert.equal(view.buttons('Receipt').length, 2)
  assert.ok(view.links().includes(`/expenses?expense=${secondId}`))
  assert.equal(view.links().includes('/expenses?expense=foreign'), false)
  assert.deepEqual(view.calls, [], 'loading and viewing must not record a review')
  view.dispose()
})

test('solo review commands require explicit confirmation and carry the current record version', async () => {
  const view = await host('review', [expense()])
  view.button('Mark reviewed').onClick(); view.render()
  assert.deepEqual(view.calls, [])
  assert.match(view.text(), /Mark expense reviewed\?/)
  await view.button('Confirm mark reviewed').onClick(); await view.flush()
  assert.deepEqual(view.calls, [[firstId, true, originalVersion]])
  assert.match(view.text(), /Needs review \(0\)/)
  assert.match(view.text(), /Reviewed \(1\)/)
  assert.match(view.text(), /draft/, 'review does not imply approval')
  view.button('Clear review').onClick(); view.render()
  await view.button('Confirm clear review').onClick(); await view.flush()
  assert.deepEqual(view.calls[1], [firstId, false, nextVersion])
  assert.match(view.text(), /Needs review \(1\)/)
  view.dispose()
})

test('review rejects duplicate clicks and ignores completion after an account switch', async () => {
  let resolve
  const pending = new Promise(done => { resolve = done })
  const view = await host('review', [expense()], { review: () => pending })
  view.button('Mark reviewed').onClick(); view.render()
  const confirm = view.button('Confirm mark reviewed').onClick
  const request = confirm(); await confirm()
  assert.equal(view.calls.length, 1)
  await view.switchUser('synthetic-next-owner')
  resolve(); await request; await view.flush()
  assert.deepEqual(view.reads, [owner, 'synthetic-next-owner'])
  assert.deepEqual(view.messages, [])
  assert.equal(view.find(node => node.type === 'Dialog').open, false)
  assert.match(view.text(), /Needs review \(0\)/)
  view.dispose()
})

test('late inbox loads cannot restore records from the previous account', async () => {
  let resolve
  const pending = new Promise(done => { resolve = done })
  const view = await host('review', [], { load: id => id === owner ? pending : [] })
  await view.switchUser('synthetic-next-owner')
  resolve([expense()]); await view.flush()
  assert.match(view.text(), /Needs review \(0\)/)
  assert.doesNotMatch(view.text(), /Synthetic purchase/)
  view.dispose()
})

test('business submission and different-owner approval remain separate from solo review', async () => {
  const view = await host('review', [expense(), expense({ id: secondId, user_id: 'foreign', status: 'SUBMITTED' })], { user: { account_type: 'business', role: 'OWNER', organization_id: 'synthetic-workspace' } })
  assert.match(view.text(), /Approvals require a different owner or administrator/)
  assert.equal(view.buttons('Mark reviewed').length, 0)
  assert.equal(view.buttons('Clear review').length, 0)
  view.button('Approve').onClick(); view.render()
  await view.button('Confirm').onClick(); await view.flush()
  assert.deepEqual(view.calls, [['expenses', secondId, 'approve', originalVersion]])
  view.dispose()
})

test('expense list and editor expose explicit review while unsaved changes block the command', async () => {
  const view = await host('expenses', [expense()])
  assert.match(view.text(), /Needs review/)
  view.find(node => node.props['aria-label'] === 'Edit expense').onClick(); view.render()
  assert.equal(view.button('Open saved receipt').disabled, undefined)
  view.field('amount').onChange({ target: { value: '99.00' } }); view.render()
  assert.equal(view.button('Mark reviewed').disabled, true)
  view.button('Mark reviewed').onClick(); view.render()
  assert.deepEqual(view.calls, [])
  assert.match(view.text(), /Save your changes before reviewing/)
  view.field('amount').onChange({ target: { value: '12.50' } }); view.render()
  view.button('Mark reviewed').onClick(); view.render()
  await view.button('Confirm mark reviewed').onClick(); await view.flush()
  assert.deepEqual(view.calls, [[firstId, true, originalVersion]])
  assert.equal(view.find(node => node.type === 'Dialog').open, false)
  assert.match(view.text(), /Reviewed/)
  assert.deepEqual(view.edits, [])
  view.dispose()
})

test('expense review failures close stale editors and reload before another attempt', async () => {
  const view = await host('expenses', [expense()], { review: async () => { throw new Error('private-provider-detail') } })
  view.find(node => node.props['aria-label'] === 'Edit expense').onClick(); view.render()
  view.button('Mark reviewed').onClick(); view.render()
  await view.button('Confirm mark reviewed').onClick(); await view.flush()
  assert.equal(view.find(node => node.type === 'Dialog').open, false)
  assert.equal(view.reads.length, 2)
  assert.match(view.messages[0], /Could not confirm the review/)
  assert.doesNotMatch(view.messages.join(''), /private-provider-detail/)
  assert.equal(view.calls.length, 1)
  view.dispose()
})

test('cancelling unsaved edits restores list review controls and account switches ignore late review completion', async () => {
  let resolve
  const pending = new Promise(done => { resolve = done })
  const view = await host('expenses', [expense()], { review: () => pending })
  view.find(node => node.props['aria-label'] === 'Edit expense').onClick(); view.render()
  view.field('amount').onChange({ target: { value: '99.00' } }); view.render()
  assert.equal(view.button('Mark reviewed').disabled, true)
  view.find(node => node.type === 'Dialog').onOpenChange(false); view.render()
  assert.equal(view.button('Mark reviewed').disabled, false)
  view.button('Mark reviewed').onClick(); view.render()
  const request = view.button('Confirm mark reviewed').onClick()
  await view.switchUser('synthetic-next-owner')
  resolve(); await request; await view.flush()
  assert.deepEqual(view.reads, [owner, 'synthetic-next-owner'])
  assert.deepEqual(view.messages, [])
  assert.equal(view.calls.length, 1)
  assert.equal(view.find(node => node.type === 'Dialog').open, false)
  view.dispose()
})

test('an uncertain create blocks expense review and non-solo accounts receive no review controls', async () => {
  const unknown = await host('expenses', [expense()], { unknown: true })
  assert.equal(unknown.button('Mark reviewed').disabled, true)
  unknown.button('Mark reviewed').onClick()
  assert.deepEqual(unknown.calls, [])
  unknown.dispose()
  for (const account_type of ['personal', 'business']) {
    const view = await host('expenses', [expense()], { user: { account_type } })
    assert.equal(view.buttons('Mark reviewed').length, 0)
    assert.equal(view.buttons('Clear review').length, 0)
    view.dispose()
  }
})

test('review filters narrow authorized records independently from financial status', () => {
  const { filterExpenseList } = loadApp()('src/lib/expense-navigation.ts')
  const rows = [expense(), expense({ id: secondId, reviewed_at: nextVersion }), expense({ id: 'final', status: 'APPROVED' })]
  const filters = { query: '', start: '', end: '', category: 'all', status: 'DRAFT' }
  assert.deepEqual(filterExpenseList(rows, { ...filters, review: 'reviewed' }).map(row => row.id), [secondId])
  assert.deepEqual(filterExpenseList(rows, { ...filters, status: 'all', review: 'needs-review' }).map(row => row.id), [firstId])
  assert.equal(filterExpenseList(rows, { ...filters, review: 'approve' }).length, 0)
  assert.equal(rows[1].status, 'DRAFT')
})
