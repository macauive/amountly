export const dynamic = 'force-dynamic'
export function GET() {
  const challenge = process.env.OPENAI_APPS_DOMAIN_CHALLENGE
  if (!challenge || !/^[A-Za-z0-9_\-.:=]{1,512}$/.test(challenge)) return new Response(null, { status: 404 })
  return new Response(challenge, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}
