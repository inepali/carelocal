'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Loader2, Pencil, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ALLERGY_SEVERITIES, loadAllergies, saveAllergy, setAllergyActive, type AllergyInput } from '@/lib/children'
import type { Child, ChildAllergy } from '@/lib/child-types'
import { showAlert, showConfirm } from '@/lib/dialog'
import { useLookups } from '@/hooks/use-lookups'
import { BTN, BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal, Pill } from './ui'

/** Manage Data deep link for the allergy list */
export const ALLERGIES_HREF = `/center/about?tab=${encodeURIComponent('Allergy')}#data`

const severityOf = (s: string) => ALLERGY_SEVERITIES.find(x => x.value === s) ?? ALLERGY_SEVERITIES[1]

/**
 * The child's allergies, entered by an owner or admin from the parent's forms. Picked from the center's
 * Allergies list (About → Manage Data). Removed, never deleted, and every change is logged in Activity.
 */
export function AllergiesPanel({ child }: { child: Child }) {
  const [list, setList] = useState<ChildAllergy[] | null>(null)
  const [editing, setEditing] = useState<(AllergyInput & { id?: string }) | null>(null)
  const [saving, setSaving] = useState(false)
  const [showRemoved, setShowRemoved] = useState(false)

  const load = useCallback(async () => {
    const res = await loadAllergies(createClient(), child.id)
    if (!res.success) { showAlert(res.error); setList([]); return }
    setList(res.allergies)
  }, [child.id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function save() {
    if (!editing) return
    setSaving(true)
    const res = await saveAllergy(createClient(), child.center_id, child.id, editing)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    setEditing(null)
    load()
  }

  async function toggle(a: ChildAllergy) {
    if (a.active && !await showConfirm(`Remove ${a.allergen} from ${child.first_name}'s allergies? It stays in the history and in Activity.`, { title: 'Remove allergy', confirmLabel: 'Remove' })) return
    const res = await setAllergyActive(createClient(), a.id, !a.active)
    if (!res.success) showAlert(res.error)
    load()
  }

  if (!list) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>

  const active = list.filter(a => a.active)
  const removed = list.filter(a => !a.active)
  const set = <K extends keyof AllergyInput>(k: K, v: AllergyInput[K]) => setEditing(prev => (prev ? { ...prev, [k]: v } : prev))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div className="max-w-2xl">
          <h2 className="text-lg font-bold text-heading">Allergies</h2>
          <p className="mt-1 text-sm text-muted">
            Food, medicine and other allergies from the parent&apos;s forms, how serious each one is and what staff should do.
            Pick from your center&apos;s <Link href={ALLERGIES_HREF} className="font-semibold text-brand-600 hover:underline">Allergies list</Link>.
            Add any medicine for it (an EpiPen, for example) under Medicines.
          </p>
        </div>
        <button className={BTN} onClick={() => setEditing({ allergen: '', severity: 'moderate', reaction: '', action_plan: '' })}>
          <Plus className="h-3.5 w-3.5" /> Add allergy
        </button>
      </div>

      {active.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center text-sm text-muted">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-brand-200" /> No allergies on file for {child.first_name}.
        </div>
      ) : (
        <ul className="space-y-3">
          {active.map(a => <AllergyItem key={a.id} a={a} onEdit={() => setEditing({ id: a.id, allergen: a.allergen, severity: a.severity, reaction: a.reaction ?? '', action_plan: a.action_plan ?? '' })} onToggle={() => toggle(a)} />)}
        </ul>
      )}

      {removed.length > 0 && (
        <div>
          <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setShowRemoved(v => !v)}>
            {showRemoved ? 'Hide' : 'Show'} {removed.length} removed {removed.length === 1 ? 'allergy' : 'allergies'}
          </button>
          {showRemoved && (
            <ul className="mt-2 space-y-3 opacity-70">
              {removed.map(a => <AllergyItem key={a.id} a={a} onToggle={() => toggle(a)} />)}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit allergy' : 'Add allergy'} onClose={() => setEditing(null)} wide footer={
          <>
            <button onClick={() => setEditing(null)} className={BTN_QUIET}>Cancel</button>
            <button onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
          </>
        }>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="allergy-allergen" className={LBL}>Allergy *</label>
              <AllergenSelect id="allergy-allergen" value={editing.allergen} onChange={v => set('allergen', v)} taken={active.filter(a => a.id !== editing.id).map(a => a.allergen)} />
            </div>
            <div>
              <label htmlFor="allergy-severity" className={LBL}>How serious *</label>
              <select id="allergy-severity" value={editing.severity} onChange={e => set('severity', e.target.value as AllergyInput['severity'])} className={FLD}>
                {ALLERGY_SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2"><label className={LBL}>Reaction</label><input value={editing.reaction} onChange={e => set('reaction', e.target.value)} maxLength={200} className={FLD} placeholder="For example: hives, swelling, trouble breathing" /></div>
            <div className="sm:col-span-2"><label className={LBL}>What to do</label><textarea value={editing.action_plan} onChange={e => set('action_plan', e.target.value)} maxLength={500} rows={3} className={`${FLD} resize-none`} placeholder="For example: give the EpiPen (in the office), call 911, then the parent" /></div>
          </div>
          <p className="mt-3 text-xs text-muted">Keep the allergy action plan or doctor&apos;s note under Records. Changes are logged in the child&apos;s Activity.</p>
        </Modal>
      )}
    </div>
  )
}

function AllergyItem({ a, onEdit, onToggle }: { a: ChildAllergy; onEdit?: () => void; onToggle: () => void }) {
  const sev = severityOf(a.severity)
  return (
    <li className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-bold text-heading">{a.allergen}</p>
            <Pill className={sev.className}>{sev.label}</Pill>
            {!a.active && <Pill className="border-border bg-surface text-muted">Removed</Pill>}
          </div>
          {a.reaction && <p className="mt-1 text-sm text-text-main">Reaction: {a.reaction}</p>}
          {a.action_plan && <p className="mt-0.5 whitespace-pre-line text-sm text-muted">What to do: {a.action_plan}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {onEdit && <button className={BTN_QUIET_SM} onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</button>}
          <button className={BTN_QUIET_SM} onClick={onToggle}>{a.active ? 'Remove' : 'Restore'}</button>
        </div>
      </div>
    </li>
  )
}

/**
 * The allergy, picked from the center's Allergies list (About → Manage Data). The label is saved as text, so a
 * value no longer on the list is kept and shown as its own option. Allergies the child already has are hidden.
 */
function AllergenSelect({ value, onChange, id, taken }: { value: string; onChange: (v: string) => void; id?: string; taken: string[] }) {
  const { data, loading } = useLookups('Allergy')
  const takenSet = new Set(taken.map(t => t.trim().toLowerCase()))
  const options = data.filter(i => i.is_active).map(i => i.label).filter(o => !takenSet.has(o.toLowerCase()) || o.toLowerCase() === value.trim().toLowerCase())
  const current = value.trim()
  const known = !current || options.some(o => o.toLowerCase() === current.toLowerCase())

  if (!loading && data.filter(i => i.is_active).length === 0) {
    return (
      <>
        <input id={id} value={value} onChange={e => onChange(e.target.value)} className={FLD} maxLength={60} placeholder="Peanuts, penicillin…" />
        <p className="mt-1 text-xs text-muted">Set up the list in <Link href={ALLERGIES_HREF} className="font-semibold text-brand-600 hover:underline">Manage Data</Link>.</p>
      </>
    )
  }

  return (
    <>
      <select id={id} value={known ? options.find(o => o.toLowerCase() === current.toLowerCase()) ?? '' : value} onChange={e => onChange(e.target.value)} className={FLD} disabled={loading}>
        <option value="">{loading ? 'Loading…' : 'Select…'}</option>
        {!known && <option value={value}>{value}</option>}
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <p className="mt-1 text-xs text-muted">Not listed? Add it in <Link href={ALLERGIES_HREF} className="font-semibold text-brand-600 hover:underline">Manage Data → Allergies</Link>.</p>
    </>
  )
}
