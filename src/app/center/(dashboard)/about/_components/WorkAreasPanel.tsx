'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WorkArea } from '@/lib/types'
import { Plus, Edit2, Trash2, Save, X, Loader2, Home, Users, ChevronUp, ChevronDown, Scale, LayoutGrid } from 'lucide-react'
import { showConfirm } from '@/lib/dialog'

type FormState = { name: string; ageGroup: string; capacity: string; ratio: string; minAge: string; maxAge: string; onRoster: boolean }
const EMPTY_FORM: FormState = { name: '', ageGroup: '', capacity: '', ratio: '', minAge: '', maxAge: '', onRoster: true }

/** "14 mo" / "2 y" / "2 y 6 mo" */
export function monthsLabel(m: number) {
  if (m < 24) return `${m} mo`
  const y = Math.floor(m / 12), r = m % 12
  return r ? `${y} y ${r} mo` : `${y} y`
}

const int = (s: string) => (s.trim() === '' ? null : parseInt(s, 10))

/** A plain-language problem with the roster fields, or null */
function rosterProblem(f: FormState): string | null {
  const ratio = int(f.ratio), min = int(f.minAge), max = int(f.maxAge)
  if (ratio != null && (Number.isNaN(ratio) || ratio < 1 || ratio > 50)) return 'Children per teacher must be between 1 and 50.'
  if ((min == null) !== (max == null)) return 'Give both ages, or leave both empty.'
  if (min != null && max != null) {
    if (Number.isNaN(min) || Number.isNaN(max) || min < 0) return 'Ages must be whole months, 0 or more.'
    if (max <= min) return 'The oldest age must be more than the youngest.'
  }
  return null
}

/**
 * Center-specific work areas (Classrooms / Care Areas …) managed inside Manage Data.
 * Stored in work_areas (not center_lookups) because shifts reference them by id
 * and they carry age group / capacity.
 */
