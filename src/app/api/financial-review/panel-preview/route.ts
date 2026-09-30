import { reviewMode } from '@/lib/financial-review/access'
import { panelHtml } from '@/lib/financial-review/panel'

// Development bridge harness. Exercises the actual MCP HTML/resource and tools,
// not an assertion that ChatGPT registration or its host integration is verified.
export function GET(request: Request) {
  try { if (reviewMode(request) !== 'synthetic') throw new Error() }
  catch { return new Response(null, { status: 404 }) }
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Amountly plugin preview</title></head><body style="margin:0;font:14px system-ui;background:#eff3f1"><p style="margin:0;padding:16px;box-sizing:border-box;height:64px">Amountly plugin · Local bridge harness · Synthetic data</p><iframe title="Amountly financial panel" id="panel" sandbox="allow-scripts" style="display:block;width:100%;height:calc(100vh - 64px);border:0"></iframe><script nonce="${nonce}">
const frame=document.getElementById('panel');let rpcId=0;
frame.srcdoc=${JSON.stringify(panelHtml.replace('<script>', `<script nonce="${nonce}">`)).replaceAll('<', '\\u003c')};
async function callTool(name,args){const response=await fetch('/api/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name,arguments:args}})});if(!response.ok)throw new Error('Request failed');const body=await response.json();if(body.error)throw new Error('Tool failed');return body.result}
window.addEventListener('message',async event=>{if(event.source!==frame.contentWindow)return;const m=event.data;if(!m||m.jsonrpc!=='2.0')return;try{let result;if(m.method==='ui/initialize')result={protocolVersion:'2026-01-26',hostInfo:{name:'Amountly local test harness',version:'0.1.0'},hostCapabilities:{serverTools:{}},hostContext:{displayMode:'inline'}};else if(m.method==='ui/notifications/initialized'){const result=await callTool('show_financial_panel',{start:'2026-09-28',end:'2026-10-04',currency:'USD'});frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result},'*');return}else if(m.method==='tools/call'&&['review_period','get_financial_record'].includes(m.params?.name))result=await callTool(m.params.name,m.params.arguments);else throw new Error('Unsupported method');frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result},'*')}catch{frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:'Preview request failed'}},'*')}});
</script></body></html>`
  // srcdoc script is isolated in an opaque-origin sandbox; no credentials flow
  // into the frame. The harness only proxies allowlisted read-only MCP tools.
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-src about:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
    'X-Content-Type-Options': 'nosniff' } })
}
