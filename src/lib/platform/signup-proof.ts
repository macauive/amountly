import { parseCookies } from 'better-auth/cookies'
import { jwtVerify, SignJWT } from 'jose'
import { appOrigin, requiredSecret } from '@/lib/platform/config'

const purpose = 'amountly-signup-verification'
const maxAge = 3600

function cookieName() {
  return appOrigin().startsWith('https:') ? '__Host-amountly.signup' : 'amountly.signup'
}

function cookie(value: string, age: number) {
  const secure = appOrigin().startsWith('https:') ? '; Secure' : ''
  return `${cookieName()}=${value}; Max-Age=${age}; Path=/; HttpOnly; SameSite=Lax${secure}`
}

function signingKey() {
  return new TextEncoder().encode(requiredSecret('BETTER_AUTH_SECRET'))
}

export async function signupProofCookie(userId: string, email: string) {
  const proof = await new SignJWT({ email }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer(purpose).setAudience(purpose).setSubject(userId)
    .setIssuedAt().setExpirationTime(`${maxAge}s`).sign(signingKey())
  return cookie(proof, maxAge)
}

export function clearSignupProof() {
  return cookie('', 0)
}

export async function signupProofUser(headers: Headers, email: string) {
  const proof = parseCookies(headers.get('cookie') ?? '').get(cookieName())
  if (!proof) return null
  try {
    const { payload } = await jwtVerify(proof, signingKey(), {
      issuer: purpose, audience: purpose, algorithms: ['HS256'], requiredClaims: ['sub', 'exp'],
    })
    return payload.email === email ? payload.sub ?? null : null
  } catch {
    return null
  }
}
