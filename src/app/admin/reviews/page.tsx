'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, EyeOff, Eye, Flag, Loader2, Lock, ShieldAlert, Star } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { moderateReview, releaseReviewHold, resolveReviewReport } from '@/app/actions/reviews.actions'
import { HOLD_REASON_LABELS, REPORT_REASONS } from '@/lib/care-score'
import { showAlert, showPrompt } from '@/lib/dialog'

type Filter = 'reported' | 'held' | 'all' | 'low' | 'pending' | 'hidden'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'reported', label: 'Reported' },
  { id: 'held', label: 'Held for personal info' },
  { id: 'all', label: 'All' },
  { id: 'low', label: '1–2 stars' },
  { id: 'pending', label: 'Not revealed yet' },
  { id: 'hidden', label: 'Hidden' },
]

interface AdminReview {
  id: string
  shift_id: string
  reviewer_id: string
  reviewee_id: string
  reviewer_type: 'center' | 'staff'
  rating: number
  tags: string[] | null
  public_comment: string | null
  private_feedback: string | null
  do_not_return: boolean | null
  author_name: string | null
  author_role: string | null
  reveal_at: string | null
  hidden_at: string | null
  hidden_reason: string | null
  held_at: string | null
  held_reasons: string[] | null
  edit_history: unknown[] | null
  created_at: string
}

interface AdminReport {
  id: string
  review_id: string
  reason: string
  details: string | null
  status: 'open' | 'dismissed' | 'actioned'
  created_at: string
}

const reasonLabel = (r: string) => REPORT_REASONS.find(x => x.value === r)?.label ?? r

