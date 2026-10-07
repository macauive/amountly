'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Button } from './ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet'
import { Plus, Zap } from 'lucide-react'
import { cn } from './ui/utils'
import { useAppState } from '@/contexts/AppStateContext'
import { AccountType } from '@/types/enums'
import { getQuickActions } from '@/lib/quick-actions'

interface FloatingActionButtonProps {
  onAction?: (actionId: string) => void
}

export function FloatingActionButton({ onAction }: FloatingActionButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const { currentUser } = useAppState()

  const accountType = currentUser?.account_type ?? AccountType.personal
  const quickActions = getQuickActions(accountType)

  // Dashboard has its own quick actions — no need for FAB there
  if (pathname === '/dashboard') return null

  const handleAction = (id: string, href: string) => {
    router.push(href)
    onAction?.(id)
    setIsOpen(false)
  }

  return (
    <>
      {/* Desktop FAB */}
      <div className="fixed bottom-6 right-6 z-50 hidden md:flex flex-col gap-2">
        {isOpen && (
          <div className="flex flex-col gap-2 animate-in slide-in-from-bottom-2">
            {quickActions.map((action) => (
              <Button
                key={action.id}
                onClick={() => handleAction(action.id, action.href)}
                size="lg"
                className={cn(
                  'h-12 w-12 rounded-full shadow-lg transition-all duration-200 hover:scale-105',
                  action.bg
                )}
                title={action.label}
              >
                <action.icon className="h-5 w-5 text-white" />
                <span className="sr-only">{action.label}</span>
              </Button>
            ))}
          </div>
        )}
        <Button
          onClick={() => setIsOpen(!isOpen)}
          size="lg"
          className={cn(
            'h-14 w-14 rounded-full shadow-lg bg-primary hover:bg-primary/90 transition-all duration-200',
            isOpen ? 'rotate-45' : 'hover:scale-105'
          )}
        >
          <Plus className="h-6 w-6" />
          <span className="sr-only">Quick Actions</span>
        </Button>
      </div>

      {/* Mobile Sheet */}
      <div className="fixed bottom-6 right-6 z-50 md:hidden">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button
              size="lg"
              className="h-14 w-14 rounded-full shadow-lg bg-primary hover:bg-primary/90 transition-all duration-200 hover:scale-105"
            >
              <Zap className="h-6 w-6" />
              <span className="sr-only">Quick Actions</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-auto">
            <SheetHeader className="text-left">
              <SheetTitle>Quick Actions</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-3 mt-6 mb-4">
              {quickActions.map((action) => (
                <Button
                  key={action.id}
                  onClick={() => handleAction(action.id, action.href)}
                  size="lg"
                  className={cn(
                    'h-20 flex-col gap-2 transition-all duration-200',
                    action.bg
                  )}
                >
                  <action.icon className="h-6 w-6 text-white" />
                  <span className="text-xs text-white">{action.label}</span>
                </Button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
