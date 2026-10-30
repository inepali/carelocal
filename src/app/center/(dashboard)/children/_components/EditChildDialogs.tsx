'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { updateChild, withdrawChild } from '@/lib/children'
import type { Classroom } from '@/lib/children'
import type { Child } from '@/lib/child-types'
import { showAlert } from '@/lib/dialog'
import { BTN_PRIMARY, BTN_QUIET, FLD, LBL, Modal, todayISO } from './ui'
import { HomeRoomField } from './HomeRoomField'

/** Names, dates, classroom and the custody flag */
export function EditChildDialog({ child, classrooms, onClose, onSaved }: {
  child: Child
  classrooms: Classroom[]
  onClose: () => void
  onSaved: () => void
}) {
  const [f, setF] = useState({
    first_name: child.first_name, last_name: child.last_name, preferred_name: child.preferred_name ?? '', date_of_birth: child.date_of_birth,
    classroom_id: child.classroom_id ?? '', enrolled_on: child.enrolled_on, first_attended_on: child.first_attended_on ?? '',
    custody_restriction: child.custody_restriction, custody_note: child.custody_note ?? '',
    care_alert: child.care_alert ?? '',
    toilet: (child.toilet_trained == null ? 'auto' : child.toilet_trained ? 'yes' : 'no') as 'auto' | 'yes' | 'no',
    daily_photos_allowed: child.daily_photos_allowed ?? false,
  })
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF(prev => ({ ...prev, [key]: value }))

  async function save() {
    if (!f.first_name.trim() || !f.last_name.trim() || !f.date_of_birth) { showAlert('Enter the first name, last name and date of birth.'); return }
    if (f.custody_restriction && !f.custody_note.trim()) { showAlert('Describe the custody restriction so staff know what to do.'); return }
    setSaving(true)
    const res = await updateChild(createClient(), child.id, {
      first_name: f.first_name.trim(), last_name: f.last_name.trim(), preferred_name: f.preferred_name.trim() || null, date_of_birth: f.date_of_birth,
      classroom_id: f.classroom_id || null, enrolled_on: f.enrolled_on, first_attended_on: f.first_attended_on || null,
      custody_restriction: f.custody_restriction, custody_note: f.custody_restriction ? f.custody_note.trim() : null,
      care_alert: f.care_alert.trim() || null,
      toilet_trained: f.toilet === 'auto' ? null : f.toilet === 'yes',
      daily_photos_allowed: f.daily_photos_allowed,
    })
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    onSaved()
  }

  return (
    <Modal title="Edit child" onClose={onClose} wide footer={
      <>
        <button onClick={onClose} className={BTN_QUIET}>Cancel</button>
        <button onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
      </>
    }>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className={LBL}>First name *</label><input value={f.first_name} onChange={e => set('first_name', e.target.value)} className={FLD} maxLength={80} /></div>
          <div><label className={LBL}>Last name *</label><input value={f.last_name} onChange={e => set('last_name', e.target.value)} className={FLD} maxLength={80} /></div>
          <div><label className={LBL}>Name the child is called</label><input value={f.preferred_name} onChange={e => set('preferred_name', e.target.value)} className={FLD} maxLength={80} /></div>
          <div><label className={LBL}>Date of birth *</label><input type="date" value={f.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} className={FLD} /></div>
          <HomeRoomField classrooms={classrooms} dob={f.date_of_birth} onDay={todayISO()} value={f.classroom_id}
            onChange={id => set('classroom_id', id)} currentRoomId={child.classroom_id} />
          <div><label className={LBL}>Enrolled on</label><input type="date" value={f.enrolled_on} onChange={e => set('enrolled_on', e.target.value)} className={FLD} /></div>
          <div className="sm:col-span-2"><label className={LBL}>First day of attendance</label><input type="date" value={f.first_attended_on} onChange={e => set('first_attended_on', e.target.value)} className={FLD} /></div>
        </div>

        <div className="space-y-3 rounded-2xl border border-border p-4">
          <p className="text-sm font-bold text-heading">On the live roster</p>
          <div>
            <label className={LBL}>Care alert for teachers</label>
            <input value={f.care_alert} onChange={e => set('care_alert', e.target.value)} className={FLD} maxLength={200}
              placeholder="For example: Peanut allergy, EpiPen in the office" />
            <p className="mt-1 text-xs text-muted">Shown in red on the child&apos;s card. Keep it short; full details stay in the file.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LBL}>Diapers or bathroom</label>
              <select value={f.toilet} onChange={e => set('toilet', e.target.value as 'auto' | 'yes' | 'no')} className={FLD}>
                <option value="auto">By age (diapers under 3)</option>
                <option value="no">Diapers</option>
                <option value="yes">Toilet trained</option>
              </select>
            </div>
            <label className="flex cursor-pointer items-start gap-2.5 self-end pb-2 text-sm font-semibold text-text-main">
              <input type="checkbox" checked={f.daily_photos_allowed} onChange={e => set('daily_photos_allowed', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-brand-600" />
              <span>Parents allow daily photos<span className="block text-xs font-normal text-muted">Teachers can add photos to the daily report.</span></span>
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm font-semibold text-amber-900">
            <input type="checkbox" checked={f.custody_restriction} onChange={e => set('custody_restriction', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-600" />
            <span>Custody restriction or court order on file<span className="block text-xs font-normal text-amber-800">Shows a warning at the top of the child&apos;s file. Keep the order itself under Records.</span></span>
          </label>
          {f.custody_restriction && (
            <textarea rows={3} maxLength={1000} value={f.custody_note} onChange={e => set('custody_note', e.target.value)} className={`${FLD} mt-3 resize-none`} placeholder="What staff must know, for example who may not pick the child up" />
          )}
        </div>
      </div>
    </Modal>
  )
}

/** Withdrawing starts the 1-year retention clock (10A NCAC 09 .2318) */
export function WithdrawDialog({ child, onClose, onDone }: { child: Child; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(todayISO())
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!date) { showAlert('Choose the last day the child attended or the withdrawal date.'); return }
    setSaving(true)
    const res = await withdrawChild(createClient(), child.id, date)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    onDone()
  }

  return (
    <Modal title={`Withdraw ${child.first_name}`} onClose={onClose} footer={
      <>
        <button onClick={onClose} className={BTN_QUIET}>Cancel</button>
        <button onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Withdraw</button>
      </>
    }>
      <div className="space-y-4">
        <div>
          <label className={LBL}>Withdrawal date</label>
          <input type="date" value={date} min={child.enrolled_on} onChange={e => setDate(e.target.value)} className={FLD} />
        </div>
        <p className="text-sm text-muted">
          The file stays in CareLocal. North Carolina requires a center to keep a child&apos;s records for <strong className="text-text-main">1 year after the child is no longer enrolled</strong>, so this date starts that clock. You can re-enroll the child later.
        </p>
      </div>
    </Modal>
  )
}
