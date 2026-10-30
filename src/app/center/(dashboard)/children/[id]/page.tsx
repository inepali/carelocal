'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Baby, Loader2, Pencil, ShieldAlert, UserMinus, UserPlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { canOpenChildFiles, useCenterContext } from '../../context'
import { loadChildFile, reenrollChild } from '@/lib/children'
import { describeAge } from '@/lib/child-compliance'
import { formatDate } from '@/lib/compliance'
import { showAlert, showConfirm } from '@/lib/dialog'
import { ChildRecords } from '../_components/ChildRecords'
import { ContactsPanel } from '../_components/ContactsPanel'
import { ActivityPanel } from '../_components/ActivityPanel'
import { EditChildDialog, WithdrawDialog } from '../_components/EditChildDialogs'
import { BTN, Pill, todayISO } from '../_components/ui'
import { ChildPhoto } from '../_components/ChildPhoto'
import { getChildPhotoUrls } from '@/app/actions/child-photo.actions'

type Loaded = NonNullable<Awaited<ReturnType<typeof loadChildFile>>>
type Tab = 'records' | 'contacts' | 'activity'

/** One child's file: records with due dates and review, contacts and pick-up, and the audit trail. */
export default function ChildFilePage() {
  const { id } = useParams<{ id: string }>()
  const ctx = useCenterContext()
  const allowed = canOpenChildFiles(ctx)
  const [data, setData] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('records')
  const [editing, setEditing] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: { user } }, file] = await Promise.all([supabase.auth.getUser(), loadChildFile(supabase, id)])
    setUserId(user?.id ?? null)
    setData(file)
    setLoading(false)
    if (file?.child.photo_key) {
      const photos = await getChildPhotoUrls(file.child.center_id, [file.child.id])
      setPhotoUrl(photos.success ? photos.urls[file.child.id] ?? null : null)
    } else {
      setPhotoUrl(null)
    }
  }, [id])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (allowed) load(); else setLoading(false) }, [allowed, load])

  async function reenroll() {
    if (!data) return
    if (!await showConfirm(`Re-enroll ${data.child.first_name} as of today? The withdrawal date is cleared.`, { title: 'Re-enroll', confirmLabel: 'Re-enroll' })) return
    const res = await reenrollChild(createClient(), id, todayISO())
    if (!res.success) showAlert(res.error)
    load()
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>

  if (!allowed || !data) {
    return (
      <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center shadow-sm">
        <Baby className="mx-auto mb-3 h-10 w-10 text-brand-200" />
        <p className="text-muted">{allowed ? 'Child not found, or you do not have access to it.' : 'Only the owner and administrators of a child care center with Child Files turned on can open child records.'}</p>
        <Link href="/center/children" className="mt-4 inline-block text-sm font-semibold text-brand-600 hover:underline">Back to Children</Link>
      </div>
    )
  }

  const { child, guardians, records, files, audit, requirements, classrooms } = data
  const room = classrooms.find(c => c.id === child.classroom_id)?.name
  const withdrawn = child.status === 'withdrawn'
  const keepUntil = child.withdrawn_on ? (() => { const d = new Date(`${child.withdrawn_on}T12:00:00`); d.setFullYear(d.getFullYear() + 1); return formatDate(d) })() : null
  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'records', label: 'Records' },
    { id: 'contacts', label: 'Contacts & pick-up', count: guardians.length },
    { id: 'activity', label: 'Activity' },
  ]

  return (
    <div className="max-w-6xl pb-20">
      <Link href="/center/children" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> Back to Children</Link>

      {child.custody_restriction && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div><div className="font-bold">Custody restriction on file</div><p className="whitespace-pre-line text-sm">{child.custody_note}</p></div>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-5 rounded-2xl border border-border bg-white p-6 shadow-sm md:flex-row md:items-center">
        <ChildPhoto childId={child.id} initials={`${child.first_name[0] ?? ''}${child.last_name[0] ?? ''}`} url={photoUrl} onChanged={load} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-extrabold text-heading">{child.first_name} {child.last_name}</h1>
            <Pill className={withdrawn ? 'border-border bg-surface text-muted' : 'border-brand-100 bg-brand-50 text-brand-600'}>{withdrawn ? 'Withdrawn' : 'Enrolled'}</Pill>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span>{describeAge(child.date_of_birth)} · born {formatDate(child.date_of_birth)}</span>
            {child.preferred_name && <span>Goes by {child.preferred_name}</span>}
            {room && <span>{room}</span>}
            <span>Enrolled {formatDate(child.enrolled_on)}</span>
            <span>{child.first_attended_on ? `First day ${formatDate(child.first_attended_on)}` : 'First day not set'}</span>
            {withdrawn && <span>Withdrawn {formatDate(child.withdrawn_on)}{keepUntil ? ` · keep records until ${keepUntil}` : ''}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button onClick={() => setEditing(true)} className={BTN}><Pencil className="h-3.5 w-3.5" /> Edit</button>
          {withdrawn
            ? <button onClick={reenroll} className={BTN}><UserPlus className="h-3.5 w-3.5" /> Re-enroll</button>
            : <button onClick={() => setWithdrawing(true)} className={BTN}><UserMinus className="h-3.5 w-3.5" /> Withdraw</button>}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${tab === t.id ? 'bg-brand-600 text-white' : 'border border-border bg-white text-muted hover:bg-brand-50'}`}>
            {t.label}{t.count != null && <span className="ml-1.5 opacity-80">({t.count})</span>}
          </button>
        ))}
      </div>

      {tab === 'records' && <ChildRecords child={child} requirements={requirements} records={records} files={files} userId={userId} onChanged={load} />}
      {tab === 'contacts' && <ContactsPanel child={child} guardians={guardians} onChanged={load} />}
      {tab === 'activity' && <ActivityPanel audit={audit} userId={userId} />}

      {editing && <EditChildDialog child={child} classrooms={classrooms} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load() }} />}
      {withdrawing && <WithdrawDialog child={child} onClose={() => setWithdrawing(false)} onDone={() => { setWithdrawing(false); load() }} />}
    </div>
  )
}
