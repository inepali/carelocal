'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ALL_SLOTS, COMMON_ALLERGENS, COMPONENTS, COMPONENT_LABELS, SLOT_LABELS, SLOT_STYLE,
  type FoodComponent, type FoodItem, type MealPreset, type MealSlot, presetFoods,
} from '@/lib/menu'
import { checkMeal } from '@/lib/cacfp'
import { showAlert, showConfirm } from '@/lib/dialog'
import { ArrowLeft, Plus, Edit2, Trash2, X, Save, Sparkles, Loader2, Search, ArrowUp, ArrowDown, CheckCircle2, AlertTriangle, Utensils } from 'lucide-react'
import type { useMenuLibrary } from './useMenuData'

type Lib = ReturnType<typeof useMenuLibrary>

const INPUT = 'w-full px-3 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600'
const LABEL = 'block font-bold text-text-main mb-1.5 uppercase tracking-widest text-[10px]'
const BTN = 'inline-flex items-center justify-center gap-2 font-bold px-4 py-2.5 rounded-xl text-sm transition-all disabled:opacity-50'

type FoodDraft = { id: string | null; name: string; component: FoodComponent; whole_grain_rich: boolean; grain_dessert: boolean; allergens: string[]; is_active: boolean }
type PresetDraft = { id: string | null; name: string; meal_types: MealSlot[]; notes: string; is_active: boolean; items: { food_item_id: string; serving_note: string }[] }

