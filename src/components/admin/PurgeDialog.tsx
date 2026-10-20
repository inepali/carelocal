'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react'
import type { PurgeResult } from '@/app/actions/data-cleanup.actions'

/**
 * Two-step confirmation for permanently deleting a center or staff member and all their data.
 *   Step 1: read what will be removed and type the exact name / email back.
 *   Step 2: re-enter your own password.
 */
export function PurgeDialog({
  title, targetLabel, confirmHint, consequences, option, onClose, onConfirm,
}: {
  title: string
  /** The exact text the admin must type (center name or staff email) */
  targetLabel: string
  confirmHint: string
  consequences: string[]
  option?: { label: string; defaultChecked: boolean }
  onClose: () => void
  onConfirm: (input: { confirmName: string; password: string; option: boolean }) => Promise<PurgeResult>
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [optionOn, setOptionOn] = useState(option?.defaultChecked ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Extract<PurgeResult, { success: true }> | null>(null)

  const nameMatches = typed.trim().toLowerCase() === targetLabel.toLowerCase()

  async function run() {
    setBusy(true)
    setError('')
    const res = await onConfirm({ confirmName: typed, password, option: optionOn })
    setBusy(false)
    if (res.success) setResult(res)
    else setError(res.error)
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="purge-title">
      <div className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl border border-slate-200">
        {result ? (
          <>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 border-2 bg-emerald-50 border-emerald-100 text-emerald-600">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-black text-slate-900 mb-2">Deleted</h2>
            <p className="text-slate-500 font-medium leading-relaxed mb-6">
              {targetLabel} and all related data were permanently removed.
              {' '}{result.filesRemoved} stored file{result.filesRemoved === 1 ? '' : 's'} deleted
              {result.filesFailed > 0 && ` (${result.filesFailed} could not be removed from storage and need manual cleanup)`}
              {result.accountsRemoved > 0 && `, ${result.accountsRemoved} sign-in account${result.accountsRemoved === 1 ? '' : 's'} removed`}.
            </p>
            <button onClick={onClose} className="w-full px-5 py-3 rounded-xl font-black text-white bg-slate-900 hover:bg-slate-700 transition-colors">Done</button>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 border-2 bg-red-50 border-red-100 text-red-600">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h2 id="purge-title" className="text-xl font-black text-slate-900 mb-1">{title}</h2>
            <p className="text-[11px] font-black uppercase tracking-widest text-red-600 mb-4">Step {step} of 2 · cannot be undone</p>

            {step === 1 ? (
              <>
                <p className="text-sm font-bold text-slate-700 mb-2">This permanently deletes:</p>
                <ul className="text-sm text-slate-600 font-medium list-disc pl-5 space-y-1 mb-5">
                  {consequences.map(c => <li key={c}>{c}</li>)}
                </ul>
                {option && (
                  <label className="flex items-start gap-2 text-sm font-medium text-slate-700 mb-5">
                    <input type="checkbox" checked={optionOn} onChange={e => setOptionOn(e.target.checked)} className="mt-0.5 w-4 h-4 accent-red-600" />
                    {option.label}
                  </label>
                )}
                <label className="block text-xs font-black text-slate-700 uppercase tracking-widest mb-2">{confirmHint}</label>
                <p className="text-sm font-mono font-bold text-slate-900 bg-slate-100 rounded-lg px-3 py-2 mb-2 break-all select-all">{targetLabel}</p>
                <input
                  autoFocus
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  placeholder="Type it exactly to continue"
                  className="w-full mb-6 px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
                />
                <div className="flex items-center gap-3">
                  <button onClick={onClose} className="flex-1 px-5 py-3 rounded-xl font-bold text-slate-500 bg-slate-50 border-2 border-slate-100 hover:bg-slate-100 transition-colors">Cancel</button>
                  <button
                    disabled={!nameMatches}
                    onClick={() => setStep(2)}
                    className="flex-[2] px-5 py-3 rounded-xl font-black text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600 font-medium mb-4">
                  Enter your password to confirm deleting <span className="font-bold text-slate-900">{targetLabel}</span>.
                </p>
                <input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && password && !busy) run() }}
                  placeholder="Your password"
                  className="w-full mb-3 px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
                />
                {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}
                <div className="flex items-center gap-3 mt-3">
                  <button disabled={busy} onClick={() => { setStep(1); setError(''); setPassword('') }} className="flex-1 px-5 py-3 rounded-xl font-bold text-slate-500 bg-slate-50 border-2 border-slate-100 hover:bg-slate-100 transition-colors">Back</button>
                  <button
                    disabled={!password || busy}
                    onClick={run}
                    className="flex-[2] flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-black text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 transition-colors"
                  >
                    {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Delete permanently'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
