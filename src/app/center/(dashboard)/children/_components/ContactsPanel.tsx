'use client'

import { useState } from 'react'
import { Loader2, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { deleteGuardian, saveGuardian } from '@/lib/children'
import type { Child, ChildGuardian } from '@/lib/child-types'
import { showAlert, showConfirm } from '@/lib/dialog'
import { BTN, BTN_PRIMARY, BTN_QUIET, FLD, LBL, Modal, Pill } from './ui'

/**
 * Parents, guardians and the people a child may be released to. A child is released ONLY to someone explicitly
 * authorized (10A NCAC 09 .0801(c)): nobody is authorized by default, and every change is logged.
 */
export function ContactsPanel({ child, guardians, onChanged }: { child: Child; guardians: ChildGuardian[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<(Partial<ChildGuardian> & { name: string }) | null>(null)
  const [saving, setSaving] = useState(false)
  const authorized = guardians.filter(g => g.can_pick_up)

  async function save() {
    if (!editing) return
    if (!editing.name.trim()) { showAlert('Enter the person’s name.'); return }
    const original = guardians.find(g => g.id === editing.id)
    if (editing.can_pick_up && !original?.can_pick_up) {
      const ok = await showConfirm(
        `Authorize ${editing.name.trim()} to pick up ${child.first_name}? Only do this if the signed application lists this person. The change is logged.`,
        { title: 'Authorize pick-up', confirmLabel: 'Authorize' },
      )
      if (!ok) return
    }
    setSaving(true)
    const res = await saveGuardian(createClient(), child.center_id, child.id, {
      id: editing.id, name: editing.name, relationship: editing.relationship, phone: editing.phone, email: editing.email,
      is_primary: !!editing.is_primary, is_emergency_contact: !!editing.is_emergency_contact, can_pick_up: !!editing.can_pick_up,
      daily_report: !!editing.daily_report,
    })
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    setEditing(null)
    onChanged()
  }

  async function remove(g: ChildGuardian) {
    if (!await showConfirm(`Remove ${g.name} from ${child.first_name}’s contacts?${g.can_pick_up ? ' They will no longer be authorized to pick up.' : ''}`, { title: 'Remove contact', confirmLabel: 'Remove' })) return
    const res = await deleteGuardian(createClient(), g.id)
    if (!res.success) { showAlert(res.error); return }
    onChanged()
  }

  const set = <K extends keyof ChildGuardian>(key: K, value: ChildGuardian[K]) => setEditing(prev => (prev ? { ...prev, [key]: value } : prev))

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 rounded-2xl border px-5 py-4 text-sm ${authorized.length === 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-border bg-white text-text-muted'}`}>
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <div className="font-bold">{authorized.length === 0 ? 'No one is authorized to pick up this child yet' : `${authorized.length} person${authorized.length === 1 ? '' : 's'} authorized to pick up`}</div>
          <p className="text-xs">Staff may release a child only to someone listed here, as authorized on the signed application.</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-6 py-4">
          <h2 className="text-lg font-bold text-text-main">Contacts</h2>
          <button onClick={() => setEditing({ name: '', relationship: '', phone: '', email: '', is_primary: guardians.length === 0, is_emergency_contact: false, can_pick_up: false, daily_report: guardians.length === 0 })} className={BTN}><Plus className="h-3.5 w-3.5" /> Add contact</button>
        </div>
        {guardians.length === 0 ? <div className="px-6 py-8 text-sm text-muted">No contacts yet. Add a parent or guardian.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-border text-[15px] font-bold text-text-main">
                  <th scope="col" className="px-6 py-4">Name</th>
                  <th scope="col" className="px-4 py-4">Phone and email</th>
                  <th scope="col" className="px-4 py-4">Role</th>
                  <th scope="col" className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm text-text-muted">
                {guardians.map(g => (
                  <tr key={g.id} className="align-top hover:bg-surface">
                    <td className="px-6 py-4"><div className="font-semibold text-text-main">{g.name}</div><div className="text-xs text-muted">{g.relationship || '—'}</div></td>
                    <td className="px-4 py-4 text-xs">{g.phone ? <div><a href={`tel:${g.phone}`} className="hover:text-brand-600">{g.phone}</a></div> : null}{g.email ? <div><a href={`mailto:${g.email}`} className="hover:text-brand-600">{g.email}</a></div> : null}{!g.phone && !g.email && '—'}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {g.is_primary && <Pill className="border-brand-100 bg-brand-50 text-brand-600">Primary</Pill>}
                        {g.is_emergency_contact && <Pill className="border-amber-200 bg-amber-50 text-amber-700">Emergency</Pill>}
                        {g.can_pick_up ? <Pill className="border-emerald-200 bg-emerald-50 text-emerald-700">Authorized pick-up</Pill> : <Pill className="border-border bg-surface text-muted">Not authorized</Pill>}
                        {g.daily_report && g.email && <Pill className="border-sky-200 bg-sky-50 text-sky-700">Daily report</Pill>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setEditing({ ...g })} className={BTN}><Pencil className="h-3.5 w-3.5" /> Edit</button>
                        <button onClick={() => remove(g)} title="Remove" className="rounded-lg p-2 text-subtle hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <Modal title={editing.id ? 'Edit contact' : 'Add contact'} onClose={() => setEditing(null)} footer={
          <>
            <button onClick={() => setEditing(null)} className={BTN_QUIET}>Cancel</button>
            <button onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
          </>
        }>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={LBL}>Name *</label><input autoFocus value={editing.name} onChange={e => set('name', e.target.value)} className={FLD} maxLength={120} /></div>
              <div><label className={LBL}>Relationship</label><input value={editing.relationship ?? ''} onChange={e => set('relationship', e.target.value)} className={FLD} maxLength={60} placeholder="Mother, grandfather, neighbor…" /></div>
              <div><label className={LBL}>Phone</label><input type="tel" value={editing.phone ?? ''} onChange={e => set('phone', e.target.value)} className={FLD} maxLength={30} /></div>
              <div><label className={LBL}>Email</label><input type="email" value={editing.email ?? ''} onChange={e => set('email', e.target.value)} className={FLD} maxLength={254} /></div>
            </div>
            <div className="space-y-2.5 rounded-2xl border border-border bg-surface p-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2.5 text-text-main"><input type="checkbox" checked={!!editing.is_primary} onChange={e => set('is_primary', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" /> Primary contact</label>
              <label className="flex cursor-pointer items-start gap-2.5 text-text-main"><input type="checkbox" checked={!!editing.daily_report && !!editing.email?.trim()} disabled={!editing.email?.trim()} onChange={e => set('daily_report', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" /> <span>Gets the daily report email<span className="block text-xs font-normal text-muted">{editing.email?.trim() ? `A summary of ${child.first_name}’s day after pick-up.` : 'Add an email address first.'}</span></span></label>
              <label className="flex cursor-pointer items-center gap-2.5 text-text-main"><input type="checkbox" checked={!!editing.is_emergency_contact} onChange={e => set('is_emergency_contact', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" /> Emergency contact</label>
              <label className="flex cursor-pointer items-start gap-2.5 font-semibold text-text-main"><input type="checkbox" checked={!!editing.can_pick_up} onChange={e => set('can_pick_up', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" /> <span>Authorized to pick up {child.first_name}<span className="block text-xs font-normal text-muted">Only if the signed application lists this person. You will be asked to confirm.</span></span></label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
