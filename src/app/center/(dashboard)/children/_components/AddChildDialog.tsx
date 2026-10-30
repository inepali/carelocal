'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { addChild } from '@/lib/children'
import type { Classroom } from '@/lib/children'
import type { Child } from '@/lib/child-types'
import { showAlert } from '@/lib/dialog'
import { BTN_PRIMARY, BTN_QUIET, FLD, LBL, Modal, todayISO } from './ui'
import { HomeRoomField, suggestedRoomFor } from './HomeRoomField'

/**
 * Enroll a child with the parent as the first contact. Pick-up is NOT authorized unless the box is ticked:
 * a child is released only to someone explicitly authorized (10A NCAC 09 .0801(c)).
 */
export function AddChildDialog({ centerId, classrooms, onClose, onCreated }: {
  centerId: string
  classrooms: Classroom[]
  onClose: () => void
  onCreated: (child: Child) => void
}) {
  const [f, setF] = useState({
    first_name: '', last_name: '', preferred_name: '', date_of_birth: '', classroom_id: '', enrolled_on: todayISO(), first_attended_on: '',
    parent: '', relationship: 'Parent', phone: '', email: '', can_pick_up: false,
  })
  const [saving, setSaving] = useState(false)
  const [roomPicked, setRoomPicked] = useState(false)       // once someone picks a room, the date of birth stops changing it
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF(prev => ({ ...prev, [key]: value }))
  const today = todayISO()
  const ageDay = f.first_attended_on || (f.enrolled_on > today ? f.enrolled_on : today)

  function setDob(dob: string) {
    setF(prev => {
      const next = { ...prev, date_of_birth: dob }
      if (!roomPicked) next.classroom_id = suggestedRoomFor(dob, ageDay, classrooms)?.id ?? prev.classroom_id
      return next
    })
  }

  async function save() {
    setSaving(true)
    const res = await addChild(createClient(), centerId, {
      first_name: f.first_name, last_name: f.last_name, preferred_name: f.preferred_name, date_of_birth: f.date_of_birth,
      classroom_id: f.classroom_id || null, enrolled_on: f.enrolled_on || undefined, first_attended_on: f.first_attended_on || null,
    }, f.parent.trim() ? [{
      name: f.parent, relationship: f.relationship, phone: f.phone, email: f.email, is_primary: true, is_emergency_contact: true, can_pick_up: f.can_pick_up,
    }] : [])
    setSaving(false)
    if (!res.success) {
      showAlert(res.error)
      if ('child' in res && res.child) onCreated(res.child as Child)   // the child was created; only the contact failed
      return
    }
    onCreated(res.child)
  }

  return (
    <Modal title="Add a child" onClose={onClose} wide footer={
      <>
        <button onClick={onClose} className={BTN_QUIET}>Cancel</button>
        <button onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Add child</button>
      </>
    }>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={LBL}>First name *</label><input autoFocus value={f.first_name} onChange={e => set('first_name', e.target.value)} className={FLD} maxLength={80} /></div>
          <div><label className={LBL}>Last name *</label><input value={f.last_name} onChange={e => set('last_name', e.target.value)} className={FLD} maxLength={80} /></div>
          <div><label className={LBL}>Name the child is called</label><input value={f.preferred_name} onChange={e => set('preferred_name', e.target.value)} className={FLD} maxLength={80} placeholder="If different" /></div>
          <div><label className={LBL}>Date of birth *</label><input type="date" value={f.date_of_birth} onChange={e => setDob(e.target.value)} className={FLD} /></div>
          <HomeRoomField classrooms={classrooms} dob={f.date_of_birth} onDay={ageDay} value={f.classroom_id}
            onChange={id => { setRoomPicked(true); set('classroom_id', id) }} />
          <div><label className={LBL}>Enrolled on</label><input type="date" value={f.enrolled_on} onChange={e => set('enrolled_on', e.target.value)} className={FLD} /></div>
          <div className="sm:col-span-2">
            <label className={LBL}>First day of attendance</label>
            <input type="date" value={f.first_attended_on} onChange={e => set('first_attended_on', e.target.value)} className={FLD} />
            <p className="mt-1 text-[11px] text-subtle">Starts the 30-day windows for the immunization record and the health assessment. Leave empty until the child starts; the enrollment date is used meanwhile.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 text-sm font-bold text-text-main">Parent or guardian (first contact)</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={LBL}>Name</label><input value={f.parent} onChange={e => set('parent', e.target.value)} className={FLD} maxLength={120} /></div>
            <div><label className={LBL}>Relationship</label><input value={f.relationship} onChange={e => set('relationship', e.target.value)} className={FLD} maxLength={60} /></div>
            <div><label className={LBL}>Phone</label><input type="tel" value={f.phone} onChange={e => set('phone', e.target.value)} className={FLD} maxLength={30} /></div>
            <div><label className={LBL}>Email</label><input type="email" value={f.email} onChange={e => set('email', e.target.value)} className={FLD} maxLength={254} /></div>
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-text-main">
            <input type="checkbox" checked={f.can_pick_up} onChange={e => set('can_pick_up', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
            <span>Authorized to pick up this child<span className="block text-xs text-muted">Leave unticked until the signed application lists this person. You can change it later; every change is logged.</span></span>
          </label>
        </div>
      </div>
    </Modal>
  )
}
