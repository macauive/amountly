const test = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const loadApp = require('./load-app.cjs')
const tick = () => new Promise(resolve=>setTimeout(resolve,5))

function profileService(readResults, insertResult) {
  const writes = [], reads = []
  const client = { from(table) {
    assert.equal(table, 'users')
    return {
      select: () => ({ eq: (column, id) => {
        reads.push({ column, id })
        return { maybeSingle: async () => readResults.shift() }
      } }),
      insert: value => {
        writes.push(value)
        return { select: () => ({ single: async () => insertResult }) }
      },
    }
  } }
  const load = loadApp({ '@/lib/supabase': { getSupabaseClient: () => client } })
  return { ...load('src/services/profile.service.ts'), writes, reads }
}

test('profile creation ignores forged privileges and uses only authenticated identity', async () => {
  const authUser = { id: 'synthetic-user', email: 'qa@example.invalid', user_metadata: {
    id: 'foreign-user', email: 'foreign@example.invalid', role: 'OWNER',
    organization_id: 'foreign-workspace', is_active: true, account_type: 'business', name: 'x'.repeat(150),
  } }
  const service = profileService([{ data: null }], { data: { id: authUser.id } })
  await service.ensureOwnProfile(authUser, 'personal')
  assert.deepEqual(JSON.parse(JSON.stringify(service.writes)), [{
    id: authUser.id, email: authUser.email, name: 'x'.repeat(120),
    role: 'MEMBER', account_type: 'personal', organization_id: null,
  }])
  assert.deepEqual(service.reads, [{ column: 'id', id: authUser.id }])
})

test('profile setup preserves an existing disabled profile without writing over its permissions', async () => {
  const existing = { id: 'synthetic-user', role: 'CONTRACTOR', organization_id: 'existing', is_active: false }
  const service = profileService([{ data: existing }])
  assert.equal(await service.ensureOwnProfile({ id: existing.id }, 'business'), existing)
  assert.equal(service.writes.length, 0)
})

test('profile setup fails closed on invalid account type or failed profile lookup', async () => {
  const invalid = profileService([])
  await assert.rejects(invalid.ensureOwnProfile({ id: 'synthetic-user' }, 'administrator'), /valid account type/)
  assert.equal(invalid.reads.length, 0)
  assert.equal(invalid.writes.length, 0)
  const failed = profileService([{ error: { message: 'private provider detail' } }])
  await assert.rejects(failed.ensureOwnProfile({ id: 'synthetic-user' }, 'personal'), /^Error: Could not load your profile\. Please try again\.$/)
  assert.equal(failed.writes.length, 0)
})

test('concurrent profile creation rereads the winning profile and never upserts', async () => {
  const winner = { id: 'synthetic-user', role: 'MEMBER', organization_id: null }
  const service = profileService([{ data: null }, { data: winner }], { error: { code: '23505' } })
  assert.equal(await service.ensureOwnProfile({ id: winner.id, email: 'qa@example.invalid' }, 'personal'), winner)
  assert.equal(service.reads.length, 2)
  assert.equal(service.writes.length, 1)
  const failed = profileService([{ data: null }, { error: { message: 'private detail' } }], { error: { code: '23505' } })
  await assert.rejects(failed.ensureOwnProfile({ id: winner.id }, 'personal'), /Could not finish setting up your profile/)
})

test('sign-out cancels a pending profile read and prevents restoring stale authenticated UI', async () => {
  let state, effect, callback, resolveProfile
  let reads = 0
  const profile = new Promise(resolve=>{resolveProfile=resolve})
  const session = {user:{id:'00000000-0000-4000-8000-000000000001'}}
  const client = {
    auth: {
      getSession: async()=>({data:{session}}),
      onAuthStateChange: fn=>{callback=fn;return {data:{subscription:{unsubscribe(){}}}}},
    },
    from:()=>({select:()=>({eq:()=>({maybeSingle:()=>{reads++;return profile}})})}),
  }
  const hooks = {...React,
    useState: initial=>{state=initial;return [state,value=>{state=typeof value==='function'?value(state):value}]},
    useRef: value=>({current:value}),
    useEffect: fn=>{effect=fn},
  }
  const load = loadApp({react:hooks,'@/lib/supabase':{getSupabaseClient:()=>client}})
  load('src/contexts/AuthContext.tsx').AuthProvider({children:null})
  const cleanup = effect()
  await tick()
  assert.equal(reads,1)
  callback('SIGNED_OUT',null)
  resolveProfile({data:{id:session.user.id,account_type:'personal',role:'MEMBER',is_active:true},error:null})
  await tick()
  assert.equal(state.isAuthenticated,false)
  assert.equal(state.session,null)
  assert.equal(state.user,null)
  cleanup()
})

test('auth callbacks defer profile work and coalesce sign-in followed immediately by sign-out', async () => {
  let state, effect, callback
  let reads = 0
  const client={auth:{getSession:()=>new Promise(()=>{}),onAuthStateChange:fn=>{callback=fn;return {data:{subscription:{unsubscribe(){}}}}}},from:()=>{reads++;throw Error('Unexpected read')}}
  const hooks={...React,useState:initial=>{state=initial;return [state,value=>{state=typeof value==='function'?value(state):value}]},useRef:value=>({current:value}),useEffect:fn=>{effect=fn}}
  const load=loadApp({react:hooks,'@/lib/supabase':{getSupabaseClient:()=>client}})
  load('src/contexts/AuthContext.tsx').AuthProvider({children:null})
  const cleanup=effect()
  callback('SIGNED_IN',{user:{id:'synthetic'}})
  assert.equal(reads,0)
  callback('SIGNED_OUT',null)
  await tick()
  assert.equal(reads,0)
  assert.equal(state.isAuthenticated,false)
  cleanup()
})
