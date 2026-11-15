'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Link2, Loader2, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { deleteGuardian, listCenterGuardians, saveGuardian } from '@/lib/children'
import type { CenterGuardian, Child, ChildGuardian } from '@/lib/child-types'
import { showAlert, showConfirm } from '@/lib/dialog'
import { BTN, BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal, Pill } from './ui'
import { ParentAccessDialog } from './ParentAccessDialog'
import { GuardianPicker } from './GuardianPicker'
import { getParentAccess, type ContactAccess } from '@/app/actions/parent-access.actions'

/**
 * Parents, guardians and the people a child may be released to. A child is released ONLY to someone explicitly
 * authorized (10A NCAC 09 .0801(c)): nobody is authorized by default, and every change is logged.
 */
type Editing = Partial<ChildGuardian> & { name: string; save_to_list?: boolean }

export function ContactsPanel({ child, guardians, onChanged }: { child: Child; guardians: ChildGuardian[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Editing | null>(null)
  // The center's Parents & guardians list, for the picker (archived entries too, so a linked one still shows its name)
  const [list, setList] = useState<CenterGuardian[]>([])
  const loadList = useCallback(async () => {
    const res = await listCenterGuardians(createClient(), child.center_id, { includeArchived: true })
    if (res.success) setList(res.guardians)
  }, [child.center_id])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadList() }, [loadList])
  const [saving, setSaving] = useState(false)
  const authorized = guardians.filter(g => g.can_pick_up)
  // Parent page access (only when the center has the parent portal on)
  const [portal, setPortal] = useState<{ enabled: boolean; linkKey: string | null; byGuardian: Record<string, ContactAccess> }>({ enabled: false, linkKey: null, byGuardian: {} })
  const [accessFor, setAccessFor] = useState<ChildGuardian | null>(null)
  const loadAccess = useCallback(async () => {
    const res = await getParentAccess(child.center_id, child.id)
    if (res.success) setPortal({ enabled: res.enabled, linkKey: res.linkKey, byGuardian: Object.fromEntries(res.contacts.map(c => [c.guardian_id, c])) })
  }, [child.center_id, child.id])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadAccess() }, [loadAccess, guardians])

  async function save() {
    if (!editing) return
    if (!editing.name.trim() && !editing.center_guardian_id) { showAlert('Enter the person’s name, or choose someone from the parents list.'); return }
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
      can_message: editing.can_message ?? true,
      center_guardian_id: editing.center_guardian_id ?? null,
      save_to_list: !editing.center_guardian_id && !!editing.save_to_list,
    })
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    setEditing(null)
    if (editing.save_to_list && !editing.center_guardian_id) loadList()
    onChanged()
  }

  async function remove(g: ChildGuardian) {
    if (!await showConfirm(`Remove ${g.name} from ${child.first_name}’s contacts?${g.can_pick_up ? ' They will no longer be authorized to pick up.' : ''}`, { title: 'Remove contact', confirmLabel: 'Remove' })) return
    const res = await deleteGuardian(createClient(), g.id)
    if (!res.success) { showAlert(res.error); return }
    onChanged()
  }

  const set = <K extends keyof Editing>(key: K, value: Editing[K]) => setEditing(prev => (prev ? { ...prev, [key]: value } : prev))
  const linked = !!editing?.center_guardian_id

  function pick(g: CenterGuardian) {
    setEditing(prev => prev && ({
      ...prev, center_guardian_id: g.id, name: g.name, phone: g.phone ?? '', email: g.email ?? '',
      relationship: prev.relationship?.trim() ? prev.relationship : (g.relationship ?? ''),
      daily_report: !!g.email && !!prev.daily_report,
    }))
  }

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
          <button onClick={() => setEditing({ name: '', relationship: '', phone: '', email: '', is_primary: guardians.length === 0, is_emergency_contact: false, can_pick_up: false, daily_report: guardians.length === 0, can_message: true, center_guardian_id: null, save_to_list: true })} className={BTN}><Plus className="h-3.5 w-3.5" /> Add contact</button>
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
                        {g.can_pick_up && g.can_message === false && <Pill className="border-border bg-surface text-muted">No teacher messages</Pill>}
                        {portal.enabled && portal.byGuardian[g.id]?.has_access && <Pill className="border-violet-200 bg-violet-50 text-violet-700">Parent page</Pill>}
                        {g.center_guardian_id && <Pill className="border-border bg-surface text-muted"><Link2 className="mr-1 h-3 w-3 self-center" />On parents list</Pill>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {portal.enabled && child.status === 'enrolled' && (
                          <button onClick={() => setAccessFor(g)} className={BTN_QUIET_SM} title="Parent page PIN"><KeyRound className="h-3.5 w-3.5" /> Parent page</button>
                        )}
                        <button onClick={() => setEditing({ ...g, save_to_list: false })} className={BTN}><Pencil className="h-3.5 w-3.5" /> Edit</button>
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

      {accessFor && (
        <ParentAccessDialog child={child} guardian={accessFor} access={portal.byGuardian[accessFor.id]} linkKey={portal.linkKey} onClose={() => setAccessFor(null)} onChanged={loadAccess} />
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit contact' : 'Add contact'} onClose={() => setEditing(null)} footer={
          <>
            <button onClick={() => setEditing(null)} className={BTN_QUIET}>Cancel</button>
            <button onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
          </>
        }>
          <div className="space-y-4">
            <GuardianPicker
              guardians={list}
              value={editing.center_guardian_id}
              excludeIds={guardians.filter(g => g.id !== editing.id && g.center_guardian_id).map(g => g.center_guardian_id as string)}
              onPick={pick}
              onUnlink={() => set('center_guardian_id', null)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={LBL}>Name *</label><input autoFocus={!list.length} value={editing.name} readOnly={linked} onChange={e => set('name', e.target.value)} className={`${FLD} ${linked ? 'bg-surface text-muted' : ''}`} maxLength={120} /></div>
              <div><label className={LBL}>Relationship to {child.first_name}</label><input value={editing.relationship ?? ''} onChange={e => set('relationship', e.target.value)} className={FLD} maxLength={60} placeholder="Mother, grandfather, neighbor…" /></div>
              <div><label className={LBL}>Phone</label><input type="tel" value={editing.phone ?? ''} readOnly={linked} onChange={e => set('phone', e.target.value)} className={`${FLD} ${linked ? 'bg-surface text-muted' : ''}`} maxLength={30} /></div>
              <div><label className={LBL}>Email</label><input type="email" value={editing.email ?? ''} readOnly={linked} onChange={e => set('email', e.target.value)} className={`${FLD} ${linked ? 'bg-surface text-muted' : ''}`} maxLength={254} /></div>
            </div>
            {!linked && (
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text-main">
                <input type="checkbox" checked={!!editing.save_to_list} onChange={e => set('save_to_list', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                <span>Also add to the parents list<span className="block text-xs text-muted">So you can pick this person for a sibling, and fix a phone number once for every child.</span></span>
              </label>
            )}
            <div className="space-y-2.5 rounded-2xl border border-border bg-surface p-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2.5 text-text-main"><input type="checkbox" checked={!!editing.is_primary} onChange={e => set('is_primary', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" /> Primary contact</label>
              <label className="flex cursor-pointer items-start gap-2.5 text-text-main"><input type="checkbox" checked={!!editing.daily_report && !!editing.email?.trim()} disabled={!editing.email?.trim()} onChange={e => set('daily_report', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" /> <span>Gets the daily report email<span className="block text-xs font-normal text-muted">{editing.email?.trim() ? `A summary of ${child.first_name}’s day after pick-up.` : 'Add an email address first.'}</span></span></label>
              <label className="flex cursor-pointer items-start gap-2.5 text-text-main"><input type="checkbox" checked={editing.can_message !== false} onChange={e => set('can_message', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" /> <span>Teachers can message this person<span className="block text-xs font-normal text-muted">Authorized pick-ups with an email show up in Message to parent on the Live roster. Turn off for custody or by request.</span></span></label>
              <label className="flex cursor-pointer items-center gap-2.5 text-text-main"><input type="checkbox" checked={!!editing.is_emergency_contact} onChange={e => set('is_emergency_contact', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" /> Emergency contact</label>
              <label className="flex cursor-pointer items-start gap-2.5 font-semibold text-text-main"><input type="checkbox" checked={!!editing.can_pick_up} onChange={e => set('can_pick_up', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" /> <span>Authorized to pick up {child.first_name}<span className="block text-xs font-normal text-muted">Only if the signed application lists this person. You will be asked to confirm.</span></span></label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
