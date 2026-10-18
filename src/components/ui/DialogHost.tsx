'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react'
import { subscribeDialogs, type DialogRequest, type DialogTone } from '@/lib/dialog'

const TONE: Record<DialogTone, { tile: string; button: string; Icon: React.ElementType; title: string }> = {
  default: { tile: 'bg-brand-50 border-brand-100 text-brand-600', button: 'bg-brand-600 hover:bg-brand-800 shadow-brand-600/20', Icon: CheckCircle2, title: 'Notice' },
  danger:  { tile: 'bg-red-50 border-red-100 text-red-600',        button: 'bg-red-600 hover:bg-red-700 shadow-red-600/20',         Icon: AlertTriangle, title: 'Are you sure?' },
  error:   { tile: 'bg-amber-50 border-amber-100 text-amber-600',   button: 'bg-brand-600 hover:bg-brand-800 shadow-brand-600/20',   Icon: AlertCircle,   title: 'Something went wrong' },
}

/** Renders alert / confirm / prompt requests from src/lib/dialog.ts. Mounted once in the root layout. */
export function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([])
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const current = queue[0]

  useEffect(() => subscribeDialogs(request => setQueue(prev => [...prev, request])), [])

  useEffect(() => {
    if (current?.kind === 'prompt') {
      setValue(current.defaultValue)
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [current])

  function close(result?: boolean | string | null) {
    if (!current) return
    if (current.kind === 'alert') current.resolve()
    else if (current.kind === 'confirm') current.resolve(result === true)
    else current.resolve(typeof result === 'string' ? result : null)
    setQueue(prev => prev.slice(1))
  }

  const cancel = () => close(current?.kind === 'prompt' ? null : false)
  const accept = () => close(current?.kind === 'prompt' ? value : true)

  useEffect(() => {
    if (!current) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cancel()
      if (e.key === 'Enter' && current?.kind !== 'prompt') accept()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, value])

  if (!current) return null

  const tone = TONE[current.tone]
  const Icon = current.kind === 'prompt' ? HelpCircle : tone.Icon
  const title = current.title ?? (current.kind === 'prompt' ? 'Enter a value' : tone.title)
  const acceptLabel = current.kind === 'confirm' ? (current.confirmLabel ?? (current.tone === 'danger' ? 'Yes, continue' : 'Confirm')) : current.kind === 'prompt' ? 'Save' : 'OK'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-sm animate-in fade-in duration-200"
      role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message"
      onMouseDown={e => { if (e.target === e.currentTarget && current.kind !== 'alert') cancel() }}
    >
      <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-border animate-in zoom-in-95 duration-200">
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-5 border-2 ${tone.tile}`}>
          <Icon className="w-7 h-7" />
        </div>
        <h2 id="app-dialog-title" className="text-xl font-black text-heading mb-2">{title}</h2>
        <p id="app-dialog-message" className="text-muted font-medium leading-relaxed whitespace-pre-line break-words mb-6">{current.message}</p>

        {current.kind === 'prompt' && (
          <input
            ref={inputRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); accept() } }}
            className="w-full mb-6 px-4 py-3 rounded-xl border border-border bg-white text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600"
          />
        )}

        <div className="flex items-center gap-3">
          {current.kind !== 'alert' && (
            <button
              onClick={cancel}
              className="flex-1 px-5 py-3 rounded-xl font-bold text-muted bg-surface border-2 border-border hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            autoFocus={current.kind !== 'prompt'}
            onClick={accept}
            className={`flex-[2] px-5 py-3 rounded-xl font-black text-white shadow-lg transition-colors ${tone.button}`}
          >
            {acceptLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
