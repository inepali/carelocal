'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LessonGoal, LessonLearningArea, LessonSubject } from '@/lib/types'
import { showConfirm } from '@/lib/dialog'
import {
  Plus, Edit2, Trash2, Save, X, Loader2, ChevronDown, ChevronRight, ChevronUp, Target, Layers, BookMarked, Sparkles,
} from 'lucide-react'

type Table = 'lesson_learning_areas' | 'lesson_subjects' | 'lesson_goals'
type Row = { id: string; code?: string | null; name: string; description: string | null; is_active: boolean; sort_order: number }
type Draft = { code: string; name: string; description: string }

/** Where the inline form is open: a new row under a parent, or an existing row */
type Editing =
  | { kind: 'new'; table: Table; parentId: string | null }
  | { kind: 'edit'; table: Table; id: string }
  | null

const LABEL: Record<Table, string> = { lesson_learning_areas: 'learning area', lesson_subjects: 'subject', lesson_goals: 'goal' }
const HAS_CODE: Record<Table, boolean> = { lesson_learning_areas: true, lesson_subjects: false, lesson_goals: true }
const PARENT_KEY: Partial<Record<Table, 'learning_area_id' | 'subject_id'>> = { lesson_subjects: 'learning_area_id', lesson_goals: 'subject_id' }

const INPUT = 'w-full px-3 py-2 rounded-xl border border-brand-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/30'
const ICON_BTN = 'p-1.5 text-muted hover:text-brand-600 bg-slate-50 hover:bg-brand-50 rounded-lg transition-colors disabled:opacity-30'

const byOrder = <T extends Row>(a: T, b: T) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)

/**
 * Learning Area → Subject → Goal for one center. Admins add, edit, reorder, deactivate and delete at each level,
 * or load the NC Foundations starter set into an empty center.
 */
