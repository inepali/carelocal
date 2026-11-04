'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CenterProgram, LessonGoal, LessonLearningArea, LessonSubject, WorkArea } from '@/lib/types'
import {
  LessonPlan, LessonPlanItem, PLAN_STATUS, PLAN_DAYS, PLAN_BLOCKS, DAY_NAMES,
  mondayOf, addDays, weekLabel, dayLabel,
} from '@/lib/lesson-plans'
import { showAlert, showConfirm, showPrompt } from '@/lib/dialog'
import {
  ChevronLeft, ChevronRight, Loader2, Plus, Edit2, Trash2, X, Save, Send, CheckCircle2, MessageSquareWarning,
  Undo2, CalendarDays, Clock, Inbox, Target, NotebookPen, type LucideIcon,
} from 'lucide-react'

type Mode = 'admin' | 'teacher'
type ClassRow = Pick<WorkArea, 'id' | 'name' | 'program_id' | 'is_active'>
type ProgramRow = Pick<CenterProgram, 'id' | 'name' | 'is_active'>
type PendingRow = Pick<LessonPlan, 'id' | 'work_area_id' | 'week_start' | 'submitted_by_name' | 'submitted_at'>

type ItemDraft = { id: string | null; day: number; block: string; title: string; description: string; materials: string; goalIds: string[] }

const INPUT = 'w-full px-3 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600'
const LABEL = 'block font-bold text-text-main mb-1.5 uppercase tracking-widest text-[10px]'
const BTN = 'inline-flex items-center justify-center gap-2 font-bold px-4 py-2.5 rounded-xl text-sm transition-all disabled:opacity-50'

/**
 * One class's plan for one week, built from the center's learning areas → subjects → goals.
 * Teachers write and submit; center admins approve or ask for changes. The database enforces the same rules.
 */
