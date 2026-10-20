'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Edit2, Trash2, Save, X, Loader2, Database, RotateCcw } from 'lucide-react'
import {
  LOOKUP_GROUPS, fetchLookupRows, mergeLookups, resolveLookupScope,
  type LookupGroup, type LookupItem
} from '@/lib/lookups'
import { invalidateLookupCache } from '@/hooks/use-lookups'
import type { DomainKey } from '@/lib/domain-config'
import { useCenterContext } from '../../context'
import { WorkAreasPanel } from './WorkAreasPanel'
import { showConfirm } from '@/lib/dialog'

// Work areas (Classrooms, Care Areas …) live in their own table but are managed here too
const WORK_AREAS_TAB = 'work_areas'
type ActiveTab = LookupGroup | typeof WORK_AREAS_TAB

const SOURCE_BADGE: Record<LookupItem['source'], { label: string; className: string }> = {
  default:  { label: 'Default',    className: 'bg-slate-50 text-muted border-border' },
  override: { label: 'Customized', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  custom:   { label: 'Custom',     className: 'bg-brand-50 text-brand-600 border-brand-100' },
}

function toValue(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export default function ManageDataTab() {
  const supabase = createClient()
  const { workAreaTerm } = useCenterContext()
  const [activeGroup, setActiveGroup] = useState<ActiveTab>(WORK_AREAS_TAB)

  // Deep link to a tab, e.g. ?tab=work_areas or ?tab=Payment%20Method
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    if (tab && LOOKUP_GROUPS.some(g => g.id === tab)) setActiveGroup(tab as LookupGroup)
  }, [])
  const [items, setItems] = useState<LookupItem[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<{ centerId: string; domainKey: DomainKey } | null>(null)

  // Edit / Add state ('new' = adding a custom item, otherwise the item value being edited)
  const [editing, setEditing] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Which center (and vertical) is being managed
  useEffect(() => {
    resolveLookupScope(supabase).then(resolved => {
      if (resolved?.centerId) setScope({ centerId: resolved.centerId, domainKey: resolved.domainKey })
      else setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = useCallback(async () => {
    if (!scope || activeGroup === WORK_AREAS_TAB) return
    setLoading(true)
    try {
      const rows = await fetchLookupRows(supabase, activeGroup, scope.centerId)
      setItems(mergeLookups(rows, scope.domainKey))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load items')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup, scope])

  useEffect(() => { loadData() }, [loadData])

  async function afterChange(err: { message: string } | null) {
    if (err) {
      setError(err.message.includes('center_lookups_center_unique') ? 'An item with that value already exists.' : err.message)
      return false
    }
    invalidateLookupCache(activeGroup)
    await loadData()
    return true
  }

  function startEdit(item: LookupItem | null) {
    setError('')
    setEditing(item ? item.value : 'new')
    setEditLabel(item?.label || '')
    setEditValue(item?.value || '')
  }

  function cancelEdit() {
    setEditing(null)
    setEditLabel('')
    setEditValue('')
  }

  async function handleSave() {
    if (!editLabel.trim() || !scope) return
    setSaving(true)

    let err: { message: string } | null = null
    if (editing === 'new') {
      const { error } = await supabase.from('center_lookups').insert({
        center_id: scope.centerId,
        group_name: activeGroup,
        label: editLabel.trim(),
        value: editValue.trim() || toValue(editLabel),
        is_active: true,
        sort_order: (items[items.length - 1]?.sort_order ?? 0) + 1,
        domain_key: scope.domainKey,
      })
      err = error
    } else {
      const item = items.find(i => i.value === editing)
      if (item?.centerRowId) {
        // Overrides keep the default's value; custom items may change it
        const { error } = await supabase.from('center_lookups').update({
          label: editLabel.trim(),
          ...(item.source === 'custom' ? { value: editValue.trim() || toValue(editLabel) } : {}),
        }).eq('id', item.centerRowId)
        err = error
      } else if (item) {
        // First edit of a platform default: store a center override
        const { error } = await supabase.from('center_lookups').insert({
          center_id: scope.centerId,
          group_name: activeGroup,
          label: editLabel.trim(),
          value: item.value,
          is_active: item.is_active,
          sort_order: item.sort_order,
          domain_key: scope.domainKey,
        })
        err = error
      }
    }

    if (await afterChange(err)) cancelEdit()
    setSaving(false)
  }

  async function toggleStatus(item: LookupItem) {
    if (!scope) return
    const { error } = item.centerRowId
      ? await supabase.from('center_lookups').update({ is_active: !item.is_active }).eq('id', item.centerRowId)
      : await supabase.from('center_lookups').insert({
          center_id: scope.centerId,
          group_name: activeGroup,
          label: item.label,
          value: item.value,
          is_active: !item.is_active,
          sort_order: item.sort_order,
          domain_key: scope.domainKey,
        })
    await afterChange(error)
  }

  async function handleRemove(item: LookupItem) {
    if (!item.centerRowId) return
    const message = item.source === 'override'
      ? `Reset "${item.label}" to the platform default "${item.defaultRow?.label}"?`
      : `Delete "${item.label}"? Records already using it will show its raw value.`
    if (!await showConfirm(message)) return
    const { error } = await supabase.from('center_lookups').delete().eq('id', item.centerRowId)
    await afterChange(error)
  }

  const groupLabel = LOOKUP_GROUPS.find(g => g.id === activeGroup)?.label
  const tabs: { id: ActiveTab; label: string }[] = [{ id: WORK_AREAS_TAB, label: workAreaTerm }, ...LOOKUP_GROUPS]

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-black text-heading tracking-tight mb-2 flex items-center gap-3">
          <Database className="w-7 h-7 text-brand-600" /> Manage System Data
        </h2>
        <p className="text-muted font-medium">
          Configure the dropdowns and choices used across your center. Platform defaults can be renamed or
          deactivated for your center without affecting anyone else.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar Tabs */}
        <div className="w-full md:w-64 shrink-0 space-y-2">
          {tabs.map(group => (
            <button
              key={group.id}
              onClick={() => { setActiveGroup(group.id); cancelEdit(); setError('') }}
              className={`w-full text-left px-5 py-3.5 rounded-xl font-bold transition-all ${
                activeGroup === group.id
                  ? 'bg-brand-600 text-white shadow-md'
                  : 'bg-white text-muted border border-border hover:bg-brand-50 hover:text-brand-600 hover:border-brand-600'
              }`}
            >
              {group.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-white rounded-3xl border border-border overflow-hidden shadow-sm">
          {activeGroup === WORK_AREAS_TAB ? (
            scope && <WorkAreasPanel centerId={scope.centerId} workAreaTerm={workAreaTerm} />
          ) : (
          <>
          <div className="p-6 border-b border-border bg-surface/50 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-text-main">{groupLabel}</h2>
              <p className="text-sm font-medium text-muted">{items.filter(i => i.is_active).length} active of {items.length}</p>
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
                <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Label (e.g., Certification)"
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
                  />
                  <input
                    type="text"
                    placeholder={`Value (auto: ${toValue(editLabel) || 'certification'})`}
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-600/30 font-mono text-sm"
                  />
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button onClick={handleSave} disabled={saving || !editLabel.trim()} className="p-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-800 disabled:opacity-50">
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  </button>
                  <button onClick={cancelEdit} className="p-2.5 bg-white text-muted rounded-xl border border-border hover:bg-slate-50">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
              </div>
            ) : items.length === 0 && editing !== 'new' ? (
              <div className="py-12 text-center">
                <Database className="w-12 h-12 text-border mx-auto mb-3" />
                <p className="text-muted font-bold">No items found for this group.</p>
                <p className="text-sm text-subtle">Click &quot;Add New&quot; to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map(item => {
                  const badge = SOURCE_BADGE[item.source]
                  return (
                    <div key={item.value} className="flex items-center justify-between p-4 bg-white border border-border rounded-2xl hover:border-brand-600 transition-colors group">
                      {editing === item.value ? (
                        <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-3 mr-4">
                          <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              type="text"
                              autoFocus
                              placeholder="Label"
                              value={editLabel}
                              onChange={e => setEditLabel(e.target.value)}
                              className="w-full px-4 py-2 rounded-xl border border-brand-600 focus:outline-none"
                            />
                            <input
                              type="text"
                              placeholder="Value"
                              value={editValue}
                              disabled={item.source !== 'custom'}
                              title={item.source !== 'custom' ? 'The value of a platform default cannot change' : undefined}
                              onChange={e => setEditValue(e.target.value)}
                              className="w-full px-4 py-2 rounded-xl border border-brand-600 focus:outline-none font-mono text-sm disabled:border-border disabled:bg-slate-50 disabled:text-subtle"
                            />
                          </div>
                          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                            <button onClick={handleSave} disabled={saving || !editLabel.trim()} className="p-2 bg-brand-600 text-white rounded-lg hover:bg-brand-800 disabled:opacity-50">
                              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            </button>
                            <button onClick={cancelEdit} className="p-2 bg-slate-100 text-muted rounded-lg hover:bg-slate-200">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-4">
                          <div className={`w-3 h-3 rounded-full shrink-0 ${item.is_active ? 'bg-[#16a34a]' : 'bg-slate-300'}`} />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`font-bold ${item.is_active ? 'text-text-main' : 'text-subtle'}`}>{item.label}</span>
                              <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${badge.className}`}>{badge.label}</span>
                            </div>
                            <div className="text-xs text-subtle font-mono mt-0.5">
                              {item.value}
                              {item.source === 'override' && item.defaultRow && item.defaultRow.label !== item.label && (
                                <span className="font-sans"> · default: {item.defaultRow.label}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {editing !== item.value && (
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={() => toggleStatus(item)}
                            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-border hover:bg-slate-50 text-muted"
                          >
                            {item.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => startEdit(item)}
                            title="Edit"
                            className="p-1.5 text-muted hover:text-brand-600 bg-slate-50 hover:bg-brand-50 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {item.source === 'override' && (
                            <button
                              onClick={() => handleRemove(item)}
                              title="Reset to default"
                              className="p-1.5 text-muted hover:text-amber-700 bg-slate-50 hover:bg-amber-50 rounded-lg transition-colors"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          {item.source === 'custom' && (
                            <button
                              onClick={() => handleRemove(item)}
                              title="Delete"
                              className="p-1.5 text-muted hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  )
}
