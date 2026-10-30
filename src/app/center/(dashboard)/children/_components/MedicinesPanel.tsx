'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Pill as PillIcon, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { loadMedications, saveMedication, setMedicationActive, type MedicationInput } from '@/lib/children'
import type { Child, ChildMedication } from '@/lib/child-types'
import { formatDate } from '@/lib/compliance'
import { showAlert, showConfirm } from '@/lib/dialog'
import { BTN, BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal, Pill, todayISO } from './ui'

type Given = Awaited<ReturnType<typeof loadMedications>> extends infer R ? R extends { given: infer G } ? G : never : never

function stateOf(m: ChildMedication, today: string) {
  if (!m.active) return { label: 'Stopped', className: 'border-border bg-surface text-muted' }
  if (m.starts_on > today) return { label: `Starts ${formatDate(m.starts_on)}`, className: 'border-amber-200 bg-amber-50 text-amber-800' }
  if (m.ends_on && m.ends_on < today) return { label: 'Ended', className: 'border-border bg-surface text-muted' }
  return { label: 'Active', className: 'border-brand-100 bg-brand-50 text-brand-600' }
}

/**
 * The medicines a child may be given at the center, entered by an owner or admin from the signed medication
 * permission (10A NCAC 09 .0803). Teachers can give only an active medicine from this list, within its dates,
 * from the roster. Medicines are stopped, never deleted, so the record of doses given stays complete.
 */
export function MedicinesPanel({ child }: { child: Child }) {
  const [meds, setMeds] = useState<ChildMedication[] | null>(null)
  const [given, setGiven] = useState<Given>([])
  const [editing, setEditing] = useState<(MedicationInput & { id?: string }) | null>(null)
  const [saving, setSaving] = useState(false)
  const today = todayISO()

  const load = useCallback(async () => {
    const res = await loadMedications(createClient(), child.id)
    if (!res.success) { showAlert(res.error); setMeds([]); return }
    setMeds(res.medications)
    setGiven(res.given)
  }, [child.id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function save() {
    if (!editing) return
    setSaving(true)
    const res = await saveMedication(createClient(), child.center_id, child.id, editing)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    setEditing(null)
    load()
  }

  async function toggle(m: ChildMedication) {
    if (m.active && !await showConfirm(`Stop ${m.name}? Teachers will no longer be able to give it. It stays on file with the doses given.`, { title: 'Stop medicine', confirmLabel: 'Stop' })) return
    const res = await setMedicationActive(createClient(), m.id, !m.active)
    if (!res.success) showAlert(res.error)
    load()
  }

  const set = <K extends keyof MedicationInput>(k: K, v: MedicationInput[K]) => setEditing(prev => (prev ? { ...prev, [k]: v } : prev))

  if (!meds) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div className="max-w-2xl">
          <h2 className="text-lg font-bold text-heading">Medicines</h2>
          <p className="mt-1 text-sm text-muted">
            Enter each medicine exactly as the parent&apos;s signed medication permission says. Teachers can give only an active
            medicine from this list, within its dates, and every dose is recorded. When there is none, nothing shows on the roster.
          </p>
        </div>
        <button className={BTN} onClick={() => setEditing({ name: '', dose: '', schedule: '', instructions: '', permission_signed_on: '', starts_on: today, ends_on: '' })}>
          <Plus className="h-3.5 w-3.5" /> Add medicine
        </button>
      </div>

      {meds.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center text-sm text-muted">
          <PillIcon className="mx-auto mb-2 h-8 w-8 text-brand-200" /> No medicines on file for {child.first_name}.
        </div>
      ) : (
        <ul className="space-y-3">
          {meds.map(m => {
            const st = stateOf(m, today)
            const doses = given.filter(g => g.medication_id === m.id && !g.voided_at)
            return (
              <li key={m.id} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-bold text-heading">{m.name} <span className="font-semibold text-text-main">· {m.dose}</span></p>
                      <Pill className={st.className}>{st.label}</Pill>
                    </div>
                    {m.schedule && <p className="mt-1 text-sm text-text-main">{m.schedule}</p>}
                    {m.instructions && <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{m.instructions}</p>}
                    <p className="mt-2 text-xs text-muted">
                      Permission signed {formatDate(m.permission_signed_on)} · From {formatDate(m.starts_on)}{m.ends_on ? ` to ${formatDate(m.ends_on)}` : ', no end date'}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {doses.length ? `Last given ${new Date(doses[0].at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${doses[0].details.dose ? ` (${doses[0].details.dose})` : ''} · ${doses.length} ${doses.length === 1 ? 'dose' : 'doses'} recorded` : 'Not given yet'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button className={BTN_QUIET_SM} onClick={() => setEditing({ id: m.id, name: m.name, dose: m.dose, schedule: m.schedule ?? '', instructions: m.instructions ?? '', permission_signed_on: m.permission_signed_on, starts_on: m.starts_on, ends_on: m.ends_on ?? '' })}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button className={BTN_QUIET_SM} onClick={() => toggle(m)}>{m.active ? 'Stop' : 'Restart'}</button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit medicine' : 'Add medicine'} onClose={() => setEditing(null)} wide footer={
          <>
            <button onClick={() => setEditing(null)} className={BTN_QUIET}>Cancel</button>
            <button onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
          </>
        }>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={LBL}>Medicine *</label><input value={editing.name} onChange={e => set('name', e.target.value)} maxLength={100} className={FLD} placeholder="For example: Amoxicillin" /></div>
            <div><label className={LBL}>Dose *</label><input value={editing.dose} onChange={e => set('dose', e.target.value)} maxLength={60} className={FLD} placeholder="For example: 5 ml" /></div>
            <div className="sm:col-span-2"><label className={LBL}>When or how often</label><input value={editing.schedule ?? ''} onChange={e => set('schedule', e.target.value)} maxLength={120} className={FLD} placeholder="For example: with lunch; or every 4 hours as needed for fever over 101°F" /></div>
            <div className="sm:col-span-2"><label className={LBL}>Instructions</label><textarea value={editing.instructions ?? ''} onChange={e => set('instructions', e.target.value)} maxLength={500} rows={3} className={`${FLD} resize-none`} placeholder="Storage, how to give it, what to watch for" /></div>
            <div><label className={LBL}>Parent permission signed on *</label><input type="date" value={editing.permission_signed_on} max={today} onChange={e => set('permission_signed_on', e.target.value)} className={FLD} /></div>
            <div />
            <div><label className={LBL}>Start date *</label><input type="date" value={editing.starts_on} onChange={e => set('starts_on', e.target.value)} className={FLD} /></div>
            <div><label className={LBL}>End date</label><input type="date" value={editing.ends_on ?? ''} min={editing.starts_on} onChange={e => set('ends_on', e.target.value)} className={FLD} /></div>
          </div>
          <p className="mt-3 text-xs text-muted">Keep the signed permission form under Records. Changes are logged in the child&apos;s Activity.</p>
        </Modal>
      )}
    </div>
  )
}
