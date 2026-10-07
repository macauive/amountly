const test = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const loadApp = require('./load-app.cjs')

const expenseId = '11111111-1111-4111-8111-111111111111'
const otherExpenseId = '22222222-2222-4222-8222-222222222222'
const owner = 'synthetic-owner'
const expense = {
  id: expenseId, user_id: owner, merchant: 'Synthetic receipt', description: 'Synthetic expense',
  amount: 12.48, currency: 'USD', status: 'DRAFT', category: 'other',
  expense_date: '2026-10-07', created_at: '2026-10-07T12:00:00Z', updated_at: '2026-10-07T12:00:00Z',
}

function elements(value) {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!value || typeof value !== 'object' || !value.props) return []
  return [value, ...elements(value.props.children)]
}
function text(value) {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value?.props) return text(value.props.children)
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

// Render the actual pages with synthetic already-authorized service results.
// Effects and service calls are disabled; navigation cannot create or change records.
function renderPage(page, accountType, expenses, time = []) {
  let slot = 0
  const review = page === 'review'
  const overrides = {
    react: {
      ...React,
      useState(initial) {
        const index = slot++
        const replacements = review
          ? { 0: [...expenses.map(record => ({ kind: 'expenses', record })), ...time.map(record => ({ kind: 'time_entries', record }))], 4: false }
          : { 1: expenses, 2: { invoices: [], expenses, timeEntries: [], vendorBills: [] } }
        return [Object.hasOwn(replacements, index) ? replacements[index] : initial, () => {}]
      },
      useEffect: () => {}, useCallback: callback => callback, useRef: initial => ({ current: initial }),
    },
    'next/link': 'Link',
    'next/navigation': { useRouter: () => ({ push: () => assert.fail('Rendering must not navigate') }) },
    '@/contexts/AuthContext': { useAuth: () => ({ user: { id: owner, account_type: accountType, name: 'Synthetic owner', role: 'OWNER' } }) },
    '@/contexts/AppStateContext': { useAppState: () => ({ hasCapability: () => true }) },
    '@/lib/dashboard-ai': { getDashboardAiInsights: () => assert.fail('Navigation test must not call AI') },
    '@/components/TimeBillingDialog': { isTimeReserved: () => false },
    '@/components/RecordHistoryDialog': { RecordHistoryDialog: 'RecordHistoryDialog' },
    sonner: { toast: { error: () => {}, success: () => {} } },
  }
  for (const module of ['expenses', 'time-entries', 'accounts-payable', 'bills', 'invoices', 'review']) {
    overrides[`@/services/${module}.service`] = new Proxy({}, {
      get: () => () => assert.fail('Navigation rendering must not read or write services'),
    })
  }
  for (const [module, names] of Object.entries({
    card: ['Card', 'CardContent', 'CardHeader', 'CardTitle'], button: ['Button'], badge: ['Badge'], progress: ['Progress'],
    dialog: ['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'],
  })) overrides[`@/components/ui/${module}`] = Object.fromEntries(names.map(name => [name, name]))
  let tree = loadApp(overrides)(`src/app/(dashboard)/${page}/page.tsx`).default()
  while (typeof tree?.type === 'function') tree = tree.type(tree.props)
  return tree
}

test('receipt capture is the first work quick action; personal actions remain unchanged', () => {
  const { getQuickActions } = loadApp()('src/lib/quick-actions.ts')
  for (const account of ['freelancer', 'business']) {
    const actions = getQuickActions(account)
    assert.equal(actions[0].label, 'Upload a receipt')
    assert.equal(actions[0].href, '/expenses?action=upload-receipt')
    assert.equal(actions[0].id, 'add-expense', 'preserve existing action identity')
    assert.equal(new Set(actions.map(action => action.id)).size, actions.length)
    assert.equal(actions.length, 4)
  }
  assert.deepEqual(Array.from(getQuickActions('personal'), action => [action.id, action.label, action.href]), [
    ['pay-bill', 'Pay Bill', '/bills'], ['add-expense', 'Add Expense', '/expenses'],
    ['add-bill', 'Add Bill', '/bills'], ['record-payment', 'Record Payment', '/bills'],
  ])
})

test('work dashboards link receipt capture, the draft filter, and the exact saved expense', () => {
  for (const account of ['freelancer', 'business']) {
    const links = elements(renderPage('dashboard', account, [expense])).filter(node => node.type === 'Link')
    assert.ok(links.some(node => node.props.href === '/expenses?action=upload-receipt' && text(node).includes('Upload a receipt')))
    assert.ok(links.some(node => node.props.href === '/expenses?status=DRAFT' && text(node) === '1 expense drafts to review'))
    assert.ok(links.some(node => node.props.href === `/expenses?expense=${expenseId}` && text(node).includes('Synthetic receipt')))
  }
})

test('personal recent expenses link the saved record without changing the personal capture action', () => {
  const links = elements(renderPage('dashboard', 'personal', [expense])).filter(node => node.type === 'Link')
  assert.ok(links.some(node => node.props.href === `/expenses?expense=${expenseId}`))
  assert.ok(links.some(node => node.props.href === '/expenses' && text(node).includes('Add Expense')))
  assert.equal(links.some(node => node.props.href === '/expenses?action=upload-receipt'), false)
})

test('Review opens exact draft and submitted expense records while keeping time navigation unchanged', () => {
  const time = { id: 'synthetic-time', user_id: owner, status: 'DRAFT', duration_minutes: 30, notes: 'Synthetic time' }
  const tree = renderPage('review', 'business', [expense, { ...expense, id: otherExpenseId, user_id: 'synthetic-other-owner', status: 'SUBMITTED' }], [time])
  const links = elements(tree).filter(node => node.type === 'Link' && text(node) === 'Open')
  assert.deepEqual(links.map(node => node.props.href), [
    `/expenses?expense=${expenseId}`, '/time-entries', `/expenses?expense=${otherExpenseId}`,
  ])
})

test('malformed service record IDs never become expense query URLs', () => {
  const malformed = { ...expense, id: 'javascript:alert(1)&expense=other' }
  const dashboardLinks = elements(renderPage('dashboard', 'freelancer', [malformed])).filter(node => node.type === 'Link' && text(node).includes('Synthetic receipt'))
  const reviewLinks = elements(renderPage('review', 'freelancer', [malformed])).filter(node => node.type === 'Link' && text(node) === 'Open')
  assert.equal(dashboardLinks[0].props.href, '/expenses')
  assert.equal(reviewLinks[0].props.href, '/expenses')
})
