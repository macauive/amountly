import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'

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
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  )
}
