const test = require('node:test')
const assert = require('node:assert/strict')
const loadApp = require('./load-app.cjs')

const receipt = {
  document_type: 'receipt', amount: '12.48', currency: 'USD', merchant: 'Synthetic Cafe',
  description: 'Synthetic lunch', expense_date: '2026-10-07', category: 'meals',
  confidence: 'high', reason: 'Total and currency are printed.', summary: 'Review the extracted details.',
}
// Use the repository enum rather than assuming provider category spellings.
receipt.category = loadApp()('src/types/enums.ts').ExpenseCategory.other
const file = () => new File(['synthetic receipt'], 'private-name.png', { type: 'image/png' })

test('receipt proposals clear missing amount/date and unsupported currency; other documents do not become expenses', () => {
  const { receiptExpenseFields } = loadApp()('src/lib/receipt-review.ts')
  const fields = receiptExpenseFields({ ...receipt, amount: '', currency: 'OTHER', expense_date: '' })
  assert.equal(fields.amount, '')
  assert.equal(fields.currency, '')
  assert.equal(fields.expense_date, '')
  for (const document_type of ['invoice', 'statement', 'other']) assert.equal(receiptExpenseFields({ ...receipt, document_type }), null)
})

test('duplicate warnings match merchant/date/amount/currency and exclude the edited record', () => {
  const { findPossibleReceiptDuplicate } = loadApp()('src/lib/receipt-review.ts')
  const candidate = { ...receipt, merchant: '  SYNTHETIC   CAFE! ' }
  const existing = [{ id: 'existing', amount: 12.48, currency: 'USD', merchant: 'Synthetic Cafe', expense_date: '2026-10-07T00:00:00Z' }]
  assert.equal(findPossibleReceiptDuplicate(candidate, existing)?.id, 'existing')
  assert.equal(findPossibleReceiptDuplicate(candidate, existing, 'existing'), undefined)
  for (const patch of [{ currency: 'EUR' }, { amount: '12.49' }, { expense_date: '2026-10-06' }, { merchant: '' }, { amount: '' }]) {
    assert.equal(findPossibleReceiptDuplicate({ ...candidate, ...patch }, existing), undefined)
  }
})

test('expense totals preserve separate currency amounts', () => {
  const { expenseTotalsByCurrency } = loadApp()('src/lib/receipt-review.ts')
  const totals = expenseTotalsByCurrency([{ amount: 10, currency: 'USD' }, { amount: 7, currency: 'EUR' }, { amount: 2.48, currency: 'USD' }])
  assert.equal(totals.length, 2)
  assert.equal(totals.find(total => total.currency === 'USD').amount, 12.48)
  assert.equal(totals.find(total => total.currency === 'EUR').amount, 7)
})

test('receipt review requires valid explicit monetary and calendar fields', () => {
  const { receiptDraftIsComplete } = loadApp()('src/lib/receipt-review.ts')
  assert.equal(receiptDraftIsComplete(receipt), true)
  for (const patch of [{ amount: '' }, { amount: '0' }, { amount: '1e2' }, { amount: '12.481' }, { currency: '' }, { expense_date: '' }, { expense_date: '2026-02-30' }]) {
    assert.equal(receiptDraftIsComplete({ ...receipt, ...patch }), false)
  }
})

test('file client sends bytes without filename, supports cookie sessions, and validates the response', async () => {
  const originalFetch = global.fetch
  let captured, result = receipt
  global.fetch = async (url, options) => { captured = { url, ...options }; return Response.json({ result }) }
  try {
    const { captureReceiptFromFile } = loadApp({ '@/lib/supabase': { getSupabaseClient: () => ({ auth: {
      getSession: async () => ({ data: { session: { user: { id: 'synthetic' }, access_token: '' } }, error: null }),
    } }) } })('src/lib/expense-ai.ts')
    const selected = file()
    assert.equal((await captureReceiptFromFile(selected)).amount, '12.48')
    assert.equal(captured.url, '/api/ai/receipt')
    assert.equal(captured.body, selected)
    assert.equal(captured.credentials, 'same-origin')
    assert.deepEqual(Object.keys(captured.headers), ['Content-Type'])
    assert.equal(JSON.stringify(captured.headers).includes(selected.name), false)
    result = { ...receipt, amount: '12.48 USD' }
    await assert.rejects(captureReceiptFromFile(selected), /validate/)
    await assert.rejects(captureReceiptFromFile(new File(['x'], 'bad.html', { type: 'text/html' })), /JPEG/)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(captureReceiptFromFile(selected, controller.signal), { name: 'AbortError' })
  } finally { global.fetch = originalFetch }
})

