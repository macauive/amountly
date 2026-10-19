import nodemailer from 'nodemailer'
import { z } from 'zod/v3'
import { requiredSecret } from '@/lib/platform/config'

const address = z.string().email().max(254)
const messageSchema = z.object({
  email: address,
  otp: z.string().regex(/^\d{6}$/),
  type: z.enum(['email-verification', 'forget-password']),
})

export async function sendAuthCode(email: string, otp: string, type: string) {
  const sender = address.safeParse(requiredSecret('RESEND_FROM'))
  if (!sender.success) throw new Error('Invalid mail configuration')
  const message = messageSchema.safeParse({ email, otp, type })
  if (!message.success) throw new Error('Invalid authentication email')

  // Fixed Resend endpoint; no caller-controlled hosts, headers or credentials.
  const transport = nodemailer.createTransport({ host: 'smtp.resend.com', port: 587,
    secure: false, requireTLS: true, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    auth: { user: 'resend', pass: requiredSecret('RESEND_API_KEY') },
    connectionTimeout: 10000, socketTimeout: 15000, logger: false, debug: false })
  try {
    await transport.sendMail({ from: { name: 'Amountly', address: sender.data }, to: message.data.email,
      subject: type === 'forget-password' ? 'Reset your Amountly password' : 'Verify your Amountly email',
      text: `Your Amountly verification code is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.` })
  } catch {
    // Provider errors can contain recipients, credentials or message content.
    throw new Error('Authentication email could not be sent')
  } finally { transport.close() }
}
