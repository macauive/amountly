const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
function fixture({broadcast=true}={}) {
 const bus=[],messages=[],windows=[],state={user:'owner',pending:[]}
 class Channel {
  constructor(name){assert.equal(name,'amountly-auth-state');bus.push(this);this.closed=false}
  postMessage(data){messages.push(data);for(const peer of bus)if(peer!==this&&!peer.closed)peer.onmessage?.({data})}
  close(){this.closed=true}
 }
 function client(){
  const handlers=new Map(),window={addEventListener(name,fn){handlers.set(name,fn)},removeEventListener(name,fn){assert.equal(handlers.get(name),fn);handlers.delete(name)}}
  windows.push(handlers)
  const module={exports:{}}
  const source=ts.transpileModule(fs.readFileSync('src/lib/platform/browser.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const response=user=>Response.json(user?{user:{id:user,email:'synthetic@example.invalid',createdAt:'2026-10-12',emailVerified:true}}:null)
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>{assert.equal(name,'@supabase/postgrest-js');return {PostgrestClient:class{}}},URL,window,BroadcastChannel:broadcast?Channel:undefined,
   fetch:async(path)=>{
    if(path==='/api/auth/get-session'){if(state.pending.length)return state.pending.shift();return response(state.user)}
    if(path==='/api/auth/sign-out'){state.user=null;return Response.json({success:true})}
    if(path==='/api/auth/sign-in/email'){state.user='other';return response(state.user)}
    assert.fail('Unexpected outbound request')
   }})
  return module.exports.createRenderBrowserClient()
 }
 return {client,state,messages,windows,bus}
}
test('cross-tab sign-in/out clears old state before revalidating and broadcasts no private data',async()=>{
 const f=fixture(),one=f.client(),two=f.client(),events=[]
 const a=one.auth.onAuthStateChange((event,session)=>events.push([event,session?.user.id??null]))
 const b=two.auth.onAuthStateChange(()=>{})
 await one.auth.getSession();await two.auth.getSession()
 await two.auth.signInWithPassword({email:'synthetic@example.invalid',password:'synthetic fixture'})
 await tick();assert.deepEqual(events,[['SIGNED_OUT',null],['SIGNED_IN','other']])
 assert.deepEqual(f.messages,['changed'])
 await two.auth.signOut();await tick();assert.deepEqual(events.slice(-1),[['SIGNED_OUT',null]])
 assert.deepEqual(f.messages,['changed','changed'])
 a.data.subscription.unsubscribe();b.data.subscription.unsubscribe()
 assert.ok(f.bus.every(channel=>channel.closed));assert.ok(f.windows.every(handlers=>!handlers.size))
})
test('a delayed old session cannot restore private state after a newer tab event',async()=>{
 const f=fixture(),client=f.client(),events=[]
 const subscription=client.auth.onAuthStateChange((event,session)=>events.push([event,session?.user.id??null]))
 let resolve;f.state.pending.push(new Promise(done=>resolve=done))
 f.bus[0].onmessage({data:'changed'});assert.deepEqual(events,[['SIGNED_OUT',null]])
 f.state.user='other';f.bus[0].onmessage({data:'changed'});await tick()
 resolve(Response.json({user:{id:'owner',emailVerified:true}}));await tick()
 assert.deepEqual(events,[['SIGNED_OUT',null],['SIGNED_OUT',null],['SIGNED_IN','other']])
 f.bus[0].onmessage({data:{user:{id:'forged'}}});await tick();assert.equal(events.length,3)
 subscription.data.subscription.unsubscribe()
})
test('focus checks preserve an unchanged editor and detect account changes without BroadcastChannel',async()=>{
 const f=fixture({broadcast:false}),client=f.client(),events=[]
 const subscription=client.auth.onAuthStateChange((event,session)=>events.push([event,session?.user.id??null]))
 await client.auth.getSession();await f.windows[0].get('focus')();assert.deepEqual(events,[])
 f.state.user='other';await f.windows[0].get('focus')();assert.deepEqual(events,[['SIGNED_OUT',null],['SIGNED_IN','other']])
 subscription.data.subscription.unsubscribe();assert.equal(f.windows[0].size,0)
})