// A small hook host renders the actual page and exercises its event handlers.
// Database/network calls are replaced; no credentials, live AI, or customer data.
async function expenseForm(capture, initialExpenses = []) {
  const slots = [], effects = [], uploads = [], saved = [], errors = []
  let index = 0
  const overrides = {
    react: {
      useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
      useRef(initial) { const i = index++; return slots[i] ??= { current: initial } },
      useEffect(effect, deps) {
        const i = index++, previous = slots[i]
        if (!previous || deps.some((value, j) => value !== previous.deps[j])) effects.push(() => {
          previous?.cleanup?.(); slots[i] = { effect: true, deps, cleanup: effect() }
        })
      },
    },
    '@/contexts/AuthContext': { useAuth: () => ({ user: { id: 'synthetic-owner' } }) },
    '@/hooks/useDisplayDate': { useDisplayDate: () => value => value.slice(0, 10) },
    '@/hooks/useCreateAttempt': { useCreateAttempt: () => ({ reset: () => true, unknown: false, message: null, run: (input, save) => save(input, 'synthetic-request') }) },
    '@/services/expenses.service': {
      getExpenses: async () => initialExpenses, getReceiptUrl: async () => '', archiveExpense: async () => {}, updateExpense: async () => {},
      uploadReceipt: async selected => { uploads.push(selected); return 'synthetic-owner/receipt.png' },
      createExpense: async input => { saved.push(input); return input },
    },
    '@/services/projects.service': { getProjects: async () => [] },
    '@/lib/expense-ai': { captureReceiptFromFile: capture, captureExpenseFromText: async () => receipt, captureReceiptDocumentFromText: async () => receipt },
    '@/components/SaveAttemptNotice': { SaveAttemptNotice: 'SaveAttemptNotice' },
    '@/components/RecordHistoryDialog': { RecordHistoryDialog: 'RecordHistoryDialog' },
    sonner: { toast: { error: message => errors.push(message), success: () => {} } },
  }
  for (const [module, names] of Object.entries({
    card: ['Card', 'CardContent', 'CardHeader', 'CardTitle'], button: ['Button'], input: ['Input'], label: ['Label'], textarea: ['Textarea'], badge: ['Badge'],
    select: ['Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue'],
    dialog: ['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'],
    'alert-dialog': ['AlertDialog', 'AlertDialogAction', 'AlertDialogCancel', 'AlertDialogContent', 'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogTitle'],
    table: ['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow'],
  })) overrides[`@/components/ui/${module}`] = Object.fromEntries(names.map(name => [name, name]))
  const Page = loadApp(overrides)('src/app/(dashboard)/expenses/page.tsx').default
  let tree
  const render = () => { index = 0; tree = Page(); while (effects.length) effects.shift()(); return tree }
  function nodes(value, predicate) {
    if (Array.isArray(value)) return value.flatMap(child => nodes(child, predicate))
    if (!value || typeof value !== 'object' || !value.props) return []
    return [...(predicate(value) ? [value] : []), ...nodes(value.props.children, predicate)]
  }
  function text(value) {
    if (Array.isArray(value)) return value.map(text).join('')
    return value?.props ? text(value.props.children) : typeof value === 'string' ? value : ''
  }
  const find = predicate => { const result = nodes(tree, predicate)[0]; assert.ok(result, 'control exists'); return result.props }
  const button = label => find(node => node.type === 'Button' && text(node) === label)
  const field = id => find(node => node.props.id === id)
  render(); await new Promise(setImmediate); render()
  button('Add Expense').onClick(); render()
  const host = { render, button, field, find, uploads, saved, errors,
    selectFile(selected = file()) { field('receipt_file').onChange({ target: { files: [selected] } }); render() },
    currency: () => find(node => node.type === 'Select' && node.props.name === 'expense_currency'),
    submit: () => find(node => node.type === 'form').onSubmit({ preventDefault() {} }),
    close: () => { find(node => node.type === 'Dialog').onOpenChange(false); render() },
    dispose: () => { for (const slot of slots) if (slot?.effect) slot.cleanup?.() },
  }
  return host
}

