const test = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const loadApp = require('./load-app.cjs')

function setupPage(authOverrides = {}, submit = async () => ({ error: null })) {
  const slots = []
  const effects = []
  const requests = []
  const redirects = []
  let index = 0
  let auth = {
    session: { user: { id: 'synthetic-new-user' } },
    user: null,
    isAuthenticated: false,
    isLoading: false,
    recoveryPath: '/account-type',
    setAccountType: async type => {
      requests.push(type)
      return submit()
    },
    ...authOverrides,
  }
  const router = {
    replace: path => redirects.push(path),
    push: () => { throw new Error('Setup should replace its history entry') },
  }
  const hooks = {
    ...React,
    useState(initial) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
      return [slots[slot], value => {
        slots[slot] = typeof value === 'function' ? value(slots[slot]) : value
      }]
    },
    useRef(initial) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = { current: initial }
      return slots[slot]
    },
    useEffect(effect, dependencies) {
      const slot = index++
      const previous = slots[slot]
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
        effects.push(effect)
        slots[slot] = dependencies
      }
    },
  }
  const load = loadApp({
    react: hooks,
    'next/navigation': { useRouter: () => router },
    '@/contexts/AuthContext': { useAuth: () => auth },
    '@/components/ui/button': { Button: 'Button' },
    '@/components/ui/card': Object.fromEntries(
      ['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle'].map(name => [name, name])
    ),
    'lucide-react': { Briefcase: 'Briefcase', Loader2: 'Loader2', Check: 'Check' },
  })
  const Page = load('src/app/(auth)/account-type/page.tsx').default
  return {
    requests, redirects,
    setAuth(next) { auth = { ...auth, ...next } },
    render() {
      index = 0
      const tree = Page()
      while (effects.length) effects.shift()()
      return tree
    },
  }
}

function elements(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(elements)
  return [tree, ...elements(tree.props?.children)]
}

function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  return text(tree?.props?.children ?? '')
}

function button(tree) {
  const buttons = elements(tree).filter(element => element.type === 'Button')
  assert.equal(buttons.length, 1)
  return buttons[0]
}

test('new-user setup is explicit, offers one solo audience, and requests only freelancer', async () => {
  const page = setupPage()
  const tree = page.render()
  assert.equal(page.requests.length, 0, 'mount must not choose an account type')
  assert.deepEqual(page.redirects, [])
  assert.match(text(tree), /freelancers and solo service businesses/)
  assert.doesNotMatch(text(tree), /household|Choose your account type|Personal account/)
  assert.equal(elements(tree).filter(element => element.type === 'Card').length, 1)
  assert.equal(button(tree).props.disabled, false)

  await button(tree).props.onClick()
  assert.deepEqual(page.requests, ['freelancer'])
  assert.deepEqual(page.redirects, ['/dashboard'])
  assert.equal(button(page.render()).props.disabled, true)
  await button(tree).props.onClick()
  assert.deepEqual(page.requests, ['freelancer'], 'success must not allow a second setup while navigating')
})

test('duplicate clicks cannot issue concurrent setup requests, and safe failure permits retry', async () => {
  let resolveSetup
  const pending = new Promise(resolve => { resolveSetup = resolve })
  let attempt = 0
  const page = setupPage({}, () => ++attempt === 1 ? pending : Promise.resolve({ error: null }))
  const firstButton = button(page.render())
  const first = firstButton.props.onClick()
  await firstButton.props.onClick()
  assert.deepEqual(page.requests, ['freelancer'])
  assert.equal(button(page.render()).props.disabled, true)

  resolveSetup({ error: 'private database detail and synthetic-token' })
  await first
  const failedTree = page.render()
  const alert = elements(failedTree).find(element => element.props?.role === 'alert')
  assert.equal(text(alert), 'Could not finish setting up your account. Please try again.')
  assert.doesNotMatch(text(failedTree), /private database|synthetic-token/)
  assert.equal(button(failedTree).props.disabled, false)
  assert.deepEqual(page.redirects, [])

  await button(failedTree).props.onClick()
  assert.deepEqual(page.requests, ['freelancer', 'freelancer'])
  assert.deepEqual(page.redirects, ['/dashboard'])
})

test('unexpected setup exceptions are hidden and do not navigate', async () => {
  const page = setupPage({}, async () => { throw new Error('private provider detail and synthetic-token') })
  await button(page.render()).props.onClick()
  const tree = page.render()
  assert.match(text(tree), /Could not finish setting up your account/)
  assert.doesNotMatch(text(tree), /private provider|synthetic-token/)
  assert.equal(button(tree).props.disabled, false)
  assert.deepEqual(page.redirects, [])
})

test('loading, anonymous, and failed profile lookup states cannot start setup', () => {
  const loading = setupPage({ isLoading: true })
  assert.equal(elements(loading.render()).filter(element => element.type === 'Button').length, 0)
  assert.deepEqual(loading.redirects, [])
  assert.deepEqual(loading.requests, [])

  const anonymous = setupPage({ session: null })
  assert.equal(elements(anonymous.render()).filter(element => element.type === 'Button').length, 0)
  assert.deepEqual(anonymous.redirects, ['/login'])
  assert.deepEqual(anonymous.requests, [])

  const failedLookup = setupPage({ recoveryPath: null })
  const tree = failedLookup.render()
  assert.match(text(tree), /Refresh this page and try again/)
  assert.equal(elements(tree).filter(element => element.type === 'Button').length, 0)
  assert.deepEqual(failedLookup.redirects, [])
  assert.deepEqual(failedLookup.requests, [])
})

test('existing personal, freelancer, and business profiles keep their account types', () => {
  for (const accountType of ['personal', 'freelancer', 'business']) {
    const profile = { id: 'synthetic-existing-user', account_type: accountType, organization_id: 'synthetic-existing-workspace' }
    const page = setupPage({ user: profile, isAuthenticated: true, recoveryPath: null })
    assert.equal(elements(page.render()).filter(element => element.type === 'Button').length, 0)
    assert.deepEqual(page.requests, [])
    assert.deepEqual(page.redirects, ['/dashboard'])
    assert.equal(profile.account_type, accountType)
    page.render()
    assert.deepEqual(page.requests, [])
  }
})

test('legacy business profiles retain organization recovery instead of changing account type', () => {
  const profile = { id: 'synthetic-existing-user', account_type: 'business', organization_id: null }
  const page = setupPage({ user: profile, isAuthenticated: false, recoveryPath: '/onboarding' })
  assert.equal(elements(page.render()).filter(element => element.type === 'Button').length, 0)
  assert.deepEqual(page.requests, [])
  assert.deepEqual(page.redirects, ['/onboarding'])
  assert.equal(profile.account_type, 'business')
})

test('an existing profile is never offered setup even if recovery flags are stale', () => {
  const page = setupPage({
    user: { id: 'synthetic-existing-user', account_type: 'personal', organization_id: null },
    isAuthenticated: false,
    recoveryPath: '/account-type',
  })
  assert.equal(elements(page.render()).filter(element => element.type === 'Button').length, 0)
  assert.deepEqual(page.requests, [])
  assert.deepEqual(page.redirects, ['/dashboard'])
})
