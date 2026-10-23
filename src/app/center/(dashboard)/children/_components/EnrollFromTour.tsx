'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Baby, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { enrollFromTourRequest, type Classroom } from '@/lib/children'
import type { Child } from '@/lib/child-types'
import type { CenterTourRequest } from '@/lib/tours'
import { showAlert } from '@/lib/dialog'
import { BTN, BTN_PRIMARY, BTN_QUIET, FLD, LBL, Modal, todayISO } from './ui'

/**
 * On a tour request: enroll a child the family listed. The parent who asked becomes the first contact (and
 * emergency contact) but is NOT authorized for pick-up: that is a deliberate step on the child's file.
 * Shows who is already enrolled from this request so nobody is enrolled twice.
 */
export function EnrollFromTour({ request }: { request: CenterTourRequest }) {
  const router = useRouter()
  const [existing, setExisting] = useState<Child[]>([])
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [picking, setPicking] = useState<number | null>(null)
  const [f, setF] = useState({ date_of_birth: '', classroom_id: '', enrolled_on: todayISO(), first_attended_on: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('children').select('*').eq('source_tour_request_id', request.id),
      supabase.from('work_areas').select('id, name').eq('center_id', request.center_id).eq('is_active', true).order('sort_order').order('name'),
    ]).then(([kids, rooms]) => {
      setExisting((kids.data ?? []) as Child[])
      setClassrooms((rooms.data ?? []) as Classroom[])
    })
  }, [request.id, request.center_id])

  const named = request.children.filter(c => c.name?.trim())
  if (named.length === 0) return null

  const alreadyEnrolled = (name: string) => existing.some(c => c.first_name.toLowerCase() === name.trim().split(/\s+/)[0].toLowerCase())

  function startEnrolling(index: number) {
    setF(prev => ({ ...prev, date_of_birth: request.children[index]?.dob ?? '' }))
    setPicking(index)
  }

  async function enroll() {
    if (picking === null) return
    if (!f.date_of_birth) { showAlert('Enter the child’s date of birth.'); return }
    setSaving(true)
    const res = await enrollFromTourRequest(createClient(), request, picking, {
      date_of_birth: f.date_of_birth, classroom_id: f.classroom_id || null, enrolled_on: f.enrolled_on || undefined, first_attended_on: f.first_attended_on || null,
    })
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    router.push(`/center/children/${res.child.id}`)
  }

  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Enroll</div>
      <ul className="space-y-1.5">
        {request.children.map((c, i) => c.name?.trim() ? (
          <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <span className="flex items-center gap-2 text-text-main"><Baby className="h-4 w-4 text-brand-600" /> {c.name}</span>
            {alreadyEnrolled(c.name)
              ? <Link href={`/center/children/${existing.find(e => e.first_name.toLowerCase() === c.name.trim().split(/\s+/)[0].toLowerCase())?.id}`} className="text-xs font-semibold text-emerald-700 hover:underline">Enrolled · open file</Link>
              : <button type="button" onClick={() => startEnrolling(i)} className={BTN}>Enroll</button>}
          </li>
        ) : null)}
      </ul>

      {picking !== null && (
        <Modal title={`Enroll ${request.children[picking].name}`} onClose={() => setPicking(null)} footer={
          <>
            <button onClick={() => setPicking(null)} className={BTN_QUIET}>Cancel</button>
            <button onClick={enroll} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Enroll</button>
          </>
        }>
          <div className="space-y-4">
            <p className="text-sm text-muted">{request.first_name} {request.last_name} becomes the first contact. They are not authorized for pick-up until you do that on the child&apos;s file.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className={LBL}>Date of birth *</label><input type="date" value={f.date_of_birth} onChange={e => setF({ ...f, date_of_birth: e.target.value })} className={FLD} />
                {!request.children[picking].dob && <p className="mt-1 text-[11px] text-subtle">The request did not include a birth date.</p>}</div>
              <div><label className={LBL}>Classroom</label>
                <select value={f.classroom_id} onChange={e => setF({ ...f, classroom_id: e.target.value })} className={FLD}>
                  <option value="">Not assigned</option>
                  {classrooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div><label className={LBL}>Enrolled on</label><input type="date" value={f.enrolled_on} onChange={e => setF({ ...f, enrolled_on: e.target.value })} className={FLD} /></div>
              <div className="sm:col-span-2"><label className={LBL}>First day of attendance</label><input type="date" value={f.first_attended_on} onChange={e => setF({ ...f, first_attended_on: e.target.value })} className={FLD} /></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
