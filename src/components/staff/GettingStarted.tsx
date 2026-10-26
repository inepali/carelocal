'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Download, FolderOpen, ListChecks, Loader2, Upload, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { showAlert } from '@/lib/dialog'
import { useIsRegularOnly } from '@/lib/hooks/useIsRegularOnly'
import { formatDate } from '@/lib/compliance'
import { docKey, loadOnboarding, progressOf, setOnboardingItem, tasksFor, type OnboardingData } from '@/lib/onboarding'

/** The staff member ticks each item off by hand when they have done it; nothing is checked or enforced. */
export function GettingStarted({ profileHref, documentsHref }: { profileHref: string; documentsHref: string }) {
  const { isRegularOnly, loading: classLoading } = useIsRegularOnly()
  const [data, setData] = useState<OnboardingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setData(await loadOnboarding(createClient()))
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function toggle(key: string) {
    if (!data || saving) return
    const checked = !data.done.has(key)
    setSaving(key)
    const { error, completedAt } = await setOnboardingItem(createClient(), data.staffId, key, checked)
    setSaving(null)
    if (error) { showAlert('Could not save that change: ' + error); return }
    setData(prev => {
      if (!prev) return prev
      const done = new Map(prev.done)
      if (checked && completedAt) done.set(key, completedAt); else done.delete(key)
      return { ...prev, done }
    })
  }

  if (loading || classLoading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!data) return <p className="text-muted">Your staff profile could not be found.</p>

  const includeAvailability = !isRegularOnly
  const tasks = tasksFor(includeAvailability)
  const { done, total } = progressOf(data, includeAvailability)
  const percent = total ? Math.round((done / total) * 100) : 0

  return (
    <div className="max-w-4xl pb-20">
      <h1 className="mb-1 text-3xl font-extrabold text-heading">Getting started</h1>
      <p className="mb-6 text-muted">Work through this list, and tick each item when you have done it.</p>

      <div className="mb-8 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm font-bold text-heading">{done === total ? 'All done' : `${done} of ${total} done`}</span>
          <span className="text-sm text-muted">{percent}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold text-heading">Your profile</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          {tasks.map(task => (
            <Row
              key={task.key}
              completedAt={data.done.get(task.key)}
              saving={saving === task.key}
              onToggle={() => toggle(task.key)}
              title={task.label}
              hint={task.hint}
              action={{ label: 'Open', icon: FolderOpen, href: task.tab ? `${profileHref}?tab=${task.tab}` : documentsHref }}
            />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-heading">{data.stateCode ? `Documents for ${data.stateCode}` : 'State documents'}</h2>
        {!data.stateCode ? (
          <p className="rounded-2xl border border-border bg-white p-5 text-sm text-muted shadow-sm">
            Add your city and state in <Link href={`${profileHref}?tab=personal`} className="font-semibold text-brand-600 hover:underline">your profile</Link> to see the documents your state asks for.
          </p>
        ) : data.docs.length === 0 ? (
          <p className="rounded-2xl border border-border bg-white p-5 text-sm text-muted shadow-sm">
            {data.stateListed ? `There are no extra documents to collect in ${data.stateCode} right now.` : `CareLocal has not published a document list for ${data.stateCode} yet. Check back soon.`}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
            {data.docs.map(doc => (
              <Row
                key={doc.id}
                completedAt={data.done.get(docKey(doc.id))}
                saving={saving === docKey(doc.id)}
                onToggle={() => toggle(docKey(doc.id))}
                title={doc.document_name}
                badge={doc.is_required ? undefined : 'Optional'}
                hint={doc.instructions}
                link={doc.link_url}
                action={{ label: 'Upload', icon: Upload, href: documentsHref }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

const ROW_BUTTON = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-semibold text-brand-600 hover:border-brand-600 hover:bg-brand-50'

function Row({ completedAt, saving, onToggle, title, badge, hint, link, action }: {
  /** When it was ticked; undefined while not done */
  completedAt?: string
  saving: boolean
  onToggle: () => void
  title: string
  badge?: string
  hint?: string | null
  link?: string | null
  action: { label: string; href: string; icon: LucideIcon }
}) {
  const checked = !!completedAt
  return (
    <li className="flex items-start gap-3 px-5 py-4">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`${title}: ${checked ? 'done' : 'not done'}`}
        disabled={saving}
        onClick={onToggle}
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-transparent hover:border-brand-600'}`}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" /> : <Check className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${checked ? 'text-muted line-through' : 'text-heading'}`}>
          {title}
          {badge && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 no-underline">{badge}</span>}
        </div>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
        {completedAt && <p className="mt-0.5 text-xs text-muted sm:hidden">Completed {formatDate(completedAt)}</p>}
      </div>
      <div className="hidden w-36 shrink-0 pt-1.5 text-right text-xs text-muted sm:block">
        {completedAt ? <>Completed <span className="font-semibold text-text-main">{formatDate(completedAt)}</span></> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className={ROW_BUTTON}>
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        )}
        <Link href={action.href} className={ROW_BUTTON}>
          <action.icon className="h-3.5 w-3.5" /> {action.label}
        </Link>
      </div>
    </li>
  )
}

/** How far along the checklist is; null while loading, on error, or once everything is done */
function useUnfinishedProgress(pathname: string) {
  const { isRegularOnly, loading: classLoading } = useIsRegularOnly()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    if (classLoading) return
    let cancelled = false
    loadOnboarding(createClient()).then(data => {
      if (!cancelled && data) setProgress(progressOf(data, !isRegularOnly))
    })
    return () => { cancelled = true }
    // Re-count on every page change, so ticking items on the checklist page is reflected when they leave it
  }, [classLoading, isRegularOnly, pathname])

  return progress && progress.done < progress.total ? progress : null
}

/** A slim reminder above the page content until every item is ticked */
export function GettingStartedBanner({ href, pathname }: { href: string; pathname: string }) {
  const progress = useUnfinishedProgress(pathname)
  if (!progress || pathname === href) return null
  return (
    <Link href={href} className="mb-6 flex max-w-5xl items-center gap-3 rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800 hover:bg-brand-100">
      <ListChecks className="h-5 w-5 shrink-0 text-brand-600" />
      <span className="flex-1"><strong>Getting started:</strong> {progress.done} of {progress.total} done</span>
      <span className="inline-flex items-center gap-1 font-semibold text-brand-600">Continue <ArrowRight className="h-4 w-4" /></span>
    </Link>
  )
}
