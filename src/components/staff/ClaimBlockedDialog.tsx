'use client'

import { AlertCircle, X } from 'lucide-react'
import { CLAIM_BLOCK_REASON, type ClaimBlocker } from '@/lib/claim-gate'
import { formatDate } from '@/lib/compliance'

/** Shown instead of claiming a shift when a document the center requires is expired, rejected or overdue */
export function ClaimBlockedDialog({ centerName, blockers, onFix, onClose }: {
  centerName: string
  blockers: ClaimBlocker[]
  onFix: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md rounded-[2rem] border-2 border-border bg-white p-8 text-left shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-6 top-6 cursor-pointer text-slate-400 hover:text-slate-600">
          <X className="h-5 w-5" />
        </button>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <AlertCircle className="h-6 w-6 text-red-600" />
        </div>
        <h3 className="mb-3 text-2xl font-black text-heading">Update your documents</h3>
        <p className="mb-4 text-sm leading-relaxed text-text-muted">
          You cannot claim a shift at <strong className="text-heading">{centerName}</strong> until {blockers.length === 1 ? 'this required document is' : 'these required documents are'} fixed.
        </p>
        <ul className="mb-6 divide-y divide-border rounded-xl border border-border">
          {blockers.map(b => (
            <li key={b.requirement_id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
              <span className="font-semibold text-heading">{b.document_name}</span>
              <span className="shrink-0 text-right text-xs font-semibold text-red-600">
                {CLAIM_BLOCK_REASON[b.reason] ?? b.reason}
                {b.due_on && <span className="block font-normal text-muted">{formatDate(b.due_on)}</span>}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2.5">
          <button type="button" onClick={onFix} className="w-full cursor-pointer rounded-xl bg-brand-600 px-4 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-brand-800">
            Update documents
          </button>
          <button type="button" onClick={onClose} className="w-full cursor-pointer py-2 text-center text-sm font-bold text-muted transition-colors hover:text-heading">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