/** Super admins: every Care Score review, including private feedback. Hide (with a reason) or show again; never delete. */
export default function AdminReviewsPage() {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<AdminReview[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<Filter>('reported')
  const [reports, setReports] = useState<Record<string, AdminReport[]>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let reportedIds: string[] | null = null
    if (filter === 'reported') {
      const { data: open } = await supabase.from('shift_review_reports').select('review_id').eq('status', 'open').limit(500)
      reportedIds = [...new Set(((open ?? []) as { review_id: string }[]).map(r => r.review_id))]
    }
    let list: AdminReview[] = []
    if (reportedIds === null || reportedIds.length > 0) {
      let q = supabase.from('shift_reviews')
        .select('id, shift_id, reviewer_id, reviewee_id, reviewer_type, rating, tags, public_comment, private_feedback, do_not_return, author_name, author_role, reveal_at, hidden_at, hidden_reason, held_at, held_reasons, edit_history, created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (reportedIds) q = q.in('id', reportedIds)
      if (filter === 'held') q = q.not('held_at', 'is', null)
      if (filter === 'low') q = q.lte('rating', 2)
      if (filter === 'pending') q = q.gt('reveal_at', new Date().toISOString())
      if (filter === 'hidden') q = q.not('hidden_at', 'is', null)
      const { data, error } = await q
      if (error) showAlert('Could not load reviews: ' + error.message, { tone: 'error' })
      list = (data ?? []) as AdminReview[]
    }
    setRows(list)

    const reportMap: Record<string, AdminReport[]> = {}
    if (list.length > 0) {
      const { data: reps } = await supabase.from('shift_review_reports')
        .select('id, review_id, reason, details, status, created_at')
        .in('review_id', list.map(r => r.id))
        .order('created_at', { ascending: false })
      for (const rep of (reps ?? []) as AdminReport[]) (reportMap[rep.review_id] ??= []).push(rep)
    }
    setReports(reportMap)

    const centerIds = new Set<string>()
    const staffIds = new Set<string>()
    for (const r of list) {
      if (r.reviewer_type === 'center') { centerIds.add(r.reviewer_id); staffIds.add(r.reviewee_id) }
      else { staffIds.add(r.reviewer_id); centerIds.add(r.reviewee_id) }
    }
    const [c, s] = await Promise.all([
      centerIds.size ? supabase.from('centers').select('id, name').in('id', [...centerIds]) : Promise.resolve({ data: [] }),
      staffIds.size ? supabase.from('staff_profiles').select('id, first_name, last_name').in('id', [...staffIds]) : Promise.resolve({ data: [] }),
    ])
    const map: Record<string, string> = {}
    for (const x of (c.data ?? []) as { id: string; name: string }[]) map[x.id] = x.name
    for (const x of (s.data ?? []) as { id: string; first_name: string; last_name: string }[]) map[x.id] = `${x.first_name} ${x.last_name}`.trim()
    setNames(map)
    setLoading(false)
  }, [supabase, filter])

  useEffect(() => { load() }, [load])

  async function toggle(row: AdminReview) {
    let reason: string | undefined
    if (!row.hidden_at) {
      const r = await showPrompt('Why are you hiding this review? (shown in the audit trail)', '', { title: 'Hide review', tone: 'danger', confirmLabel: 'Hide' })
      if (!r?.trim()) return
      reason = r.trim()
    }
    setBusyId(row.id)
    const res = await moderateReview(row.id, !row.hidden_at, reason)
    setBusyId(null)
    if (res.error) { showAlert(res.error, { tone: 'error' }); return }
    load()
  }

  async function release(row: AdminReview) {
    setBusyId(row.id)
    const res = await releaseReviewHold(row.id)
    setBusyId(null)
    if (res.error) { showAlert(res.error, { tone: 'error' }); return }
    load()
  }

  async function resolve(rep: AdminReport, action: 'dismiss' | 'hide') {
    const note = await showPrompt(action === 'hide' ? 'Why hide this review? (audit trail)' : 'Note for the audit trail (optional)', '',
      { title: action === 'hide' ? 'Hide review' : 'Dismiss report', tone: action === 'hide' ? 'danger' : 'default', confirmLabel: action === 'hide' ? 'Hide' : 'Dismiss' })
    if (note === null) return
    if (action === 'hide' && !note.trim()) { showAlert('Give a reason for hiding the review.'); return }
    setBusyId(rep.review_id)
    const res = await resolveReviewReport(rep.id, action, note)
    setBusyId(null)
    if (res.error) { showAlert(res.error, { tone: 'error' }); return }
    load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black text-heading"><Star className="h-6 w-6 fill-amber-400 text-amber-400" /> Care Score reviews</h1>
        <p className="mt-1 text-sm text-muted">Hidden reviews leave the public list and the score. The original is always kept.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)}
            className={`rounded-full px-4 py-1.5 text-xs font-bold ${filter === f.id ? 'bg-heading text-white' : 'border border-border bg-white text-text-main hover:bg-surface'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border bg-white py-16 text-center text-sm font-bold text-muted">No reviews here.</div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => {
            const pending = r.reveal_at && new Date(r.reveal_at) > new Date()
            const edits = Array.isArray(r.edit_history) ? r.edit_history.length : 0
            return (
              <div key={r.id} className={`rounded-2xl border bg-white p-5 ${r.hidden_at ? 'border-red-200 opacity-75' : 'border-border'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-bold text-text-main">
                      {r.author_name ?? 'Unknown'}{r.author_role ? ` (${r.author_role})` : ''} · {names[r.reviewer_id] ?? r.reviewer_type}
                      <span className="mx-2 text-muted">→</span>
                      {names[r.reviewee_id] ?? (r.reviewer_type === 'center' ? 'Staff' : 'Center')}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {new Date(r.created_at).toLocaleString()}
                      {pending && <> · <Lock className="inline h-3 w-3" /> reveals {new Date(r.reveal_at!).toLocaleDateString()}</>}
                      {edits > 0 && <> · edited {edits}×</>}
                      {r.do_not_return && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 font-bold text-red-700">Do not return</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-sm font-black text-heading">{r.rating}<Star className="h-4 w-4 fill-amber-400 text-amber-400" /></span>
                    <button type="button" onClick={() => toggle(r)} disabled={busyId === r.id}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${r.hidden_at ? 'border border-border text-text-main hover:bg-surface' : 'bg-red-50 text-red-700 hover:bg-red-100'}`}>
                      {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : r.hidden_at ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      {r.hidden_at ? 'Show again' : 'Hide'}
                    </button>
                  </div>
                </div>
                {r.tags && r.tags.length > 0 && <div className="mt-2 text-xs text-muted">{r.tags.join(' · ')}</div>}
                {r.public_comment && <p className="mt-2 rounded-xl bg-surface p-3 text-sm text-text-main">{r.public_comment}</p>}
                {r.private_feedback && <p className="mt-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-900"><span className="font-bold">Private: </span>{r.private_feedback}</p>}
                {r.hidden_at && <p className="mt-2 text-xs font-bold text-red-700">Hidden {new Date(r.hidden_at).toLocaleDateString()}: {r.hidden_reason}</p>}
                {r.held_at && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <span className="flex items-center gap-1.5 font-bold"><ShieldAlert className="h-4 w-4" /> Held: {(r.held_reasons ?? []).map(x => HOLD_REASON_LABELS[x] ?? x).join(', ')}</span>
                    <button type="button" onClick={() => release(r)} disabled={busyId === r.id} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-bold text-text-main hover:bg-surface disabled:opacity-50">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Fine, publish it
                    </button>
                  </div>
                )}
                {(reports[r.id] ?? []).map(rep => (
                  <div key={rep.id} className={`mt-3 rounded-xl border p-3 text-xs ${rep.status === 'open' ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-border bg-surface text-muted'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-bold"><Flag className="h-3.5 w-3.5" /> {reasonLabel(rep.reason)} · {new Date(rep.created_at).toLocaleDateString()}{rep.status !== 'open' && ` · ${rep.status}`}</span>
                      {rep.status === 'open' && (
                        <span className="flex gap-2">
                          <button type="button" onClick={() => resolve(rep, 'dismiss')} disabled={busyId === r.id} className="rounded-lg bg-white px-2.5 py-1 font-bold text-text-main hover:bg-surface disabled:opacity-50">Dismiss</button>
                          <button type="button" onClick={() => resolve(rep, 'hide')} disabled={busyId === r.id} className="rounded-lg bg-red-600 px-2.5 py-1 font-bold text-white hover:bg-red-700 disabled:opacity-50">Hide review</button>
                        </span>
                      )}
                    </div>
                    {rep.details && <p className="mt-1">{rep.details}</p>}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