test('receipt read never saves or attaches; confirmation is required and currency is preserved on save', async () => {
  const host = await expenseForm(async () => ({ ...receipt, currency: 'EUR' }))
  try {
    host.selectFile()
    await host.button('Extract selected receipt').onClick(); host.render()
    assert.equal(host.currency().value, 'EUR')
    assert.equal(host.uploads.length, 0)
    await host.submit(); host.render()
    assert.equal(host.saved.length, 0)
    host.field('receipt_reviewed').onChange({ target: { checked: true } }); host.render()
    await host.submit(); host.render()
    assert.equal(host.uploads.length, 1)
    assert.equal(host.saved.length, 1)
    assert.equal(host.saved[0].currency, 'EUR')
    assert.equal(host.saved[0].status, 'DRAFT')
  } finally { host.dispose() }
})

test('unknown receipt values clear form defaults and non-receipts do not prefill', async () => {
  let result = { ...receipt, amount: '', expense_date: '', currency: 'OTHER' }
  const host = await expenseForm(async () => result)
  try {
    host.selectFile(); await host.button('Extract selected receipt').onClick(); host.render()
    assert.equal(host.field('amount').value, '')
    assert.equal(host.field('expense_date').value, '')
    assert.equal(host.currency().value, '')
    result = { ...receipt, document_type: 'statement' }
    host.selectFile(); await host.button('Extract selected receipt').onClick(); host.render()
    assert.equal(host.field('amount').value, '')
    assert.equal(host.currency().value, '')
    await host.submit()
    assert.equal(host.saved.length, 0)
  } finally { host.dispose() }
})

test('late extraction cannot replace newer files, manual input, or a reopened dialog', async () => {
  for (const change of ['file', 'manual', 'dialog']) {
    let resolve, signal
    const host = await expenseForm((selected, currentSignal) => { signal = currentSignal; return new Promise(finish => { resolve = finish }) })
    try {
      host.selectFile(); const pending = host.button('Extract selected receipt').onClick(); host.render()
      assert.equal(host.field('amount').disabled, true)
      if (change === 'file') host.selectFile()
      if (change === 'manual') { host.field('amount').onChange({ target: { value: '99.00' } }); host.render() }
      if (change === 'dialog') { host.close(); host.button('Add Expense').onClick(); host.render() }
      assert.equal(signal.aborted, true)
      resolve(receipt); await pending; host.render()
      assert.equal(host.field('amount').value, change === 'manual' ? '99.00' : '')
      assert.equal(host.field('amount').disabled, false)
      assert.equal(host.uploads.length, 0)
    } finally { host.dispose() }
  }
})

test('replacement, removal, and failed re-extraction preserve AI review requirements and manual edits', async () => {
  let failed = false
  const host = await expenseForm(async () => { if (failed) throw new Error('Synthetic extraction failure'); return receipt })
  try {
    host.selectFile(); await host.button('Extract selected receipt').onClick(); host.render()
    host.field('amount').onChange({ target: { value: '19.99' } }); host.render()
    host.field('receipt_reviewed').onChange({ target: { checked: true } }); host.render()
    host.selectFile()
    assert.equal(host.field('amount').value, '19.99')
    assert.equal(host.field('receipt_reviewed').checked, false)
    await host.submit()
    assert.equal(host.uploads.length, 0)
    failed = true
    await host.button('Extract selected receipt').onClick(); host.render()
    assert.equal(host.field('receipt_reviewed').checked, false)
    assert.equal(host.field('amount').value, '19.99')
    host.button('Remove selected file').onClick(); host.render()
    assert.equal(host.field('receipt_reviewed').checked, false)
    assert.equal(host.field('amount').value, '19.99')
    await host.submit()
    assert.equal(host.saved.length, 0)
  } finally { host.dispose() }
})
