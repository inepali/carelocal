'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Edit2, Trash2, Loader2, X, ArrowUp, ArrowDown, type LucideIcon } from 'lucide-react'
import { showAlert, showConfirm } from '@/lib/dialog'
import { normalizeWebUrl } from '@/lib/utils'

export type AboutField = {
  key: string
  label: string
  type?: 'text' | 'email' | 'number' | 'textarea' | 'checkbox' | 'select' | 'url'
  /** Choices for type 'select' (the placeholder becomes the empty option) */
  options?: { value: string; label: string }[]
  placeholder?: string
  required?: boolean
  half?: boolean
}

type AboutRow = { id: string; sort_order: number; [key: string]: unknown }

type AboutListEditorProps<T extends AboutRow> = {
  table: 'center_programs' | 'center_team_members' | 'center_about_items'
  centerId: string
  itemLabel: string
  icon: LucideIcon
  description: string
  emptyTitle: string
  emptyText: string
  fields: AboutField[]
  defaults?: Record<string, unknown>
  layout?: 'grid' | 'list'
  renderItem: (item: T) => ReactNode
}

export default function AboutListEditor<T extends AboutRow>({
  table,
  centerId,
  itemLabel,
  icon: Icon,
  description,
  emptyTitle,
  emptyText,
  fields,
  defaults = {},
  layout = 'grid',
  renderItem,
}: AboutListEditorProps<T>) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<T[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<T | null>(null)
  const [form, setForm] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)

  async function fetchItems() {
    const { data } = await supabase
      .from(table)
      .select('*')
      .eq('center_id', centerId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    return (data as T[]) || []
  }

  async function loadData() {
    setItems(await fetchItems())
  }

  useEffect(() => {
    let ignore = false
    fetchItems().then(data => {
      if (ignore) return
      setItems(data)
      setLoading(false)
    })
    return () => { ignore = true }
  }, [centerId])

  function openModal(item: T | null = null) {
    setEditingItem(item)
    const initial: Record<string, unknown> = {}
    for (const field of fields) {
      const value = item ? item[field.key] : defaults[field.key]
      initial[field.key] = field.type === 'checkbox' ? Boolean(value ?? true) : (value ?? '')
    }
    setForm(initial)
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const payload: Record<string, unknown> = {}
    for (const field of fields) {
      const value = form[field.key]
      if (field.type === 'checkbox') {
        payload[field.key] = Boolean(value)
      } else if (field.type === 'number') {
        payload[field.key] = value === '' || value == null ? null : parseInt(String(value), 10)
      } else if (field.type === 'url') {
        const text = String(value ?? '').trim()
        const normalized = normalizeWebUrl(text)
        if (text && !normalized) {
          showAlert(`${field.label} must be a valid web address, for example https://www.yourcenter.com/enroll`)
          setSaving(false)
          return
        }
        payload[field.key] = normalized
      } else {
        const text = String(value ?? '').trim()
        payload[field.key] = text === '' ? null : text
      }
    }

    let error
    if (editingItem) {
      const { error: err } = await supabase
        .from(table)
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editingItem.id)
      error = err
    } else {
      const nextOrder = items.length ? Math.max(...items.map(i => i.sort_order)) + 1 : 0
      const { error: err } = await supabase
        .from(table)
        .insert({ ...payload, center_id: centerId, sort_order: nextOrder })
      error = err
    }

    if (!error) {
      setIsModalOpen(false)
      loadData()
    } else {
      showAlert(`Failed to save ${itemLabel.toLowerCase()}: ${error.message}`)
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!await showConfirm(`Are you sure you want to delete this ${itemLabel.toLowerCase()}?`)) return

    const { error } = await supabase.from(table).delete().eq('id', id)
    if (!error) {
      loadData()
    } else {
      showAlert(`Failed to delete ${itemLabel.toLowerCase()}: ${error.message}`)
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= items.length) return

    // Renumber the whole list so legacy rows with duplicate sort_order values still reorder correctly.
    const reordered = [...items]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    setItems(reordered)

    const results = await Promise.all(
      reordered.map((item, i) =>
        item.sort_order === i
          ? Promise.resolve({ error: null })
          : supabase.from(table).update({ sort_order: i }).eq('id', item.id)
      )
    )
    if (results.some(r => r.error)) showAlert(`Failed to reorder ${itemLabel.toLowerCase()} list.`)
    loadData()
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-pulse">
        {[1, 2].map(i => <div key={i} className="h-40 bg-white rounded-3xl border border-slate-100 shadow-sm"></div>)}
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <p className="text-muted">{description}</p>
        <button
          onClick={() => openModal()}
          className="inline-flex items-center justify-center gap-2 bg-amber-400 text-heading font-bold px-6 py-3 rounded-xl hover:bg-amber-500 shadow-sm transition-all active:scale-95 shrink-0"
        >
          <Plus className="w-5 h-5" /> Add {itemLabel}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="py-20 bg-white border border-dashed border-brand-200 rounded-[2.5rem] text-center">
          <Icon className="w-16 h-16 text-border mx-auto mb-4" />
          <h3 className="text-xl font-bold text-heading mb-2">{emptyTitle}</h3>
          <p className="text-muted max-w-sm mx-auto mb-6">{emptyText}</p>
          <button onClick={() => openModal()} className="text-brand-600 font-bold hover:underline">Add your first {itemLabel.toLowerCase()} →</button>
        </div>
      ) : (
        <div className={layout === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-6' : 'space-y-4'}>
          {items.map((item, index) => (
            <div key={item.id} className="bg-white border border-border rounded-[2rem] p-6 shadow-sm hover:shadow-lg transition-all duration-300 group">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shadow-sm shrink-0">
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">{renderItem(item)}</div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => handleMove(index, -1)} disabled={index === 0} aria-label="Move up" title="Move up" className="p-2 text-muted hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors disabled:opacity-30 disabled:pointer-events-none">
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleMove(index, 1)} disabled={index === items.length - 1} aria-label="Move down" title="Move down" className="p-2 text-muted hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors disabled:opacity-30 disabled:pointer-events-none">
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button onClick={() => openModal(item)} aria-label={`Edit ${itemLabel}`} title="Edit" className="p-2 text-muted hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(item.id)} aria-label={`Delete ${itemLabel}`} title="Delete" className="p-2 text-muted hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
            <div className="p-8 border-b border-border flex items-center justify-between bg-surface shrink-0">
              <h2 className="text-2xl font-black text-heading tracking-tight">{editingItem ? `Edit ${itemLabel}` : `New ${itemLabel}`}</h2>
              <button onClick={() => setIsModalOpen(false)} aria-label="Close" className="p-2 hover:bg-border rounded-full transition-colors"><X className="w-5 h-5 text-muted" /></button>
            </div>

            <form onSubmit={handleSave} className="p-8 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                {fields.map((field, i) => (
                  <div key={field.key} className={field.half ? 'col-span-2 sm:col-span-1' : 'col-span-2'}>
                    {field.type === 'checkbox' ? (
                      <label className="flex items-center gap-3 text-sm font-medium text-text-main cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(form[field.key])}
                          onChange={(e) => setForm({ ...form, [field.key]: e.target.checked })}
                          className="w-4 h-4 accent-brand-600"
                        />
                        {field.label}
                      </label>
                    ) : (
                      <>
                        <label className="block font-bold text-text-main mb-2 uppercase tracking-widest text-[10px]">{field.label}</label>
                        {field.type === 'select' ? (
                          <select
                            required={field.required}
                            value={String(form[field.key] ?? '')}
                            onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                            className="w-full px-5 py-4 rounded-2xl border border-border bg-white focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-medium"
                          >
                            <option value="">{field.placeholder || 'Select…'}</option>
                            {(field.options ?? []).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            {/* Keep a value that is no longer an active option selectable */}
                            {String(form[field.key] ?? '') !== '' && !(field.options ?? []).some(o => o.value === form[field.key]) && (
                              <option value={String(form[field.key])}>{String(form[field.key])}</option>
                            )}
                          </select>
                        ) : field.type === 'textarea' ? (
                          <textarea
                            rows={5}
                            required={field.required}
                            value={String(form[field.key] ?? '')}
                            onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                            placeholder={field.placeholder}
                            className="w-full px-5 py-4 rounded-2xl border border-border focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-medium resize-y"
                          />
                        ) : (
                          <input
                            autoFocus={i === 0}
                            type={field.type === 'url' ? 'text' : field.type || 'text'}
                            inputMode={field.type === 'url' ? 'url' : undefined}
                            min={field.type === 'number' ? 0 : undefined}
                            required={field.required}
                            value={String(form[field.key] ?? '')}
                            onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                            placeholder={field.placeholder}
                            className="w-full px-5 py-4 rounded-2xl border border-border focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-medium"
                          />
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-4 px-6 rounded-2xl border border-border font-bold text-muted hover:bg-surface transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-3 bg-brand-600 text-white font-bold py-4 px-10 rounded-2xl hover:bg-brand-800 shadow-lg shadow-brand-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
