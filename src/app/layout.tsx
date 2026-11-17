import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'
import { AdMeasurementConsent } from '@/components/ad-measurement-consent'
import { adMeasurementEnabled } from '@/lib/ad-measurement'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Amountly',
  description: 'AI-assisted accounting for bills, expenses, invoices, and financial next steps',
  icons: {
    icon: [
      {
        url: '/icon.png?v=transparent',
        type: 'image/png',
        sizes: '512x512',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/amountly-icon-dark.png',
        type: 'image/png',
        sizes: '512x512',
        media: '(prefers-color-scheme: dark)',
      },
    ],
    apple: '/apple-icon.png?v=transparent',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const requestHeaders = await headers()
  const nonce = requestHeaders.get('x-nonce') ?? undefined
  const measurement = requestHeaders.get('host') === 'amountly.app' && adMeasurementEnabled({
    pixelId: process.env.OPENAI_ADS_PIXEL_ID,
    apiKey: process.env.OPENAI_ADS_CONVERSION_KEY,
  })
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        {measurement && <AdMeasurementConsent />}
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  )
}
