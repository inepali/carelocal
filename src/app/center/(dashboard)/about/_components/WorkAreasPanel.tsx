'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WorkArea } from '@/lib/types'
import { Plus, Edit2, Trash2, Save, X, Loader2, Home, Users } from 'lucide-react'

type FormState = { name: string; ageGroup: string; capacity: string }
const EMPTY_FORM: FormState = { name: '', ageGroup: '', capacity: '' }

/**
 * Center-specific work areas (Classrooms / Care Areas …) managed inside Manage Data.
 * Stored in work_areas (not center_lookups) because shifts reference them by id
 * and they carry age group / capacity.
 */
export function WorkAreasPanel({ centerId, workAreaTerm }: { centerId: string; workAreaTerm: string }) {
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
    setForm(area ? { name: area.name, ageGroup: area.age_group || '', capacity: area.capacity?.toString() || '' } : EMPTY_FORM)
  }

  function cancelEdit() {
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      age_group: form.ageGroup.trim() || null,
      capacity: form.capacity ? parseInt(form.capacity, 10) : null,
    }
    const { error } = editing === 'new'
      ? await supabase.from('work_areas').insert({ ...payload, center_id: centerId, is_active: true })
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

  async function handleDelete(area: WorkArea) {
    if (!confirm(`Delete "${area.name}"? Shifts assigned to it will lose their ${term}. Deactivate it instead to keep past shifts intact.`)) return
    const { error } = await supabase.from('work_areas').delete().eq('id', area.id)
    if (error) setError(`Failed to delete ${term}. It might be in use — try deactivating it instead.`)
    else loadData()
  }

  const formFields = (
    <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-[2fr_1.5fr_1fr] gap-3">
      <input
        type="text"
        autoFocus
        placeholder={`${workAreaTerm} name (e.g. Toddler Room A)`}
        value={form.name}
        onChange={e => setForm({ ...form, name: e.target.value })}
        className="w-full px-4 py-2.5 rounded-xl border border-[#a9dac9] focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
      />
      <input
        type="text"
        placeholder="Age group (e.g. 2-3 years)"
        value={form.ageGroup}
        onChange={e => setForm({ ...form, ageGroup: e.target.value })}
        className="w-full px-4 py-2.5 rounded-xl border border-[#a9dac9] focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
      />
      <input
        type="number"
        min={0}
        placeholder="Capacity"
        value={form.capacity}
        onChange={e => setForm({ ...form, capacity: e.target.value })}
        className="w-full px-4 py-2.5 rounded-xl border border-[#a9dac9] focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
      />
    </div>
  )

  const formButtons = (
    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
      <button onClick={handleSave} disabled={saving || !form.name.trim()} className="p-2.5 bg-[#157354] text-white rounded-xl hover:bg-[#0f4a36] disabled:opacity-50" title="Save">
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
      </button>
      <button onClick={cancelEdit} className="p-2.5 bg-white text-[#6b7a73] rounded-xl border border-[#e2e8e4] hover:bg-slate-50" title="Cancel">
        <X className="w-5 h-5" />
      </button>
    </div>
  )

  return (
    <>
      <div className="p-6 border-b border-[#e2e8e4] bg-[#f8faf9]/50 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-[#1a2e25]">{workAreaTerm}</h2>
          <p className="text-sm font-medium text-[#6b7a73]">
            {workAreas.filter(a => a.is_active).length} active of {workAreas.length} · used when posting shifts
          </p>
        </div>
        {editing !== 'new' && (
          <button
            onClick={() => startEdit(null)}
            className="flex items-center gap-2 bg-[#fbbf24] text-[#0b3828] font-bold px-4 py-2.5 rounded-xl hover:bg-[#f59e0b] shadow-sm transition-all"
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 bg-[#edf7f3] rounded-2xl border border-[#a9dac9]">
            {formFields}
            {formButtons}
          </div>
        )}

        {loading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#157354]" />
          </div>
        ) : workAreas.length === 0 && editing !== 'new' ? (
          <div className="py-12 text-center">
            <Home className="w-12 h-12 text-[#e2e8e4] mx-auto mb-3" />
            <p className="text-[#6b7a73] font-bold">No {term} defined yet.</p>
            <p className="text-sm text-[#a8b5ae]">Add your {term} to assign shifts to specific areas and age groups.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {workAreas.map(area => (
              <div key={area.id} className="flex items-center justify-between p-4 bg-white border border-[#e2e8e4] rounded-2xl hover:border-[#157354] transition-colors group">
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
                        <div className={`font-bold ${area.is_active ? 'text-[#1a2e25]' : 'text-[#a8b5ae]'}`}>{area.name}</div>
                        <div className="text-xs text-[#a8b5ae] mt-0.5 flex items-center gap-3">
                          <span>{area.age_group || 'Any age'}</span>
                          <span className="flex items-center gap-1"><Users className="w-3 h-3" /> Capacity {area.capacity ?? '—'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={() => toggleStatus(area)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[#e2e8e4] hover:bg-slate-50 text-[#6b7a73]"
                      >
                        {area.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => startEdit(area)}
                        title="Edit"
                        className="p-1.5 text-[#6b7a73] hover:text-[#157354] bg-slate-50 hover:bg-[#edf7f3] rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(area)}
                        title="Delete"
                        className="p-1.5 text-[#6b7a73] hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors"
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