export default function WeeklyLessonPlan({
  centerId, mode, programId: initialProgramId = null, defaultClassId = null,
}: { centerId: string; mode: Mode; programId?: string | null; defaultClassId?: string | null }) {
  const supabase = createClient()
  const isAdmin = mode === 'admin'

  const [programs, setPrograms] = useState<ProgramRow[]>([])
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [areas, setAreas] = useState<LessonLearningArea[]>([])
  const [subjects, setSubjects] = useState<LessonSubject[]>([])
  const [goals, setGoals] = useState<LessonGoal[]>([])
  const [booting, setBooting] = useState(true)

  const [programId, setProgramId] = useState<string | null>(initialProgramId)
  const [classId, setClassId] = useState<string | null>(defaultClassId)
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))

  const [plan, setPlan] = useState<LessonPlan | null>(null)
  const [items, setItems] = useState<LessonPlanItem[]>([])
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [pending, setPending] = useState<PendingRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [theme, setTheme] = useState('')
  const [draft, setDraft] = useState<ItemDraft | null>(null)

  // Programs, classes and the curriculum (active only; inactive goals already on a plan still show by id)
  useEffect(() => {
    let ignore = false
    Promise.all([
      supabase.from('center_programs').select('id, name, is_active').eq('center_id', centerId).order('sort_order').order('created_at'),
      supabase.from('work_areas').select('id, name, program_id, is_active').eq('center_id', centerId).order('sort_order').order('name'),
      supabase.from('lesson_learning_areas').select('*').eq('center_id', centerId).order('sort_order'),
      supabase.from('lesson_subjects').select('*').eq('center_id', centerId).order('sort_order'),
      supabase.from('lesson_goals').select('*').eq('center_id', centerId).order('sort_order'),
    ]).then(([p, c, a, s, g]) => {
      if (ignore) return
      const err = p.error ?? c.error ?? a.error ?? s.error ?? g.error
      if (err) setError(err.message)
      setPrograms(p.data || [])
      const cls = (c.data || []) as ClassRow[]
      setClasses(cls)
      setAreas((a.data || []) as LessonLearningArea[])
      setSubjects((s.data || []) as LessonSubject[])
      setGoals((g.data || []) as LessonGoal[])
      // Pick a class: the one asked for, else the first active class of the program, else the first active class
      setClassId(prev => {
        if (prev && cls.some(x => x.id === prev)) return prev
        const inProgram = cls.find(x => x.is_active && (!initialProgramId || x.program_id === initialProgramId))
        return inProgram?.id ?? null
      })
      setBooting(false)
    })
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId])

  const visibleClasses = useMemo(
    () => classes.filter(c => (c.is_active || c.id === classId) && (!programId || c.program_id === programId)),
    [classes, programId, classId],
  )
  const className = (id: string) => classes.find(c => c.id === id)?.name ?? 'Class'
  const goalById = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals])
  const subjectById = useMemo(() => new Map(subjects.map(s => [s.id, s])), [subjects])
  const areaById = useMemo(() => new Map(areas.map(a => [a.id, a])), [areas])

  const loadPlan = useCallback(async () => {
    if (!classId) { setPlan(null); setItems([]); return }
    setLoadingPlan(true)
    const { data: planRow, error: planErr } = await supabase.from('lesson_plans').select('*')
      .eq('work_area_id', classId).eq('week_start', weekStart).maybeSingle()
    if (planErr) setError(planErr.message)
    const p = (planRow as LessonPlan | null) ?? null
    let list: LessonPlanItem[] = []
    if (p) {
      const { data: itemRows, error: itemErr } = await supabase.from('lesson_plan_items')
        .select('*, lesson_plan_item_goals(goal_id)').eq('plan_id', p.id)
        .order('day').order('sort_order').order('created_at')
      if (itemErr) setError(itemErr.message)
      list = ((itemRows || []) as (Omit<LessonPlanItem, 'goal_ids'> & { lesson_plan_item_goals: { goal_id: string }[] })[])
        .map(({ lesson_plan_item_goals, ...rest }) => ({ ...rest, goal_ids: (lesson_plan_item_goals || []).map(x => x.goal_id) }))
    }
    setPlan(p)
    setTheme(p?.theme ?? '')
    setItems(list)
    setLoadingPlan(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, weekStart])

  const loadPending = useCallback(async () => {
    if (!isAdmin) return
    const { data } = await supabase.from('lesson_plans').select('id, work_area_id, week_start, submitted_by_name, submitted_at')
      .eq('center_id', centerId).eq('status', 'submitted').order('week_start').order('submitted_at')
    setPending((data || []) as PendingRow[])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId, isAdmin])

  useEffect(() => { if (!booting) loadPlan() }, [booting, loadPlan])
  useEffect(() => { loadPending() }, [loadPending])

  const canEdit = !!plan && (isAdmin || plan.status === 'draft' || plan.status === 'changes_requested')

  async function refresh() {
    await Promise.all([loadPlan(), loadPending()])
  }

  function fail(prefix: string, message: string) {
    setError(`${prefix}: ${message}`)
  }

  async function startPlan() {
    if (!classId) return
    setBusy(true); setError('')
    const { error } = await supabase.from('lesson_plans').insert({ center_id: centerId, work_area_id: classId, week_start: weekStart })
    setBusy(false)
    if (error) return fail('Couldn\'t start the plan', error.code === '23505' ? 'someone just started it; reloading.' : error.message)
    refresh()
  }

  async function saveTheme() {
    if (!plan || !canEdit || (plan.theme ?? '') === theme.trim()) return
    const { error } = await supabase.from('lesson_plans').update({ theme: theme.trim() || null }).eq('id', plan.id)
    if (error) fail('Couldn\'t save the theme', error.message)
    else setPlan({ ...plan, theme: theme.trim() || null })
  }

  async function transition(fn: 'lesson_plan_submit' | 'lesson_plan_reopen', confirmText?: string) {
    if (!plan) return
    if (confirmText && !await showConfirm(confirmText)) return
    await saveTheme()
    setBusy(true); setError('')
    const { error } = await supabase.rpc(fn, { p_plan_id: plan.id })
    setBusy(false)
    if (error) return fail('Couldn\'t update the plan', error.message)
    refresh()
  }

  async function review(approve: boolean) {
    if (!plan) return
    let note: string | null = null
    if (!approve) {
      note = await showPrompt('What should the teacher change?', '', { title: 'Request changes' })
      if (note == null) return
      if (!note.trim()) { showAlert('Add a short note so the teacher knows what to change.'); return }
    }
    setBusy(true); setError('')
    const { error } = await supabase.rpc('lesson_plan_review', { p_plan_id: plan.id, p_approve: approve, p_note: note })
    setBusy(false)
    if (error) return fail('Couldn\'t review the plan', error.message)
    refresh()
  }

  async function deletePlan() {
    if (!plan || !await showConfirm(`Delete this week's plan for ${className(plan.work_area_id)} and all its activities?`)) return
    const { error } = await supabase.from('lesson_plans').delete().eq('id', plan.id)
    if (error) return fail('Couldn\'t delete the plan', error.message)
    refresh()
  }

  // ── Activities ────────────────────────────────────────────────────────────
  function openItem(day: number, item?: LessonPlanItem) {
    setError('')
    setDraft(item
      ? { id: item.id, day: item.day, block: item.block ?? '', title: item.title, description: item.description ?? '', materials: item.materials ?? '', goalIds: [...item.goal_ids] }
      : { id: null, day, block: '', title: '', description: '', materials: '', goalIds: [] })
  }

  async function saveItem() {
    if (!plan || !draft || !draft.title.trim()) return
    setBusy(true)
    const payload = {
      day: draft.day,
      block: draft.block.trim() || null,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      materials: draft.materials.trim() || null,
    }
    let itemId = draft.id
    if (itemId) {
      const { error } = await supabase.from('lesson_plan_items').update(payload).eq('id', itemId)
      if (error) { setBusy(false); return fail('Couldn\'t save the activity', error.message) }
    } else {
      const sameDay = items.filter(i => i.day === draft.day)
      const { data, error } = await supabase.from('lesson_plan_items')
        .insert({ ...payload, center_id: centerId, plan_id: plan.id, sort_order: (sameDay[sameDay.length - 1]?.sort_order ?? -1) + 1 })
        .select('id').single()
      if (error || !data) { setBusy(false); return fail('Couldn\'t add the activity', error?.message ?? 'no row returned') }
      itemId = data.id as string
    }
    // Sync goals: remove unticked, add new
    const before = new Set(items.find(i => i.id === itemId)?.goal_ids ?? [])
    const after = new Set(draft.goalIds)
    const toRemove = [...before].filter(id => !after.has(id))
    const toAdd = [...after].filter(id => !before.has(id))
    const results = await Promise.all([
      toRemove.length ? supabase.from('lesson_plan_item_goals').delete().eq('item_id', itemId).in('goal_id', toRemove) : null,
      toAdd.length ? supabase.from('lesson_plan_item_goals').insert(toAdd.map(goal_id => ({ item_id: itemId, goal_id, center_id: centerId }))) : null,
    ])
    setBusy(false)
    const goalErr = results.find(r => r?.error)?.error
    if (goalErr) fail('The activity saved, but its goals didn\'t', goalErr.message)
    setDraft(null)
    loadPlan()
  }

  async function deleteItem(item: LessonPlanItem) {
    if (!await showConfirm(`Delete "${item.title}"?`)) return
    const { error } = await supabase.from('lesson_plan_items').delete().eq('id', item.id)
    if (error) return fail('Couldn\'t delete the activity', error.message)
    loadPlan()
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (booting) return <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-brand-600" /></div>

  const noCurriculum = areas.length === 0
  const status = plan ? PLAN_STATUS[plan.status] : null
  const coveredGoals = new Set(items.flatMap(i => i.goal_ids))
  const coveredAreas = new Set([...coveredGoals].map(id => subjectById.get(goalById.get(id)?.subject_id ?? '')?.learning_area_id).filter(Boolean))

  return (
    <div className="space-y-6">
      {isAdmin && pending.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-800 mb-2"><Inbox className="w-4 h-4" /> {pending.length} waiting for your approval</p>
          <div className="flex flex-wrap gap-2">
            {pending.map(p => (
              <button key={p.id} onClick={() => { setProgramId(null); setClassId(p.work_area_id); setWeekStart(p.week_start) }}
                className="rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-left text-xs hover:border-amber-500">
                <span className="font-bold text-heading">{className(p.work_area_id)}</span>
                <span className="text-muted"> · {weekLabel(p.week_start)}{p.submitted_by_name ? ` · ${p.submitted_by_name}` : ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pickers */}
      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
          <label>
            <span className={LABEL}>Program</span>
            <select className={INPUT} value={programId ?? ''} onChange={e => {
              const next = e.target.value || null
              setProgramId(next)
              const first = classes.find(c => c.is_active && (!next || c.program_id === next))
              setClassId(first?.id ?? null)
            }}>
              <option value="">All programs</option>
              {programs.filter(p => p.is_active || p.id === programId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>
            <span className={LABEL}>Class</span>
            <select className={INPUT} value={classId ?? ''} onChange={e => setClassId(e.target.value || null)} disabled={visibleClasses.length === 0}>
              {visibleClasses.length === 0 && <option value="">No classes in this program</option>}
              {visibleClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(w => addDays(w, -7))} className="p-2.5 rounded-xl border border-border bg-white hover:border-brand-600" aria-label="Previous week"><ChevronLeft className="w-5 h-5" /></button>
          <div className="min-w-[13rem] text-center">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Week of</div>
            <div className="font-black text-heading">{weekLabel(weekStart)}</div>
          </div>
          <button onClick={() => setWeekStart(w => addDays(w, 7))} className="p-2.5 rounded-xl border border-border bg-white hover:border-brand-600" aria-label="Next week"><ChevronRight className="w-5 h-5" /></button>
          {weekStart !== mondayOf(new Date()) && (
            <button onClick={() => setWeekStart(mondayOf(new Date()))} className="px-3 py-2.5 rounded-xl border border-border bg-white text-xs font-bold text-muted hover:text-brand-600">This week</button>
          )}
        </div>
      </div>

      {error && <div className="px-4 py-3 rounded-xl text-sm border bg-red-50 text-red-700 border-red-200 flex items-start justify-between gap-3">
        <span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X className="w-4 h-4" /></button>
      </div>}

      {!classId ? (
        <Empty icon={CalendarDays} title="Pick a class" text={programId ? 'This program has no classes yet. A center admin can assign classes to it in About → Manage Data.' : 'Choose a class to see its weekly plan.'} />
      ) : loadingPlan ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-brand-600" /></div>
      ) : !plan ? (
        <Empty icon={NotebookPen} title={`No plan for ${className(classId)} this week`}
          text={noCurriculum ? 'The center has no learning areas, subjects or goals yet. A center admin sets them up under Manage Subjects & Goals.' : 'Start the plan, add activities for each day and link them to goals, then submit it for approval.'}>
          <button onClick={startPlan} disabled={busy} className={`${BTN} bg-amber-400 text-heading hover:bg-amber-500 mt-4`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Start this week&apos;s plan
          </button>
        </Empty>
      ) : (
        <div className="bg-white border border-border rounded-3xl overflow-hidden">
          {/* Plan header */}
          <div className="p-5 border-b border-border bg-surface/50 flex flex-col xl:flex-row xl:items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h2 className="text-xl font-black text-heading">{className(plan.work_area_id)}</h2>
                {status && <span className={`px-2.5 py-1 rounded-lg border text-xs font-bold ${status.className}`}>{status.label}</span>}
              </div>
              {canEdit ? (
                <input className={`${INPUT} max-w-md`} placeholder="Theme for the week (optional), e.g. Fall Leaves" value={theme} maxLength={200}
                  onChange={e => setTheme(e.target.value)} onBlur={saveTheme} aria-label="Theme" />
              ) : plan.theme ? <p className="text-sm font-semibold text-text-main">Theme: {plan.theme}</p> : null}
              <p className="text-xs text-subtle mt-2">
                {plan.created_by_name && <>Started by {plan.created_by_name}</>}
                {plan.submitted_by_name && plan.status !== 'draft' && <> · Submitted by {plan.submitted_by_name}</>}
                {plan.status === 'approved' && plan.reviewed_by_name && <> · Approved by {plan.reviewed_by_name}</>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(plan.status === 'draft' || plan.status === 'changes_requested') && (
                <button onClick={() => transition('lesson_plan_submit')} disabled={busy || items.length === 0}
                  title={items.length === 0 ? 'Add at least one activity first' : undefined}
                  className={`${BTN} bg-brand-600 text-white hover:bg-brand-800`}><Send className="w-4 h-4" /> Submit for approval</button>
              )}
              {plan.status === 'submitted' && isAdmin && (
                <>
                  <button onClick={() => review(true)} disabled={busy} className={`${BTN} bg-brand-600 text-white hover:bg-brand-800`}><CheckCircle2 className="w-4 h-4" /> Approve</button>
                  <button onClick={() => review(false)} disabled={busy} className={`${BTN} bg-white text-red-700 border border-red-200 hover:bg-red-50`}><MessageSquareWarning className="w-4 h-4" /> Request changes</button>
                </>
              )}
              {plan.status === 'submitted' && (
                <button onClick={() => transition('lesson_plan_reopen', 'Take this plan back to draft? It will need to be submitted again.')} disabled={busy}
                  className={`${BTN} bg-white text-muted border border-border hover:bg-slate-50`}><Undo2 className="w-4 h-4" /> {isAdmin ? 'Back to draft' : 'Withdraw'}</button>
              )}
              {plan.status === 'approved' && (
                <button onClick={() => transition('lesson_plan_reopen', 'Revise this approved plan? It goes back to draft and needs approval again before it applies.')} disabled={busy}
                  className={`${BTN} bg-white text-muted border border-border hover:bg-slate-50`}><Edit2 className="w-4 h-4" /> Revise</button>
              )}
              {(isAdmin || plan.status === 'draft') && (
                <button onClick={deletePlan} disabled={busy} title="Delete plan" className="p-2.5 rounded-xl text-muted hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
          </div>

          {plan.status === 'changes_requested' && plan.review_note && (
            <div className="px-5 py-3 border-b border-red-200 bg-red-50 text-sm text-red-800 flex items-start gap-2">
              <MessageSquareWarning className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>{plan.reviewed_by_name ?? 'Your director'} asked for changes:</strong> <span className="whitespace-pre-line">{plan.review_note}</span></span>
            </div>
          )}
          {plan.status === 'submitted' && !isAdmin && (
            <div className="px-5 py-3 border-b border-amber-200 bg-amber-50 text-sm text-amber-800">Submitted. Your director will review it; withdraw it if you need to make changes.</div>
          )}

          {/* Coverage */}
          {items.length > 0 && areas.length > 0 && (
            <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-bold text-muted mr-1 flex items-center gap-1"><Target className="w-3.5 h-3.5" /> {coveredGoals.size} goals across</span>
              {areas.filter(a => a.is_active).map(a => (
                <span key={a.id} title={a.name}
                  className={`px-2 py-0.5 rounded-md border font-bold ${coveredAreas.has(a.id) ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-white text-subtle border-dashed border-slate-300'}`}>
                  {a.code || a.name}
                </span>
              ))}
            </div>
          )}

          {/* Days */}
          <div className="grid grid-cols-1 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-border">
            {PLAN_DAYS.map(day => {
              const dayItems = items.filter(i => i.day === day)
              return (
                <div key={day} className="p-3 min-h-[10rem] flex flex-col gap-2">
                  <div className="text-xs font-black uppercase tracking-widest text-muted">{dayLabel(plan.week_start, day)}</div>
                  {dayItems.map(item => (
                    <div key={item.id} className="group rounded-xl border border-border bg-white p-3 hover:border-brand-600 transition-colors">
                      {item.block && <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-700 mb-1"><Clock className="w-3 h-3" /> {item.block}</div>}
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-bold text-sm text-heading">{item.title}</div>
                        {canEdit && (
                          <div className="flex gap-1 shrink-0 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button onClick={() => openItem(day, item)} className="p-1 text-muted hover:text-brand-600" aria-label="Edit activity"><Edit2 className="w-3.5 h-3.5" /></button>
                            <button onClick={() => deleteItem(item)} className="p-1 text-muted hover:text-red-600" aria-label="Delete activity"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        )}
                      </div>
                      {item.description && <p className="text-xs text-text-muted mt-1 whitespace-pre-line">{item.description}</p>}
                      {item.materials && <p className="text-[11px] text-subtle mt-1"><span className="font-bold">Materials:</span> {item.materials}</p>}
                      {item.goal_ids.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {item.goal_ids.map(id => {
                            const g = goalById.get(id)
                            return <span key={id} title={g?.name} className="px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 text-[10px] font-bold border border-brand-200">{g?.code || (g?.name.slice(0, 18) ?? 'Goal')}</span>
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <button onClick={() => openItem(day)} className="mt-auto inline-flex items-center justify-center gap-1 rounded-xl border border-dashed border-brand-200 py-2 text-xs font-bold text-brand-600 hover:bg-brand-50">
                      <Plus className="w-3.5 h-3.5" /> Add activity
                    </button>
                  )}
                  {!canEdit && dayItems.length === 0 && <p className="text-xs text-subtle">Nothing planned</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {draft && plan && (
        <ActivityDialog
          draft={draft} setDraft={setDraft} weekStart={plan.week_start} busy={busy} onSave={saveItem}
          areas={areas} subjects={subjects} goals={goals} areaById={areaById} subjectById={subjectById} goalById={goalById}
        />
      )}
    </div>
  )
}

function Empty({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="py-16 px-6 bg-white border border-dashed border-brand-200 rounded-3xl text-center">
      <Icon className="w-12 h-12 text-border mx-auto mb-3" />
      <h3 className="text-lg font-bold text-heading mb-1">{title}</h3>
      <p className="text-sm text-muted max-w-md mx-auto">{text}</p>
      {children}
    </div>
  )
}

/** Add / edit one activity: day, time block, details, and the goals it works on (learning area → subject → goals) */
function ActivityDialog({
  draft, setDraft, weekStart, busy, onSave, areas, subjects, goals, areaById, subjectById, goalById,
}: {
  draft: ItemDraft
  setDraft: (d: ItemDraft | null) => void
  weekStart: string
  busy: boolean
  onSave: () => void
  areas: LessonLearningArea[]
  subjects: LessonSubject[]
  goals: LessonGoal[]
  areaById: Map<string, LessonLearningArea>
  subjectById: Map<string, LessonSubject>
  goalById: Map<string, LessonGoal>
}) {
  const activeAreas = areas.filter(a => a.is_active)
  const [areaId, setAreaId] = useState<string>(() => {
    const first = draft.goalIds[0] && subjectById.get(goalById.get(draft.goalIds[0])?.subject_id ?? '')?.learning_area_id
    return first || activeAreas[0]?.id || ''
  })
  const areaSubjects = subjects.filter(s => s.learning_area_id === areaId && s.is_active)
  const selected = new Set(draft.goalIds)

  function toggleGoal(id: string) {
    setDraft({ ...draft, goalIds: selected.has(id) ? draft.goalIds.filter(g => g !== id) : [...draft.goalIds, id] })
  }

  const countInArea = (aId: string) => draft.goalIds.filter(id => subjectById.get(goalById.get(id)?.subject_id ?? '')?.learning_area_id === aId).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={draft.id ? 'Edit activity' : 'New activity'} className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-surface shrink-0">
          <h2 className="text-xl font-black text-heading">{draft.id ? 'Edit activity' : 'New activity'}</h2>
          <button onClick={() => setDraft(null)} aria-label="Close" className="p-2 hover:bg-border rounded-full"><X className="w-5 h-5 text-muted" /></button>
        </div>

        <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={LABEL}>Day</span>
                <select className={INPUT} value={draft.day} onChange={e => setDraft({ ...draft, day: Number(e.target.value) })}>
                  {PLAN_DAYS.map(d => <option key={d} value={d}>{DAY_NAMES[d]} ({dayLabel(weekStart, d).split(' ')[1]})</option>)}
                </select>
              </label>
              <label>
                <span className={LABEL}>Time block</span>
                <input className={INPUT} list="lesson-plan-blocks" placeholder="e.g. Circle Time" value={draft.block} maxLength={60}
                  onChange={e => setDraft({ ...draft, block: e.target.value })} />
                <datalist id="lesson-plan-blocks">{PLAN_BLOCKS.map(b => <option key={b} value={b} />)}</datalist>
              </label>
            </div>
            <label className="block">
              <span className={LABEL}>Activity *</span>
              <input autoFocus className={INPUT} placeholder="e.g. Leaf sorting by size and color" value={draft.title} maxLength={200}
                onChange={e => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label className="block">
              <span className={LABEL}>How it works</span>
              <textarea rows={4} className={INPUT} placeholder="What the children do, and how the teacher guides it" value={draft.description}
                onChange={e => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <label className="block">
              <span className={LABEL}>Materials</span>
              <input className={INPUT} placeholder="e.g. Collected leaves, sorting trays" value={draft.materials}
                onChange={e => setDraft({ ...draft, materials: e.target.value })} />
            </label>
            {draft.goalIds.length > 0 && (
              <div>
                <span className={LABEL}>Goals ({draft.goalIds.length})</span>
                <div className="flex flex-wrap gap-1.5">
                  {draft.goalIds.map(id => {
                    const g = goalById.get(id)
                    return (
                      <button key={id} onClick={() => toggleGoal(id)} title={`${g?.name ?? ''} (click to remove)`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-50 text-brand-700 text-xs font-bold border border-brand-200 hover:border-red-300 hover:text-red-700">
                        {g?.code || g?.name.slice(0, 24) || 'Goal'} <X className="w-3 h-3" />
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col min-h-0">
            <span className={LABEL}>Goals this activity works on</span>
            {activeAreas.length === 0 ? (
              <p className="text-sm text-muted">No learning areas yet. A center admin adds them under Manage Subjects &amp; Goals.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {activeAreas.map(a => {
                    const n = countInArea(a.id)
                    return (
                      <button key={a.id} onClick={() => setAreaId(a.id)} title={a.name}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${areaId === a.id ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-text-main border-border hover:border-brand-600'}`}>
                        {a.code || a.name}{n > 0 ? ` · ${n}` : ''}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs font-semibold text-muted mb-2">{areaById.get(areaId)?.name}</p>
                <div className="space-y-3 overflow-y-auto max-h-[22rem] pr-1">
                  {areaSubjects.length === 0 && <p className="text-sm text-subtle">No subjects in this learning area.</p>}
                  {areaSubjects.map(s => {
                    const subjectGoals = goals.filter(g => g.subject_id === s.id && (g.is_active || selected.has(g.id)))
                    return (
                      <div key={s.id}>
                        <div className="text-xs font-black text-heading mb-1">{s.name}</div>
                        <div className="space-y-1">
                          {subjectGoals.length === 0 && <p className="text-xs text-subtle">No goals yet.</p>}
                          {subjectGoals.map(g => (
                            <label key={g.id} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 cursor-pointer text-sm ${selected.has(g.id) ? 'bg-brand-50' : 'hover:bg-surface'}`}>
                              <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleGoal(g.id)} className="mt-0.5 h-4 w-4 accent-brand-600 shrink-0" />
                              <span>
                                {g.code && <span className="font-bold text-brand-700 mr-1">{g.code}</span>}
                                {g.name}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-2 shrink-0">
          <button onClick={() => setDraft(null)} className={`${BTN} bg-white text-muted border border-border hover:bg-slate-50`}>Cancel</button>
          <button onClick={onSave} disabled={busy || !draft.title.trim()} className={`${BTN} bg-brand-600 text-white hover:bg-brand-800`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save activity
          </button>
        </div>
      </div>
    </div>
  )
}
