const test = require('node:test')
const assert = require('node:assert/strict')
const loadApp = require('./load-app.cjs')

// Minimal hook host, using the same dependency-override approach as auth tests.
// Exercise the application's actual request state across renders and failures.
function captureForm() {
  const slots = []
  let index = 0
  const load = loadApp({ react: {
    useRef(initial) { const i=index++; return slots[i] ??= {current:initial} },
    useState(initial) { const i=index++; if(!(i in slots)) slots[i]=initial; return [slots[i],value=>{slots[i]=value}] },
  } })
  const { useCreateAttempt } = load('src/hooks/useCreateAttempt.ts')
  const { recordError } = load('src/services/review.service.ts')
  return { render:()=>{index=0;return useCreateAttempt()}, recordError }
}

test('uncertain saves retain an immutable payload and ID despite changed form data or a later denial', async()=>{
  const form=captureForm(), calls=[]
  const input={amount:10,lines:[{description:'Synthetic',rate:10}]}
  await assert.rejects(form.render().run(input,async(data,id)=>{calls.push({data,id});throw form.recordError()}))
  input.amount=20;input.lines[0].rate=20
  assert.equal(form.render().unknown,true)
  assert.equal(form.render().reset(),false)
  await assert.rejects(form.render().run(input,async(data,id)=>{calls.push({data,id});throw form.recordError('42501')}))
  assert.equal(form.render().unknown,true)
  const result=await form.render().run(input,async(data,id)=>{calls.push({data,id});return id})
  assert.ok(calls.every(call=>call.id===result && call.data.amount===10 && call.data.lines[0].rate===10))
  assert.equal(form.render().unknown,false)
  assert.equal(form.render().message,null)
  assert.equal(form.render().reset(),true)
})

test('a definite first rejection unlocks input and allows a corrected request with a new ID', async()=>{
  const form=captureForm();let rejectedId
  await assert.rejects(form.render().run({amount:-1},async(data,id)=>{rejectedId=id;throw form.recordError('22023')}))
  assert.equal(form.render().unknown,false)
  assert.match(form.render().message,/Check the fields/)
  await form.render().run({amount:10},async(data,id)=>{assert.notEqual(id,rejectedId);assert.equal(data.amount,10)})
  assert.equal(form.render().message,null)
})

test('a second submission and reset cannot replace an in-flight request', async()=>{
  const form=captureForm();let finish;let calls=0
  const saving=form.render().run({amount:10},()=>{calls++;return new Promise(resolve=>{finish=resolve})})
  assert.equal(form.render().reset(),false)
  await assert.rejects(form.render().run({amount:20},async()=>{calls++}),/already in progress/)
  assert.equal(calls,1)
  finish('saved');assert.equal(await saving,'saved')
  assert.equal(form.render().reset(),true)
})
