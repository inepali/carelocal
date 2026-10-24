'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export const FLD = 'w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600'
export const LBL = 'block text-sm font-medium text-text-main mb-1.5'
export const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800 disabled:opacity-50'
export const BTN_QUIET_SM = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-bold text-brand-600 hover:bg-brand-50 disabled:opacity-50'
export const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50'
export const BTN_QUIET = 'inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-muted hover:bg-surface disabled:opacity-50'

/** Today as YYYY-MM-DD in the browser's own time zone */
export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`flex max-h-[92vh] w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <h2 className="text-xl font-black text-heading">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

/** The state of a record or item, as a pill */
export function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${className}`}>{children}</span>
}
