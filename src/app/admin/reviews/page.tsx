'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EyeOff, Eye, Loader2, Lock, Star } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { moderateReview } from '@/app/actions/reviews.actions'
import { showAlert, showPrompt } from '@/lib/dialog'

type Filter = 'all' | 'low' | 'pending' | 'hidden'
const FILTERS: { id: Filter; label: string }[] = [
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
  edit_history: unknown[] | null
  created_at: string
}

/** Super admins: every Care Score review, including private feedback. Hide (with a reason) or show again; never delete. */
export default function AdminReviewsPage() {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<AdminReview[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<Filter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('shift_reviews')
      .select('id, shift_id, reviewer_id, reviewee_id, reviewer_type, rating, tags, public_comment, private_feedback, do_not_return, author_name, author_role, reveal_at, hidden_at, hidden_reason, edit_history, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (filter === 'low') q = q.lte('rating', 2)
    if (filter === 'pending') q = q.gt('reveal_at', new Date().toISOString())
    if (filter === 'hidden') q = q.not('hidden_at', 'is', null)
    const { data, error } = await q
    if (error) showAlert('Could not load reviews: ' + error.message, { tone: 'error' })
    const list = (data ?? []) as AdminReview[]
    setRows(list)

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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