export function WorkAreasPanel({ centerId, workAreaTerm, showRoster = false }: { centerId: string; workAreaTerm: string; showRoster?: boolean }) {
  const supabase = createClient()
  const [workAreas, setWorkAreas] = useState<WorkArea[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null) // 'new' or a work area id
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const term = workAreaTerm.toLowerCase()

  const loadData = useCallback(async () => {
    const { data, error } = await supabase
      .from('work_areas')
      .select('*')
      .eq('center_id', centerId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) setError(error.message)
    setWorkAreas(data || [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId])

  useEffect(() => { loadData() }, [loadData])

  function startEdit(area: WorkArea | null) {
    setError('')
    setEditing(area ? area.id : 'new')
    setForm(area ? {
      name: area.name, ageGroup: area.age_group || '', capacity: area.capacity?.toString() || '',
      ratio: area.ratio_children?.toString() ?? '', minAge: area.min_age_months?.toString() ?? '', maxAge: area.max_age_months?.toString() ?? '',
      onRoster: area.on_roster ?? true,
    } : EMPTY_FORM)
  }

  function cancelEdit() {
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    const problem = showRoster ? rosterProblem(form) : null
    if (problem) { setError(problem); return }
    setSaving(true)
    setError('')
    const payload = {
      name: form.name.trim(),
      age_group: form.ageGroup.trim() || null,
      capacity: form.capacity ? parseInt(form.capacity, 10) : null,
      ...(showRoster ? {
        ratio_children: int(form.ratio),
        min_age_months: int(form.minAge),
        max_age_months: int(form.maxAge),
        on_roster: form.onRoster,
      } : {}),
    }
    const { error } = editing === 'new'
      ? await supabase.from('work_areas').insert({ ...payload, center_id: centerId, is_active: true, sort_order: (workAreas[workAreas.length - 1]?.sort_order ?? -1) + 1 })
      : await supabase.from('work_areas').update(payload).eq('id', editing)
    setSaving(false)
    if (error) {
      setError(`Failed to save ${term}: ${error.message}`)
      return
    }
    cancelEdit()
    loadData()
  }

  async function toggleStatus(area: WorkArea) {
    const { error } = await supabase.from('work_areas').update({ is_active: !area.is_active }).eq('id', area.id)
    if (error) setError(error.message)
    else loadData()
  }

  async function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= workAreas.length) return
    const list = [...workAreas]
    ;[list[index], list[target]] = [list[target], list[index]]
    const changed = list.map((a, i) => ({ id: a.id, sort_order: i, before: a.sort_order })).filter(a => a.sort_order !== a.before)
    setWorkAreas(list.map((a, i) => ({ ...a, sort_order: i })))
    const results = await Promise.all(changed.map(c => supabase.from('work_areas').update({ sort_order: c.sort_order }).eq('id', c.id)))
    if (results.some(r => r.error)) {
      setError('Failed to save the new order')
      loadData()
    }
  }

  async function handleDelete(area: WorkArea) {
    if (!await showConfirm(`Delete "${area.name}"? Shifts assigned to it will lose their ${term}. Deactivate it instead to keep past shifts intact.`)) return
    const { error } = await supabase.from('work_areas').delete().eq('id', area.id)
    if (error) setError(`Failed to delete ${term}. It might be in use — try deactivating it instead.`)
    else loadData()
  }

  const FIELD = 'w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-600/30'
  const minA = int(form.minAge), maxA = int(form.maxAge)
  const rosterFields = showRoster && (
    <div className="w-full rounded-xl border border-brand-200 bg-white/70 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-700"><LayoutGrid className="h-3.5 w-3.5" /> Live roster</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.6fr_auto] sm:items-end">
        <label className="block text-xs font-semibold text-muted">
          Teacher : child ratio
          <span className="mt-1 flex items-center gap-2 text-sm font-bold text-text-main">
            1 :
            <input type="number" min={1} max={50} inputMode="numeric" placeholder="e.g. 4" value={form.ratio}
              onChange={e => setForm({ ...form, ratio: e.target.value })} className={FIELD} aria-label="Children per teacher" />
          </span>
        </label>
        <div className="text-xs font-semibold text-muted">
          Ages, in months
          <span className="mt-1 flex items-center gap-2">
            <input type="number" min={0} inputMode="numeric" placeholder="From" value={form.minAge}
              onChange={e => setForm({ ...form, minAge: e.target.value })} className={FIELD} aria-label="Youngest age in months" />
            <span className="text-sm font-bold text-text-main">to</span>
            <input type="number" min={1} inputMode="numeric" placeholder="Up to" value={form.maxAge}
              onChange={e => setForm({ ...form, maxAge: e.target.value })} className={FIELD} aria-label="Oldest age in months (not included)" />
          </span>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-text-main">
          <input type="checkbox" checked={form.onRoster} onChange={e => setForm({ ...form, onRoster: e.target.checked })} className="h-4 w-4 accent-brand-600" />
          Show on live roster
        </label>
      </div>
      <p className="mt-2 text-xs text-subtle">
        {minA != null && maxA != null && maxA > minA
          ? `Children from ${monthsLabel(minA)} up to (not including) ${monthsLabel(maxA)}. Use your state's ratio for this age group.`
          : 'Example: Infants 0 to 12, Toddlers 12 to 24, Twos 24 to 36. The ratio is the most children one teacher may have.'}
      </p>
    </div>
  )

  const formFields = (
    <div className="flex-1 w-full flex flex-col gap-3">
    <div className="w-full grid grid-cols-1 sm:grid-cols-[2fr_1.5fr_1fr] gap-3">
      <input
        type="text"
        autoFocus
        placeholder={`${workAreaTerm} name (e.g. Toddler Room A)`}
        value={form.name}
        onChange={e => setForm({ ...form, name: e.target.value })}
        className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
      />
      <input
        type="text"
        placeholder="Age group (e.g. 2-3 years)"
        value={form.ageGroup}
        onChange={e => setForm({ ...form, ageGroup: e.target.value })}
        className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
      />
      <input
        type="number"
        min={0}
        placeholder="Capacity"
        value={form.capacity}
        onChange={e => setForm({ ...form, capacity: e.target.value })}
        className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
      />
    </div>
    {rosterFields}
    </div>
  )

  const formButtons = (
    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
      <button onClick={handleSave} disabled={saving || !form.name.trim()} className="p-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-800 disabled:opacity-50" title="Save">
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
      </button>
      <button onClick={cancelEdit} className="p-2.5 bg-white text-muted rounded-xl border border-border hover:bg-slate-50" title="Cancel">
        <X className="w-5 h-5" />
      </button>
    </div>
  )

  return (
    <>
      <div className="p-6 border-b border-border bg-surface/50 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-text-main">{workAreaTerm}</h2>
          <p className="text-sm font-medium text-muted">
            {workAreas.filter(a => a.is_active).length} active of {workAreas.length} · used when posting shifts
          </p>
        </div>
        {editing !== 'new' && (
          <button
            onClick={() => startEdit(null)}
            className="flex items-center gap-2 bg-amber-400 text-heading font-bold px-4 py-2.5 rounded-xl hover:bg-amber-500 shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" /> Add New
          </button>
        )}
      </div>

      <div className="p-6 space-y-4">
        {error && (
          <div className="px-4 py-3 rounded-xl text-sm border bg-red-50 text-red-700 border-red-200">{error}</div>
        )}

        {editing === 'new' && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 bg-brand-50 rounded-2xl border border-brand-200">
            {formFields}
            {formButtons}
          </div>
        )}

        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
          </div>
        ) : workAreas.length === 0 && editing !== 'new' ? (
          <div className="py-12 text-center">
            <Home className="w-12 h-12 text-border mx-auto mb-3" />
            <p className="text-muted font-bold">No {term} defined yet.</p>
            <p className="text-sm text-subtle">Add your {term} to assign shifts to specific areas and age groups.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {workAreas.map((area, index) => (
              <div key={area.id} className="flex items-center justify-between p-4 bg-white border border-border rounded-2xl hover:border-brand-600 transition-colors group">
                {editing === area.id ? (
                  <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    {formFields}
                    {formButtons}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-4">
                      <div className={`w-3 h-3 rounded-full shrink-0 ${area.is_active ? 'bg-[#16a34a]' : 'bg-slate-300'}`} />
                      <div>
                        <div className={`font-bold ${area.is_active ? 'text-text-main' : 'text-subtle'}`}>{area.name}</div>
                        <div className="text-xs text-subtle mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>{area.age_group || 'Any age'}</span>
                          <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Capacity {area.capacity ?? '—'}</span>
                          {showRoster && (
                            <>
                              <span className="flex items-center gap-1"><Scale className="w-3 h-3" /> {area.ratio_children ? `1:${area.ratio_children}` : 'No ratio'}</span>
                              {area.min_age_months != null && area.max_age_months != null && <span>{monthsLabel(area.min_age_months)} – {monthsLabel(area.max_age_months)}</span>}
                              {area.on_roster === false && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-muted">Not on roster</span>}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button onClick={() => move(index, -1)} disabled={index === 0} title="Move up" className="p-1.5 text-muted hover:text-brand-600 bg-slate-50 hover:bg-brand-50 rounded-lg transition-colors disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                      <button onClick={() => move(index, 1)} disabled={index === workAreas.length - 1} title="Move down" className="p-1.5 text-muted hover:text-brand-600 bg-slate-50 hover:bg-brand-50 rounded-lg transition-colors disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                      <button
                        onClick={() => toggleStatus(area)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg border border-border hover:bg-slate-50 text-muted"
                      >
                        {area.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => startEdit(area)}
                        title="Edit"
                        className="p-1.5 text-muted hover:text-brand-600 bg-slate-50 hover:bg-brand-50 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(area)}
                        title="Delete"
                        className="p-1.5 text-muted hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