export default function CurriculumPanel({ centerId }: { centerId: string }) {
  const supabase = createClient()
  const [areas, setAreas] = useState<LessonLearningArea[]>([])
  const [subjects, setSubjects] = useState<LessonSubject[]>([])
  const [goals, setGoals] = useState<LessonGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Editing>(null)
  const [draft, setDraft] = useState<Draft>({ code: '', name: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(async () => {
    const [a, s, g] = await Promise.all([
      supabase.from('lesson_learning_areas').select('*').eq('center_id', centerId),
      supabase.from('lesson_subjects').select('*').eq('center_id', centerId),
      supabase.from('lesson_goals').select('*').eq('center_id', centerId),
    ])
    const err = a.error ?? s.error ?? g.error
    if (err) setError(err.message)
    setAreas(((a.data || []) as LessonLearningArea[]).sort(byOrder))
    setSubjects(((s.data || []) as LessonSubject[]).sort(byOrder))
    setGoals(((g.data || []) as LessonGoal[]).sort(byOrder))
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId])

  useEffect(() => { load() }, [load])

  const subjectsOf = (areaId: string) => subjects.filter(s => s.learning_area_id === areaId)
  const goalsOf = (subjectId: string) => goals.filter(g => g.subject_id === subjectId)
  const goalCountOfArea = (areaId: string) => subjectsOf(areaId).reduce((n, s) => n + goalsOf(s.id).length, 0)

  function toggle(id: string) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function startNew(table: Table, parentId: string | null) {
    setError('')
    setEditing({ kind: 'new', table, parentId })
    setDraft({ code: '', name: '', description: '' })
    if (parentId) setOpen(prev => new Set(prev).add(parentId))
  }

  function startEdit(table: Table, row: Row) {
    setError('')
    setEditing({ kind: 'edit', table, id: row.id })
    setDraft({ code: row.code ?? '', name: row.name, description: row.description ?? '' })
  }

  function siblings(table: Table, parentId: string | null): Row[] {
    if (table === 'lesson_learning_areas') return areas
    if (table === 'lesson_subjects') return parentId ? subjectsOf(parentId) : []
    return parentId ? goalsOf(parentId) : []
  }

  async function save() {
    if (!editing || !draft.name.trim()) return
    const { table } = editing
    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      ...(HAS_CODE[table] ? { code: draft.code.trim() || null } : {}),
    }
    setSaving(true)
    const parentKey = PARENT_KEY[table]
    const list = editing.kind === 'new' ? siblings(table, editing.parentId) : []
    const res = editing.kind === 'new'
      ? await supabase.from(table).insert({
          ...payload,
          center_id: centerId,
          sort_order: (list[list.length - 1]?.sort_order ?? -1) + 1,
          ...(parentKey ? { [parentKey]: editing.parentId } : {}),
        })
      : await supabase.from(table).update(payload).eq('id', editing.id)
    setSaving(false)
    if (res.error) {
      setError(res.error.code === '23505'
        ? `Another ${LABEL[table]} already uses the code "${draft.code.trim()}".`
        : `Couldn't save the ${LABEL[table]}: ${res.error.message}`)
      return
    }
    setEditing(null)
    load()
  }

  async function setActive(table: Table, row: Row) {
    const { error } = await supabase.from(table).update({ is_active: !row.is_active }).eq('id', row.id)
    if (error) setError(error.message); else load()
  }

  async function remove(table: Table, row: Row) {
    const below = table === 'lesson_learning_areas'
      ? ` and its ${subjectsOf(row.id).length} subjects and ${goalCountOfArea(row.id)} goals`
      : table === 'lesson_subjects' ? ` and its ${goalsOf(row.id).length} goals` : ''
    if (!await showConfirm(`Delete "${row.name}"${below}? This can't be undone. Deactivate it instead to hide it from new lesson plans.`)) return
    const { error } = await supabase.from(table).delete().eq('id', row.id)
    if (error) setError(`Couldn't delete: ${error.message}`); else load()
  }

  async function move(table: Table, list: Row[], index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= list.length) return
    const reordered = [...list]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    const changed = reordered.map((r, i) => ({ id: r.id, sort_order: i, before: r.sort_order })).filter(r => r.sort_order !== r.before)
    const results = await Promise.all(changed.map(c => supabase.from(table).update({ sort_order: c.sort_order }).eq('id', c.id)))
    if (results.some(r => r.error)) setError('Couldn\'t save the new order')
    load()
  }

  async function seed() {
    setSeeding(true)
    setError('')
    const { error } = await supabase.rpc('seed_lesson_curriculum', { p_center_id: centerId })
    setSeeding(false)
    if (error) { setError(`Couldn't load the starter set: ${error.message}`); return }
    await load()
  }

  const isEditing = (table: Table, id: string) => editing?.kind === 'edit' && editing.table === table && editing.id === id
  const isAdding = (table: Table, parentId: string | null) => editing?.kind === 'new' && editing.table === table && editing.parentId === parentId

  function form(table: Table) {
    const isGoal = table === 'lesson_goals'
    return (
      <div className="flex flex-col gap-2 p-3 bg-brand-50 rounded-xl border border-brand-200">
        <div className={`grid grid-cols-1 gap-2 ${HAS_CODE[table] ? 'sm:grid-cols-[8rem_1fr]' : ''}`}>
          {HAS_CODE[table] && (
            <input className={INPUT} placeholder={isGoal ? 'Code (APL-1)' : 'Code (APL)'} value={draft.code} maxLength={20}
              onChange={e => setDraft({ ...draft, code: e.target.value })} aria-label="Code" />
          )}
          {isGoal ? (
            <textarea autoFocus rows={2} className={INPUT} placeholder="Goal, e.g. Children show curiosity and express interest in the world around them."
              value={draft.name} maxLength={500} onChange={e => setDraft({ ...draft, name: e.target.value })} aria-label="Goal" />
          ) : (
            <input autoFocus className={INPUT} placeholder={table === 'lesson_learning_areas' ? 'Learning area, e.g. Cognitive Development' : 'Subject, e.g. Mathematical Thinking'}
              value={draft.name} maxLength={200} onChange={e => setDraft({ ...draft, name: e.target.value })} aria-label="Name"
              onKeyDown={e => { if (e.key === 'Enter') save() }} />
          )}
        </div>
        <textarea rows={2} className={INPUT} placeholder="Description (optional)" value={draft.description}
          onChange={e => setDraft({ ...draft, description: e.target.value })} aria-label="Description" />
        <div className="flex justify-end gap-2">
          <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-muted bg-white rounded-xl border border-border hover:bg-slate-50">
            <X className="w-4 h-4" /> Cancel
          </button>
          <button onClick={save} disabled={saving || !draft.name.trim()} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-white bg-brand-600 rounded-xl hover:bg-brand-800 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </div>
      </div>
    )
  }

  function actions(table: Table, row: Row, list: Row[], index: number) {
    return (
      <div className="flex items-center gap-1.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button onClick={() => move(table, list, index, -1)} disabled={index === 0} title="Move up" className={ICON_BTN}><ChevronUp className="w-4 h-4" /></button>
        <button onClick={() => move(table, list, index, 1)} disabled={index === list.length - 1} title="Move down" className={ICON_BTN}><ChevronDown className="w-4 h-4" /></button>
        <button onClick={() => setActive(table, row)} className="px-2.5 py-1 text-xs font-bold rounded-lg border border-border hover:bg-slate-50 text-muted">
          {row.is_active ? 'Deactivate' : 'Activate'}
        </button>
        <button onClick={() => startEdit(table, row)} title="Edit" className={ICON_BTN}><Edit2 className="w-4 h-4" /></button>
        <button onClick={() => remove(table, row)} title="Delete" className="p-1.5 text-muted hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
      </div>
    )
  }

  function addButton(table: Table, parentId: string | null, small = false) {
    return (
      <button onClick={() => startNew(table, parentId)}
        className={small
          ? 'inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:underline'
          : 'inline-flex items-center gap-2 bg-amber-400 text-heading font-bold px-4 py-2.5 rounded-xl hover:bg-amber-500 shadow-sm transition-all'}>
        <Plus className={small ? 'w-3.5 h-3.5' : 'w-4 h-4'} /> Add {LABEL[table]}
      </button>
    )
  }

  const totalGoals = goals.length

  return (
    <section className="bg-white border border-border rounded-3xl overflow-hidden">
      <div className="p-6 border-b border-border bg-surface/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-text-main flex items-center gap-2"><Target className="w-5 h-5 text-brand-600" /> Learning areas, subjects &amp; goals</h2>
          <p className="text-sm font-medium text-muted">
            {areas.length === 0
              ? 'What lesson plans are built from: each learning area has subjects, and each subject has goals.'
              : `${areas.length} learning areas · ${subjects.length} subjects · ${totalGoals} goals`}
          </p>
        </div>
        {areas.length > 0 && !isAdding('lesson_learning_areas', null) && addButton('lesson_learning_areas', null)}
      </div>

      <div className="p-6 space-y-3">
        {error && <div className="px-4 py-3 rounded-xl text-sm border bg-red-50 text-red-700 border-red-200">{error}</div>}

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-brand-600" /></div>
        ) : areas.length === 0 && !isAdding('lesson_learning_areas', null) ? (
          <div className="py-10 text-center">
            <Sparkles className="w-12 h-12 text-border mx-auto mb-3" />
            <p className="font-bold text-heading mb-1">Start with the NC Foundations, or build your own</p>
            <p className="text-sm text-muted max-w-lg mx-auto mb-6">
              The starter set loads the North Carolina Foundations for Early Learning and Development: 5 learning areas, 19 subjects and 54 goals. You can edit, add or remove any of them afterwards.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button onClick={seed} disabled={seeding} className="inline-flex items-center gap-2 bg-brand-600 text-white font-bold px-5 py-2.5 rounded-xl hover:bg-brand-800 disabled:opacity-60">
                {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Load NC Foundations
              </button>
              <button onClick={() => startNew('lesson_learning_areas', null)} className="inline-flex items-center gap-2 bg-white text-heading font-bold px-5 py-2.5 rounded-xl border border-border hover:border-brand-600">
                <Plus className="w-4 h-4" /> Start from scratch
              </button>
            </div>
          </div>
        ) : (
          <>
            {isAdding('lesson_learning_areas', null) && form('lesson_learning_areas')}
            {areas.map((area, ai) => {
              const areaSubjects = subjectsOf(area.id)
              const expanded = open.has(area.id)
              return (
                <div key={area.id} className={`rounded-2xl border ${area.is_active ? 'border-border' : 'border-dashed border-slate-300 bg-slate-50/60'}`}>
                  {isEditing('lesson_learning_areas', area.id) ? (
                    <div className="p-3">{form('lesson_learning_areas')}</div>
                  ) : (
                    <div className="group flex items-center gap-3 p-4">
                      <button onClick={() => toggle(area.id)} aria-expanded={expanded} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                        {expanded ? <ChevronDown className="w-5 h-5 text-muted shrink-0" /> : <ChevronRight className="w-5 h-5 text-muted shrink-0" />}
                        <Layers className="w-5 h-5 text-brand-600 shrink-0" />
                        <span className="min-w-0">
                          <span className={`font-black ${area.is_active ? 'text-heading' : 'text-subtle'}`}>
                            {area.code && <span className="mr-2 px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 text-xs font-bold border border-brand-200">{area.code}</span>}
                            {area.name}
                          </span>
                          <span className="block text-xs text-subtle mt-0.5">
                            {areaSubjects.length} subjects · {goalCountOfArea(area.id)} goals{area.is_active ? '' : ' · Inactive'}
                          </span>
                        </span>
                      </button>
                      {actions('lesson_learning_areas', area, areas, ai)}
                    </div>
                  )}

                  {expanded && (
                    <div className="border-t border-border px-4 pb-4 pt-3 space-y-3 sm:pl-12">
                      {area.description && <p className="text-sm text-text-muted whitespace-pre-line">{area.description}</p>}
                      {areaSubjects.map((subject, si) => {
                        const subjectGoals = goalsOf(subject.id)
                        return (
                          <div key={subject.id} className={`rounded-xl border p-3 ${subject.is_active ? 'border-border bg-white' : 'border-dashed border-slate-300 bg-slate-50'}`}>
                            {isEditing('lesson_subjects', subject.id) ? form('lesson_subjects') : (
                              <div className="group flex items-start gap-3">
                                <BookMarked className="w-4 h-4 mt-0.5 text-brand-600 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className={`font-bold ${subject.is_active ? 'text-text-main' : 'text-subtle'}`}>
                                    {subject.name}{subject.is_active ? '' : ' (inactive)'}
                                  </div>
                                  {subject.description && <p className="text-xs text-muted whitespace-pre-line">{subject.description}</p>}
                                </div>
                                {actions('lesson_subjects', subject, areaSubjects, si)}
                              </div>
                            )}

                            <ul className="mt-2 space-y-1.5 sm:pl-7">
                              {subjectGoals.map((goal, gi) => (
                                <li key={goal.id}>
                                  {isEditing('lesson_goals', goal.id) ? form('lesson_goals') : (
                                    <div className={`group flex items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-surface ${goal.is_active ? '' : 'opacity-60'}`}>
                                      <span className="w-16 shrink-0 text-xs font-bold text-brand-700 pt-0.5">{goal.code || '•'}</span>
                                      <span className="flex-1 min-w-0 text-sm text-text-main">
                                        {goal.name}{goal.is_active ? '' : ' (inactive)'}
                                        {goal.description && <span className="block text-xs text-muted whitespace-pre-line">{goal.description}</span>}
                                      </span>
                                      {actions('lesson_goals', goal, subjectGoals, gi)}
                                    </div>
                                  )}
                                </li>
                              ))}
                              <li className="pt-1">{isAdding('lesson_goals', subject.id) ? form('lesson_goals') : addButton('lesson_goals', subject.id, true)}</li>
                            </ul>
                          </div>
                        )
                      })}
                      {isAdding('lesson_subjects', area.id) ? form('lesson_subjects') : addButton('lesson_subjects', area.id, true)}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </section>
  )
}