/** Editors manage the meals the center serves, its foods and its meal presets */
export default function MenuLibrary({ centerId, lib, onBack }: { centerId: string; lib: Lib; onBack: () => void }) {
  const { supabase, foods, foodMap, presets, settings, reload } = lib
  const [foodDraft, setFoodDraft] = useState<FoodDraft | null>(null)
  const [presetDraft, setPresetDraft] = useState<PresetDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [foodQuery, setFoodQuery] = useState('')

  async function seed() {
    setBusy(true)
    const { data, error } = await supabase.rpc('seed_menu_library', { p_center_id: centerId })
    setBusy(false)
    if (error) { showAlert(error.message); return }
    showAlert(`Added starter foods and ${data} meal presets. Edit them to match your kitchen.`)
    reload()
  }

  async function toggleSlot(slot: MealSlot) {
    const next = settings.slots.includes(slot) ? settings.slots.filter(s => s !== slot) : ALL_SLOTS.filter(s => s === slot || settings.slots.includes(s))
    if (next.length === 0) { showAlert('Serve at least one meal.'); return }
    const { data, error } = await supabase.from('centers').update({ menu_slots: next }).eq('id', centerId).select('id')
    if (error) { showAlert(error.message); return }
    if (!data?.length) { showAlert('Only the center owner or an administrator can change which meals are served.'); return }
    reload()
  }

  // ── Foods ────────────────────────────────────────────────────────────────────────────────────────────────
  async function saveFood() {
    if (!foodDraft) return
    const name = foodDraft.name.trim()
    if (!name) { showAlert('Give the food a name.'); return }
    const isGrain = foodDraft.component === 'grain'
    const row = {
      center_id: centerId, name, component: foodDraft.component,
      whole_grain_rich: isGrain && foodDraft.whole_grain_rich, grain_dessert: isGrain && foodDraft.grain_dessert,
      allergens: foodDraft.allergens.map(a => a.trim().toLowerCase()).filter(Boolean), is_active: foodDraft.is_active,
    }
    setBusy(true)
    const { error } = foodDraft.id
      ? await supabase.from('menu_food_items').update(row).eq('id', foodDraft.id)
      : await supabase.from('menu_food_items').insert({ ...row, sort_order: foods.length + 1 })
    setBusy(false)
    if (error) { showAlert(error.code === '23505' ? 'There is already a food with that name.' : error.message); return }
    setFoodDraft(null)
    reload()
  }

  async function deleteFood(food: FoodItem) {
    if (!await showConfirm(`Delete “${food.name}”?`, { confirmLabel: 'Delete' })) return
    const { error } = await supabase.from('menu_food_items').delete().eq('id', food.id)
    if (error?.code === '23503') {
      if (await showConfirm(`“${food.name}” is used in a preset, so it can’t be deleted. Hide it from new presets instead?`, { confirmLabel: 'Hide it' })) {
        await supabase.from('menu_food_items').update({ is_active: false }).eq('id', food.id)
        reload()
      }
      return
    }
    if (error) { showAlert(error.message); return }
    reload()
  }

  // ── Presets ──────────────────────────────────────────────────────────────────────────────────────────────
  async function savePreset() {
    if (!presetDraft) return
    const name = presetDraft.name.trim()
    if (!name) { showAlert('Give the preset a name.'); return }
    if (presetDraft.meal_types.length === 0) { showAlert('Pick at least one meal this preset is for.'); return }
    if (presetDraft.items.length === 0) { showAlert('Add at least one food.'); return }
    setBusy(true)
    const row = { center_id: centerId, name, meal_types: presetDraft.meal_types, notes: presetDraft.notes.trim() || null, is_active: presetDraft.is_active }
    let id = presetDraft.id
    if (id) {
      const { error } = await supabase.from('menu_presets').update(row).eq('id', id)
      if (error) { setBusy(false); showAlert(error.message); return }
      const { error: delErr } = await supabase.from('menu_preset_items').delete().eq('preset_id', id)
      if (delErr) { setBusy(false); showAlert(delErr.message); return }
    } else {
      const { data, error } = await supabase.from('menu_presets').insert({ ...row, sort_order: presets.length + 1 }).select('id').single()
      if (error) { setBusy(false); showAlert(error.message); return }
      id = data.id as string
    }
    const { error: itemErr } = await supabase.from('menu_preset_items').insert(presetDraft.items.map((it, i) => ({
      preset_id: id, food_item_id: it.food_item_id, center_id: centerId, serving_note: it.serving_note.trim() || null, sort_order: i + 1,
    })))
    if (itemErr) { setBusy(false); showAlert(itemErr.message); return }
    // Draft months pick up the new foods; published months keep what was announced
    if (presetDraft.id) await supabase.rpc('menu_refresh_preset', { p_preset_id: id })
    setBusy(false)
    setPresetDraft(null)
    reload()
  }

  async function deletePreset(p: MealPreset) {
    if (!await showConfirm(`Delete the preset “${p.name}”? Menus that already use it keep their foods.`, { confirmLabel: 'Delete' })) return
    const { error } = await supabase.from('menu_presets').delete().eq('id', p.id)
    if (error) { showAlert(error.message); return }
    reload()
  }

  const grouped = useMemo(() => COMPONENTS.map(c => ({
    component: c,
    items: foods.filter(f => f.component === c && (!foodQuery.trim() || f.name.toLowerCase().includes(foodQuery.trim().toLowerCase()))),
  })).filter(g => g.items.length), [foods, foodQuery])

  return (
    <div className="space-y-8">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-brand-600">
        <ArrowLeft className="w-4 h-4" /> Back to calendar
      </button>

      {/* Meals served */}
      <section className="bg-white border border-border rounded-3xl p-6">
        <h2 className="text-xl font-black text-text-main mb-1">Meals you serve</h2>
        <p className="text-sm text-muted mb-4">These are the rows on each day of the calendar.</p>
        <div className="flex flex-wrap gap-2">
          {ALL_SLOTS.map(s => {
            const on = settings.slots.includes(s)
            return (
              <button key={s} onClick={() => toggleSlot(s)} aria-pressed={on}
                className={`px-3 py-2 rounded-xl text-sm font-bold border transition-colors ${on ? SLOT_STYLE[s] : 'bg-white text-subtle border-dashed border-border hover:border-brand-200'}`}>
                {on ? '✓ ' : ''}{SLOT_LABELS[s]}
              </button>
            )
          })}
        </div>
      </section>

      {foods.length === 0 && (
        <section className="bg-brand-50 border border-brand-200 rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-black text-brand-900">Start with a sample library?</h2>
            <p className="text-sm text-brand-800">27 common foods with their CACFP components and allergens, and 11 presets like “Pancake, Banana, Milk”. Edit or delete anything.</p>
          </div>
          <button disabled={busy} onClick={seed} className={`${BTN} bg-brand-600 text-white hover:bg-brand-700 shrink-0`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Add starter library
          </button>
        </section>
      )}

      {/* Presets */}
      <section className="bg-white border border-border rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-border bg-surface/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-text-main flex items-center gap-2"><Utensils className="w-5 h-5 text-brand-600" /> Meal presets</h2>
            <p className="text-sm text-muted">What you drag onto the calendar. Each preset says which meals it can be served at.</p>
          </div>
          <button disabled={foods.length === 0} onClick={() => setPresetDraft({ id: null, name: '', meal_types: [], notes: '', is_active: true, items: [] })}
            className={`${BTN} bg-brand-600 text-white hover:bg-brand-700`}><Plus className="w-4 h-4" /> New preset</button>
        </div>
        {presets.length === 0 ? <p className="p-8 text-center text-sm text-muted">No presets yet.</p> : (
          <ul className="divide-y divide-border">
            {presets.map(p => {
              const pf = presetFoods(p, foodMap)
              const checks = settings.cacfpEnabled ? p.meal_types.map(s => ({ s, c: checkMeal(s, pf) })) : []
              return (
                <li key={p.id} className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className={`font-bold ${p.is_active ? 'text-text-main' : 'text-subtle line-through'}`}>{p.name}</div>
                    <div className="text-xs text-muted truncate">{pf.map(f => f.name + (f.serving_note ? ` (${f.serving_note})` : '')).join(', ') || 'No foods'}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {p.meal_types.map(s => {
                      const c = checks.find(x => x.s === s)?.c
                      return (
                        <span key={s} title={c && !c.ok ? c.problems.join(' · ') : undefined}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border ${SLOT_STYLE[s]}`}>
                          {c && (c.ok ? <CheckCircle2 className="w-3 h-3 text-brand-600" /> : <AlertTriangle className="w-3 h-3 text-amber-600" />)}
                          {SLOT_LABELS[s]}
                        </span>
                      )
                    })}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setPresetDraft({
                      id: p.id, name: p.name, meal_types: p.meal_types, notes: p.notes ?? '', is_active: p.is_active,
                      items: [...p.items].sort((a, b) => a.sort_order - b.sort_order).map(i => ({ food_item_id: i.food_item_id, serving_note: i.serving_note ?? '' })),
                    })} className="p-2 rounded-lg text-muted hover:text-brand-600 hover:bg-surface" aria-label={`Edit ${p.name}`}><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => deletePreset(p)} className="p-2 rounded-lg text-muted hover:text-red-600 hover:bg-red-50" aria-label={`Delete ${p.name}`}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Foods */}
      <section className="bg-white border border-border rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-border bg-surface/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-text-main">Foods</h2>
            <p className="text-sm text-muted">The building blocks of presets{settings.cacfpEnabled ? ', with the CACFP component each one credits toward' : ''}.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
              <input value={foodQuery} onChange={e => setFoodQuery(e.target.value)} placeholder="Search foods" className={`${INPUT} pl-9 py-2 w-44`} />
            </div>
            <button onClick={() => setFoodDraft({ id: null, name: '', component: 'fruit', whole_grain_rich: false, grain_dessert: false, allergens: [], is_active: true })}
              className={`${BTN} bg-brand-600 text-white hover:bg-brand-700`}><Plus className="w-4 h-4" /> New food</button>
          </div>
        </div>
        {grouped.length === 0 ? <p className="p-8 text-center text-sm text-muted">{foods.length ? 'No foods match.' : 'No foods yet.'}</p> : (
          <div className="divide-y divide-border">
            {grouped.map(g => (
              <div key={g.component} className="p-4 sm:px-6">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-subtle mb-2">{COMPONENT_LABELS[g.component]}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map(f => (
                    <span key={f.id} className={`group inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg text-xs font-semibold border ${f.is_active ? 'bg-white border-border text-text-main' : 'bg-slate-50 border-slate-200 text-subtle line-through'}`}>
                      {f.name}
                      {f.whole_grain_rich && <span className="text-[9px] font-black text-brand-700 bg-brand-50 rounded px-1">WGR</span>}
                      {f.grain_dessert && <span className="text-[9px] font-black text-amber-700 bg-amber-50 rounded px-1">DESSERT</span>}
                      {f.allergens.length > 0 && <span className="text-[9px] font-bold text-amber-800" title={`Contains ${f.allergens.join(', ')}`}>⚠ {f.allergens.length}</span>}
                      <button onClick={() => setFoodDraft({ id: f.id, name: f.name, component: f.component, whole_grain_rich: f.whole_grain_rich, grain_dessert: f.grain_dessert, allergens: f.allergens, is_active: f.is_active })}
                        className="p-0.5 rounded text-subtle hover:text-brand-600" aria-label={`Edit ${f.name}`}><Edit2 className="w-3 h-3" /></button>
                      <button onClick={() => deleteFood(f)} className="p-0.5 rounded text-subtle hover:text-red-600" aria-label={`Delete ${f.name}`}><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {foodDraft && <FoodForm draft={foodDraft} setDraft={setFoodDraft} busy={busy} onSave={saveFood} />}
      {presetDraft && <PresetForm draft={presetDraft} setDraft={setPresetDraft} busy={busy} onSave={savePreset}
        foods={foods} foodMap={foodMap} servedSlots={settings.slots} cacfp={settings.cacfpEnabled} />}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-black text-text-main">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>, document.body)
}

function FoodForm({ draft, setDraft, busy, onSave }: {
  draft: FoodDraft; setDraft: (d: FoodDraft | null) => void; busy: boolean; onSave: () => void
}) {
  const [custom, setCustom] = useState('')
  const toggle = (a: string) => setDraft({ ...draft, allergens: draft.allergens.includes(a) ? draft.allergens.filter(x => x !== a) : [...draft.allergens, a] })
  const extras = draft.allergens.filter(a => !COMMON_ALLERGENS.includes(a))
  return (
    <Modal title={draft.id ? 'Edit food' : 'New food'} onClose={() => setDraft(null)}>
      <div className="space-y-4">
        <div>
          <label className={LABEL} htmlFor="food-name">Name</label>
          <input id="food-name" autoFocus value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={INPUT} placeholder="e.g. Whole-wheat pancake" maxLength={120} />
        </div>
        <div>
          <label className={LABEL} htmlFor="food-component">Counts as</label>
          <select id="food-component" value={draft.component} onChange={e => setDraft({ ...draft, component: e.target.value as FoodComponent })} className={INPUT}>
            {COMPONENTS.map(c => <option key={c} value={c}>{COMPONENT_LABELS[c]}</option>)}
          </select>
        </div>
        {draft.component === 'grain' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-text-main">
              <input type="checkbox" checked={draft.whole_grain_rich} onChange={e => setDraft({ ...draft, whole_grain_rich: e.target.checked })} /> Whole grain-rich
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-text-main">
              <input type="checkbox" checked={draft.grain_dessert} onChange={e => setDraft({ ...draft, grain_dessert: e.target.checked })} /> Grain-based dessert (cookies, cake, sweet rolls; doesn&apos;t count as a grain)
            </label>
          </div>
        )}
        <div>
          <span className={LABEL}>Allergens</span>
          <div className="flex flex-wrap gap-1.5">
            {[...COMMON_ALLERGENS, ...extras].map(a => (
              <button key={a} type="button" onClick={() => toggle(a)} aria-pressed={draft.allergens.includes(a)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${draft.allergens.includes(a) ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-white text-muted border-border'}`}>{a}</button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="Other allergen" className={`${INPUT} py-2`}
              onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) { e.preventDefault(); toggle(custom.trim().toLowerCase()); setCustom('') } }} />
            <button type="button" disabled={!custom.trim()} onClick={() => { toggle(custom.trim().toLowerCase()); setCustom('') }} className={`${BTN} bg-white border border-border py-2`}>Add</button>
          </div>
        </div>
        {draft.id && (
          <label className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <input type="checkbox" checked={draft.is_active} onChange={e => setDraft({ ...draft, is_active: e.target.checked })} /> Available for new presets
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={() => setDraft(null)} className={`${BTN} bg-white border border-border`}>Cancel</button>
          <button disabled={busy} onClick={onSave} className={`${BTN} bg-brand-600 text-white hover:bg-brand-700`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save</button>
        </div>
      </div>
    </Modal>
  )
}

function PresetForm({ draft, setDraft, busy, onSave, foods, foodMap, servedSlots, cacfp }: {
  draft: PresetDraft; setDraft: (d: PresetDraft | null) => void; busy: boolean; onSave: () => void
  foods: FoodItem[]; foodMap: Map<string, FoodItem>; servedSlots: MealSlot[]; cacfp: boolean
}) {
  const [q, setQ] = useState('')
  const chosen = new Set(draft.items.map(i => i.food_item_id))
  const matches = foods.filter(f => f.is_active && !chosen.has(f.id) && (!q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 8)
  const move = (i: number, d: number) => {
    const items = [...draft.items]
    const j = i + d
    if (j < 0 || j >= items.length) return
    ;[items[i], items[j]] = [items[j], items[i]]
    setDraft({ ...draft, items })
  }
  const asFoods = draft.items.map(i => foodMap.get(i.food_item_id)).filter((f): f is FoodItem => !!f)
    .map(f => ({ food_item_id: f.id, name: f.name, component: f.component, whole_grain_rich: f.whole_grain_rich, grain_dessert: f.grain_dessert, allergens: f.allergens, serving_note: null }))
  // Offer the meals the center serves first, then any already chosen
  const slotChoices = ALL_SLOTS.filter(s => servedSlots.includes(s) || draft.meal_types.includes(s))
  return (
    <Modal title={draft.id ? 'Edit preset' : 'New preset'} onClose={() => setDraft(null)}>
      <div className="space-y-4">
        <div>
          <label className={LABEL} htmlFor="preset-name">Name</label>
          <input id="preset-name" autoFocus value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={INPUT} placeholder="e.g. Pancake, Banana, Milk" maxLength={200} />
        </div>
        <div>
          <span className={LABEL}>Served at</span>
          <div className="flex flex-wrap gap-1.5">
            {slotChoices.map(s => {
              const on = draft.meal_types.includes(s)
              const c = cacfp && on ? checkMeal(s, asFoods) : null
              return (
                <button key={s} type="button" aria-pressed={on} title={c && !c.ok ? c.problems.join(' · ') : undefined}
                  onClick={() => setDraft({ ...draft, meal_types: on ? draft.meal_types.filter(x => x !== s) : ALL_SLOTS.filter(x => x === s || draft.meal_types.includes(x)) })}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${on ? SLOT_STYLE[s] : 'bg-white text-subtle border-dashed border-border'}`}>
                  {c && (c.ok ? <CheckCircle2 className="w-3 h-3 text-brand-600" /> : <AlertTriangle className="w-3 h-3 text-amber-600" />)}
                  {SLOT_LABELS[s]}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <span className={LABEL}>Foods</span>
          {draft.items.length > 0 && (
            <ul className="mb-2 border border-border rounded-2xl divide-y divide-border">
              {draft.items.map((it, i) => {
                const f = foodMap.get(it.food_item_id)
                return (
                  <li key={it.food_item_id} className="px-3 py-2 flex items-center gap-2">
                    <div className="flex flex-col">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-subtle hover:text-text-main disabled:opacity-30" aria-label="Move up"><ArrowUp className="w-3 h-3" /></button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === draft.items.length - 1} className="text-subtle hover:text-text-main disabled:opacity-30" aria-label="Move down"><ArrowDown className="w-3 h-3" /></button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-text-main truncate">{f?.name ?? 'Unknown food'}</div>
                      {cacfp && f && <div className="text-[10px] font-bold uppercase tracking-wider text-subtle">{COMPONENT_LABELS[f.component]}</div>}
                    </div>
                    <input value={it.serving_note} placeholder="Serving (opt.)" maxLength={120}
                      onChange={e => setDraft({ ...draft, items: draft.items.map(x => x.food_item_id === it.food_item_id ? { ...x, serving_note: e.target.value } : x) })}
                      className="w-28 px-2 py-1 rounded-lg border border-border text-xs" />
                    <button type="button" onClick={() => setDraft({ ...draft, items: draft.items.filter(x => x.food_item_id !== it.food_item_id) })}
                      className="p-1 rounded text-subtle hover:text-red-600" aria-label="Remove food"><X className="w-3.5 h-3.5" /></button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Add a food…" className={`${INPUT} pl-9`} />
          </div>
          {matches.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {matches.map(f => (
                <button key={f.id} type="button" onClick={() => { setDraft({ ...draft, items: [...draft.items, { food_item_id: f.id, serving_note: '' }] }); setQ('') }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border border-border bg-white hover:border-brand-300">
                  <Plus className="w-3 h-3" /> {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className={LABEL} htmlFor="preset-notes">Notes for the kitchen (optional)</label>
          <textarea id="preset-notes" value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} className={INPUT} rows={2} maxLength={1000} />
        </div>
        {draft.id && (
          <label className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <input type="checkbox" checked={draft.is_active} onChange={e => setDraft({ ...draft, is_active: e.target.checked })} /> Show in the calendar palette
          </label>
        )}
        {draft.id && <p className="text-xs text-subtle">Saving updates this preset on draft months. Published months keep the foods they were announced with.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={() => setDraft(null)} className={`${BTN} bg-white border border-border`}>Cancel</button>
          <button disabled={busy} onClick={onSave} className={`${BTN} bg-brand-600 text-white hover:bg-brand-700`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save</button>
        </div>
      </div>
    </Modal>
  )
}
