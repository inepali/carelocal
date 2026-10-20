'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  StaffProfile, CenterDocumentRequirement, StaffDocument,
  CenterStaffDocumentStatus,
  StaffExperience, StaffCredential, StaffReference, MIN_STAFF_REFERENCES,
  AGE_GROUP_LABELS, AgeGroup,
  EmploymentClass, EMPLOYMENT_CLASS_LABELS, appliesToEmploymentClass, DocumentRequest
} from '@/lib/types'
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, FileText,
  MessageSquare, Loader2, ShieldCheck, User, Briefcase,
  Award, CalendarDays, MapPin, Phone, Mail, CreditCard,
  AlertTriangle, Star, GraduationCap, Eye
} from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCenterContext } from '../../context'
import { StaffAvatar } from '@/components/StaffAvatar'
import { ComplianceRecord } from './_components/ComplianceRecord'
import { RequestDocumentsDialog } from '@/components/center/RequestDocumentsDialog'
import { computeCompliance } from '@/lib/compliance'
import { openStoredFile } from '@/lib/files'
import { snapshotAcceptedDocuments } from '@/app/actions/document-snapshots.actions'
import { useLookups } from '@/hooks/use-lookups'
import { lookupLabel } from '@/lib/lookups'
import { showAlert, showConfirm } from '@/lib/dialog'

// ─── Helpers ────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function monthYearStr(month?: number, year?: number, isCurrent?: boolean) {
  if (isCurrent) return 'Present'
  if (!month || !year) return ''
  return `${MONTHS[month - 1]} ${year}`
}

function getExpiryStatus(expiryDate?: string): 'valid' | 'soon' | 'expired' | null {
  if (!expiryDate) return null
  const diff = (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  if (diff < 0) return 'expired'
  if (diff <= 60) return 'soon'
  return 'valid'
}

const EXPIRY_BADGE = {
  valid:   { label: 'Valid',        className: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  soon:    { label: 'Expires Soon', className: 'bg-amber-50  text-amber-700  border-amber-200',    Icon: AlertTriangle },
  expired: { label: 'Expired',      className: 'bg-red-50    text-red-700    border-red-200',      Icon: XCircle },
}

const DAYS_MAP: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun'
}


type TabId = 'overview' | 'education' | 'experience' | 'references' | 'credentials' | 'availability' | 'documents' | 'carescore'

// ─── Page ────────────────────────────────────────────────────────────────────

export default function StaffReviewPage() {
  const { staffTerm } = useCenterContext()
  const { data: roleLookups } = useLookups('Role')
  const { data: paymentLookups } = useLookups('Payment Method')
  const { id: staffId } = useParams()
  const supabase = createClient()

  const [loading, setLoading]         = useState(true)
  const [profile, setProfile]         = useState<StaffProfile | null>(null)
  const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])
  const [uploads, setUploads]         = useState<StaffDocument[]>([])
  const [statuses, setStatuses]       = useState<CenterStaffDocumentStatus[]>([])
  const [experiences, setExperiences] = useState<StaffExperience[]>([])
  const [references, setReferences] = useState<StaffReference[]>([])
  const [credentials, setCredentials] = useState<StaffCredential[]>([])
  const [centerId, setCenterId]       = useState<string | null>(null)
  const [activeTab, setActiveTab]     = useState<TabId>('overview')
  const [showActivationModal, setShowActivationModal] = useState(false)
  const [memberStatus, setMemberStatus] = useState<string | null>(null)
  const [requestedClass, setRequestedClass] = useState<EmploymentClass | null>(null)
  const [approveClass, setApproveClass] = useState<EmploymentClass>('substitute')
  const [activating, setActivating]   = useState(false)
  const [reviews, setReviews]         = useState<any[]>([])
  const [internalDocs, setInternalDocs] = useState<any[]>([])
  const catchUpDone = useRef(false)
  const [employmentClass, setEmploymentClass] = useState<EmploymentClass>('substitute')
  const [startDate, setStartDate] = useState('')
  const [viewerRole, setViewerRole] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [targetCenterRole, setTargetCenterRole] = useState<string | null>(null)
  const [savingAccess, setSavingAccess] = useState(false)
  const [openRequests, setOpenRequests] = useState<DocumentRequest[]>([])
  const [requestFor, setRequestFor] = useState<{ requirementId?: string } | null>(null)
  const [savingClass, setSavingClass] = useState(false)
  

  useEffect(() => { loadData() }, [staffId])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id, role')
      .eq('user_id', user.id)
      .single()

    if (!admin) return
    setCenterId(admin.center_id)
    setViewerRole(admin.role)
    setCurrentUserId(user.id)
    const { data: targetRole } = await supabase.rpc('staff_center_role', { p_center_id: admin.center_id, p_staff_id: staffId })
    setTargetCenterRole((targetRole as string | null) ?? null)

    // 1. Staff Profile (full)
    const { data: staffProfile } = await supabase
      .from('staff_profiles')
      .select('*')
      .eq('id', staffId)
      .single()
    setProfile(staffProfile)

    if (staffProfile) {
      // 2. Employment class at this center + requirements that apply to it
      const { data: membership } = await supabase
        .from('center_staff')
        .select('status, employment_class, employment_start_date, requested_employment_class')
        .eq('center_id', admin.center_id)
        .eq('staff_id', staffId)
        .maybeSingle()
      const memberClass: EmploymentClass = membership?.employment_class || 'substitute'
      setEmploymentClass(memberClass)
      setMemberStatus(membership?.status ?? null)
      setRequestedClass((membership?.requested_employment_class as EmploymentClass | null) ?? staffProfile.requested_employment_class ?? null)
      setApproveClass((membership?.requested_employment_class as EmploymentClass | null) ?? memberClass)
      setStartDate(membership?.employment_start_date ?? '')

      const { data: reqs } = await supabase
        .from('center_document_requirements')
        .select('*')
        .eq('center_id', admin.center_id)
        .order('sort_order', { ascending: true })
      setRequirements((reqs || []).filter(r => appliesToEmploymentClass(r, memberClass)))

      // 3. Staff vault docs
      const { data: staffDocs } = await supabase
        .from('staff_documents')
        .select('*')
        .eq('staff_id', staffId)
      setUploads(staffDocs || [])

      // 4. Review statuses
      const { data: reviewStatuses } = await supabase
        .from('center_staff_document_status')
        .select('*')
        .eq('center_id', admin.center_id)
        .eq('staff_id', staffId)
      setStatuses(reviewStatuses || [])

      const { data: requestRows } = await supabase
        .from('document_requests')
        .select('*')
        .eq('center_id', admin.center_id)
        .eq('staff_id', staffId)
        .in('status', ['open', 'submitted'])
      setOpenRequests(requestRows || [])

      // 5. Experiences
      const { data: exp } = await supabase
        .from('staff_experiences')
        .select('*')
        .eq('staff_id', staffId)
        .order('sort_order', { ascending: true })
      setExperiences(exp || [])

      const { data: refs } = await supabase
        .from('staff_references')
        .select('*')
        .eq('staff_id', staffId)
        .order('created_at', { ascending: true })
      setReferences(refs || [])

      // 6. Credentials (with linked docs)
      const { data: creds } = await supabase
        .from('staff_credentials')
        .select('*, linked_document:staff_documents(id, document_name)')
        .eq('staff_id', staffId)
        .order('sort_order', { ascending: true })
      setCredentials(creds || [])

      // 7. Reviews
      const { data: reviewsData } = await supabase
        .from('shift_reviews')
        .select('*')
        .eq('reviewee_id', staffId)
        .eq('reviewer_type', 'center')
      
      if (reviewsData && reviewsData.length > 0) {
        const cIds = reviewsData.map((r: any) => r.reviewer_id)
        const { data: cData } = await supabase.from('centers').select('id, name').in('id', cIds)
        const cMap = (cData || []).reduce((acc: any, curr: any) => { acc[curr.id] = curr.name; return acc; }, {})
        const enrichedReviews = reviewsData.map((r: any) => ({
          ...r,
          reviewer_name: cMap[r.reviewer_id] || 'Center'
        }))
        setReviews(enrichedReviews)
      } else {
        setReviews([])
      }

      // 8. Internal Docs (catch error if migration not run yet)
      const { data: intDocs, error: intDocsErr } = await supabase
        .from('center_internal_documents')
        .select('*')
        .eq('staff_id', staffId)
        .eq('center_id', admin.center_id)
        .order('uploaded_at', { ascending: false })
      if (!intDocsErr) {
        setInternalDocs(intDocs || [])
      }

      // Make sure everything this center accepted has its own copy (also covers older accepts)
      if (!catchUpDone.current) {
        catchUpDone.current = true
        snapshotAcceptedDocuments(admin.center_id, staffId as string).then(async res => {
          if (!res.success || res.copied === 0) return
          const { data: refreshed } = await supabase
            .from('center_internal_documents').select('*')
            .eq('staff_id', staffId).eq('center_id', admin.center_id)
            .order('uploaded_at', { ascending: false })
          setInternalDocs(refreshed || [])
        })
      }
    }
    setLoading(false)
  }

  // Applicant flow: applying -> (start onboarding) invited -> (approve) active
  async function handleActivateStaff() {
    setActivating(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: admin } = await supabase.from('center_admins').select('center_id').eq('user_id', user!.id).single()
    const starting = memberStatus === 'applying'
    const { error } = await supabase.from('center_staff')
      .update(starting
        ? { status: 'invited', employment_class: approveClass }
        : { status: 'active', employment_class: approveClass, added_at: new Date().toISOString() })
      .eq('center_id', admin!.center_id).eq('staff_id', staffId)
    setActivating(false)
    setShowActivationModal(false)
    if (!error) { loadData() }
    else showAlert((starting ? 'Failed to start onboarding: ' : 'Failed to approve: ') + error.message)
  }

  async function handleDeclineApplication() {
    if (!await showConfirm('Decline this application? They will no longer appear in your onboarding list.')) return
    const { data: { user } } = await supabase.auth.getUser()
    const { data: admin } = await supabase.from('center_admins').select('center_id').eq('user_id', user!.id).single()
    const { error } = await supabase.from('center_staff').update({ status: 'removed' })
      .eq('center_id', admin!.center_id).eq('staff_id', staffId)
    if (error) showAlert('Failed to decline: ' + error.message)
    else window.location.href = '/center/team_member'
  }

  async function handleChangeEmploymentClass(next: EmploymentClass) {
    if (!centerId || next === employmentClass) return
    const message = next === 'regular'
      ? `Mark as Regular employee? They will no longer see, claim, or be notified about open shifts at this center, any pending shift requests here will be withdrawn, and their document checklist will switch to Regular requirements.`
      : `Mark as Substitute? They will see and be notified about open shifts at this center again, and their document checklist will switch to Substitute requirements.`
    if (!await showConfirm(message)) return

    setSavingClass(true)
    const { error } = await supabase.from('center_staff').update({ employment_class: next })
      .eq('center_id', centerId).eq('staff_id', staffId)
    setSavingClass(false)
    if (!error) { loadData() }
    else showAlert('Failed to update employee class: ' + error.message)
  }

  async function handleToggleAdmin(makeAdmin: boolean) {
    if (!centerId || !profile) return
    const name = `${profile.first_name} ${profile.last_name}`
    const message = makeAdmin
      ? `Make ${name} an Admin? They will be able to manage this center, including staff documents and confidential medical files. Their own checklist still applies and they cannot approve their own documents.`
      : `Remove Admin access for ${name}? They will remain an employee.`
    if (!await showConfirm(message)) return

    setSavingAccess(true)
    const { error } = await supabase.rpc('set_center_admin_access', { p_center_id: centerId, p_staff_id: staffId, p_is_admin: makeAdmin })
    setSavingAccess(false)
    if (error) showAlert(error.message)
    else loadData()
  }

  async function handleChangeStartDate(next: string) {
    if (!centerId || !next || next === startDate) return
    const previous = startDate
    setStartDate(next)
    const { error } = await supabase.from('center_staff').update({ employment_start_date: next })
      .eq('center_id', centerId).eq('staff_id', staffId)
    if (error) {
      setStartDate(previous)
      showAlert('Failed to update employment start date: ' + error.message)
    }
  }

  if (loading) return (
    <div className="max-w-5xl mx-auto p-8 animate-pulse space-y-6">
      <div className="h-8 w-40 bg-slate-200 rounded" />
      <div className="h-40 bg-white rounded-3xl border border-border" />
      <div className="h-72 bg-white rounded-3xl border border-border" />
    </div>
  )
  if (!profile) return <div className="p-8 text-muted font-medium">{staffTerm} member not found.</div>

  const TABS: { id: TabId; label: string; Icon: any }[] = [
    { id: 'overview',     label: 'Overview',     Icon: User },
    { id: 'education',    label: 'Education',    Icon: GraduationCap },
    { id: 'experience',   label: 'Experience',   Icon: Briefcase },
    { id: 'references',   label: 'References',   Icon: Phone },
    { id: 'credentials',  label: 'Credentials',  Icon: Award },
    { id: 'availability', label: 'Availability', Icon: CalendarDays },
    { id: 'documents',    label: 'Documents',    Icon: ShieldCheck },
    { id: 'carescore',    label: 'Care Score',   Icon: Star },
  ]

  // Compliance progress: every applicable requirement (incl. center records), N/A excluded
  const complianceResults = requirements.map(req => {
    const record = statuses.find(s => s.requirement_id === req.id)
    const doc = record?.matched_document_id ? uploads.find(u => u.id === record.matched_document_id) : undefined
    return { record, result: computeCompliance(req, record, startDate || null, doc?.expiry_date) }
  })
  const totalReqs = complianceResults.filter(r => r.result.state !== 'not_applicable').length
  const acceptedCount = complianceResults.filter(r => r.record?.status === 'accepted' && (r.result.state === 'current' || r.result.state === 'due_soon')).length
  const attentionCount = complianceResults.filter(r => r.result.state === 'overdue' || r.result.state === 'pending_review').length

  return (
    <div className="max-w-5xl mx-auto pb-20 px-4">
      {/* Back */}
      <div className="mb-8">
        <Link href="/center/team_member" className="inline-flex items-center gap-2 text-sm text-muted hover:text-brand-600 transition-colors font-bold">
          <ArrowLeft className="w-4 h-4" /> Back to {staffTerm} Pool
        </Link>
      </div>

      {/* Header card */}
      <div className="bg-white border-2 border-border rounded-[2.5rem] shadow-sm mb-8 overflow-hidden">
        <div className="p-8 bg-surface border-b-2 border-border flex flex-col md:flex-row items-start md:items-center gap-6">
          <StaffAvatar
            avatarKey={profile.avatar_url}
            firstName={profile.first_name}
            lastName={profile.last_name}
            className="w-24 h-24 rounded-[2rem] bg-brand-600 text-white text-4xl font-black shadow-xl shadow-brand-600/25"
          />
          <div className="flex-1">
            <h1 className="text-3xl font-black text-heading tracking-tight mb-1">
              {profile.first_name} {profile.last_name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <span className="bg-brand-50 text-brand-600 px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest border border-brand-100">
                {lookupLabel(roleLookups, profile.staff_type)}
              </span>
              <select
                value={employmentClass}
                disabled={savingClass}
                onChange={(e) => handleChangeEmploymentClass(e.target.value as EmploymentClass)}
                title="Employee class at this center"
                className="bg-white text-brand-600 px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest border border-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-600/30 disabled:opacity-50"
              >
                {(Object.entries(EMPLOYMENT_CLASS_LABELS) as [EmploymentClass, string][]).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              {requestedClass && requestedClass !== employmentClass && (
                <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-lg text-xs font-bold border border-amber-200" title="Chosen by the employee at sign-up. Change the class here to confirm.">
                  Requested: {EMPLOYMENT_CLASS_LABELS[requestedClass]}
                </span>
              )}
              <label className="inline-flex items-center gap-2 bg-white px-3 py-1 rounded-lg text-xs font-bold text-muted border border-brand-100" title="Due dates are counted from this date">
                Started
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => handleChangeStartDate(e.target.value)}
                  className="bg-transparent text-brand-600 font-black focus:outline-none"
                />
              </label>
              {targetCenterRole === 'owner' ? (
                <span className="inline-flex items-center gap-1.5 bg-brand-900 text-white px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest">
                  <ShieldCheck className="w-3.5 h-3.5" /> Owner
                </span>
              ) : viewerRole === 'owner' ? (
                <button
                  type="button"
                  disabled={savingAccess || (targetCenterRole !== 'admin' && employmentClass !== 'regular')}
                  onClick={() => handleToggleAdmin(targetCenterRole !== 'admin')}
                  title={targetCenterRole !== 'admin' && employmentClass !== 'regular' ? 'Only Regular employees can be made Admin' : undefined}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest border transition-colors disabled:opacity-50 ${
                    targetCenterRole === 'admin'
                      ? 'bg-brand-900 text-white border-brand-900 hover:bg-brand-600'
                      : 'bg-white text-brand-600 border-brand-100 hover:bg-brand-50'
                  }`}
                >
                  {savingAccess ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  {targetCenterRole === 'admin' ? 'Admin · Remove' : 'Make Admin'}
                </button>
              ) : targetCenterRole === 'admin' ? (
                <span className="inline-flex items-center gap-1.5 bg-brand-900 text-white px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest">
                  <ShieldCheck className="w-3.5 h-3.5" /> Admin
                </span>
              ) : null}
              {totalReqs > 0 && (
                <span className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest border ${
                  acceptedCount === totalReqs ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                  {acceptedCount}/{totalReqs} Complete
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-muted font-medium">
              <span className="flex items-center gap-1.5"><Mail className="w-4 h-4 text-subtle" />{profile.email}</span>
              {profile.phone && <span className="flex items-center gap-1.5"><Phone className="w-4 h-4 text-subtle" />{profile.phone}</span>}
              {(profile.city || profile.state) && (
                <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-subtle" />{profile.city}{profile.city && profile.state ? ', ' : ''}{profile.state}</span>
              )}
            </div>
          </div>
          {(memberStatus === 'applying' || memberStatus === 'invited') && (
            <div className="flex items-center gap-3 shrink-0">
              {memberStatus === 'applying' && (
                <button
                  onClick={handleDeclineApplication}
                  className="px-5 py-4 rounded-2xl font-black text-muted bg-white border-2 border-border hover:bg-surface transition-colors"
                >
                  Decline
                </button>
              )}
              <button
                onClick={() => setShowActivationModal(true)}
                className="bg-brand-600 text-white font-black px-8 py-4 rounded-2xl hover:bg-brand-800 shadow-lg shadow-brand-600/20 transition-all flex items-center gap-2 active:scale-95"
              >
                <CheckCircle2 className="w-5 h-5" /> {memberStatus === 'applying' ? 'Start Onboarding' : 'Approve & Activate'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200 mb-8">
        <nav className="-mb-px flex space-x-8 overflow-x-auto scrollbar-none" aria-label="Tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group inline-flex items-center border-b-2 py-4 px-1 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              <tab.Icon
                className={`-ml-0.5 mr-2 h-5 w-5 ${
                  activeTab === tab.id ? 'text-brand-600' : 'text-gray-400 group-hover:text-gray-500'
                }`}
                aria-hidden="true"
              />
              <span>{tab.label}</span>
              {tab.id === 'documents' && attentionCount > 0 && (
                <span className="ml-2 bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full" title="Overdue or needs review">
                  {attentionCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Overview Tab ───────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Bio */}
          <div className="bg-white border-2 border-border rounded-[2rem] p-8">
            <h2 className="text-lg font-black text-heading mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-brand-600" /> About
            </h2>
            {profile.bio ? (
              <p className="text-text-muted leading-relaxed">{profile.bio}</p>
            ) : (
              <p className="text-subtle italic text-sm">No bio provided.</p>
            )}
          </div>

          {/* Payment preferences */}
          {(profile as any).preferred_payment_methods?.length > 0 && (
            <div className="bg-white border-2 border-border rounded-[2rem] p-8">
              <h2 className="text-lg font-black text-heading mb-4 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-brand-600" /> Payment Preferences
              </h2>
              <div className="flex flex-wrap gap-2">
                {(profile as any).preferred_payment_methods.map((m: string) => (
                  <span key={m} className="px-4 py-2 bg-brand-50 text-brand-600 border border-brand-100 rounded-xl text-sm font-black">
                    {lookupLabel(paymentLookups, m)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quick stats */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="bg-white border-2 border-border rounded-2xl p-6 text-center">
              <div className="text-3xl font-black text-brand-600 mb-1">{experiences.length}</div>
              <div className="text-xs font-black text-muted uppercase tracking-widest">Work Experiences</div>
            </div>
            <div className="bg-white border-2 border-border rounded-2xl p-6 text-center">
              <div className="text-3xl font-black text-brand-600 mb-1">{credentials.length}</div>
              <div className="text-xs font-black text-muted uppercase tracking-widest">Credentials</div>
            </div>
            <div className="bg-white border-2 border-border rounded-2xl p-6 text-center">
              <div className="text-3xl font-black text-brand-600 mb-1">{(profile as any).available_days?.length || 0}</div>
              <div className="text-xs font-black text-muted uppercase tracking-widest">Days Available</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Education Tab ──────────────────────────────────────────── */}
      {activeTab === 'education' && (
        <div className="space-y-4">
          {uploads.filter(d => d.document_category === 'academic_qualification').length === 0 ? (
            <div className="text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-border">
              <GraduationCap className="w-10 h-10 text-subtle mx-auto mb-3" />
              <p className="text-muted font-bold">No education added yet.</p>
            </div>
          ) : (
            uploads.filter(d => d.document_category === 'academic_qualification').map(doc => (
              <div key={doc.id} className="bg-white border-2 border-border rounded-2xl p-6 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                  <GraduationCap className="w-5 h-5 text-brand-600" />
                </div>
                <div className="flex-1">
                  <div className="font-black text-heading text-lg leading-tight">{doc.document_name}</div>
                  <div className="text-xs font-bold text-subtle uppercase tracking-wider mt-1">
                    Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                    {doc.expiry_date ? ` · Expires ${new Date(doc.expiry_date).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <button onClick={() => openStoredFile('vault', doc.id)} className="rounded-lg p-2 text-brand-600 hover:bg-brand-50" title="View Document">
                  <Eye className="w-5 h-5" />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Care Score Tab ─────────────────────────────────────────── */}
      {activeTab === 'carescore' && (
        <div className="space-y-4">
          {reviews.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-border">
              <Star className="w-10 h-10 text-subtle mx-auto mb-3" />
              <p className="text-muted font-bold">No Care Score ratings yet.</p>
            </div>
          ) : (
            <>
              <div className="bg-white border-2 border-border rounded-2xl p-6 flex items-center gap-4">
                <Star className="w-8 h-8 text-amber-400 fill-amber-400" />
                <div>
                  <div className="text-3xl font-black text-heading leading-none">
                    {(reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)}
                    <span className="text-base text-subtle font-bold"> / 5</span>
                  </div>
                  <div className="text-xs font-black text-muted uppercase tracking-widest mt-1">
                    {reviews.length} rating{reviews.length === 1 ? '' : 's'} from centers
                  </div>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {reviews.map(review => (
                  <div key={review.id} className="p-5 rounded-2xl bg-white border-2 border-border">
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-black text-text-main text-sm">{review.reviewer_name}</div>
                      <div className="flex gap-1">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} className={`w-4 h-4 ${i < review.rating ? 'text-amber-400 fill-amber-400' : 'text-border fill-transparent'}`} />
                        ))}
                      </div>
                    </div>
                    {review.tags && review.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {review.tags.map((tag: string) => (
                          <span key={tag} className="text-[9px] font-black uppercase tracking-widest bg-brand-50 text-brand-600 px-2 py-1 rounded-md border border-brand-100">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {review.public_comment && (
                      <p className="text-sm text-text-muted italic bg-surface p-3 rounded-xl border border-border">"{review.public_comment}"</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Experience Tab ─────────────────────────────────────────── */}
      {activeTab === 'experience' && (
        <div className="space-y-4">
          {experiences.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-border">
              <Briefcase className="w-10 h-10 text-subtle mx-auto mb-3" />
              <p className="text-muted font-bold">No work experience added yet.</p>
            </div>
          ) : (
            experiences.map(item => (
              <div key={item.id} className="bg-white border-2 border-border rounded-2xl p-6 flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                  <Briefcase className="w-5 h-5 text-brand-600" />
                </div>
                <div className="flex-1">
                  <div className="font-black text-heading text-lg leading-tight">{item.employer}</div>
                  <div className="font-bold text-muted mb-2">{item.role}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold text-subtle uppercase tracking-wider">
                      {monthYearStr(item.start_month, item.start_year)}
                      {(item.start_month || item.start_year) ? ' – ' : ''}
                      {monthYearStr(item.end_month, item.end_year, item.is_current)}
                    </span>
                    {item.age_group && (
                      <span className="bg-surface text-muted border border-border px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest">
                        {AGE_GROUP_LABELS[item.age_group as AgeGroup]}
                      </span>
                    )}
                    {item.is_current && (
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest">
                        Current
                      </span>
                    )}
                  </div>
                  {item.description && <p className="text-sm text-muted mt-3 leading-relaxed">{item.description}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── References Tab ─────────────────────────────────────────── */}
      {activeTab === 'references' && (
        <div className="space-y-4">
          {references.length < MIN_STAFF_REFERENCES && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-medium text-amber-800">
              {references.length} of {MIN_STAFF_REFERENCES} required references provided.
            </div>
          )}
          {references.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-border">
              <Phone className="w-10 h-10 text-subtle mx-auto mb-3" />
              <p className="text-muted font-bold">No references added yet.</p>
            </div>
          ) : (
            references.map(ref => (
              <div key={ref.id} className="bg-white border-2 border-border rounded-2xl p-6">
                <div className="font-black text-heading text-lg leading-tight">{ref.full_name}</div>
                <div className="font-bold text-muted mb-3">{ref.title} · {ref.business}</div>
                <div className="flex flex-wrap gap-4 text-sm text-muted font-medium">
                  <a href={`mailto:${ref.email}`} className="flex items-center gap-1.5 hover:text-brand-600"><Mail className="w-4 h-4 text-subtle" />{ref.email}</a>
                  <a href={`tel:${ref.phone}`} className="flex items-center gap-1.5 hover:text-brand-600"><Phone className="w-4 h-4 text-subtle" />{ref.phone}</a>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Credentials Tab ────────────────────────────────────────── */}
      {activeTab === 'credentials' && (
        <div className="space-y-4">
          {credentials.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-border">
              <Award className="w-10 h-10 text-subtle mx-auto mb-3" />
              <p className="text-muted font-bold">No credentials added yet.</p>
            </div>
          ) : (
            credentials.map(item => {
              const status = getExpiryStatus(item.expiry_date)
              const badge  = status ? EXPIRY_BADGE[status] : null
              return (
                <div key={item.id} className={`bg-white border-2 rounded-2xl p-6 flex items-start gap-4 ${
                  status === 'expired' ? 'border-red-100 bg-red-50/20' :
                  status === 'soon'    ? 'border-amber-100 bg-amber-50/10' :
                  'border-border'
                }`}>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                    status === 'expired' ? 'bg-red-100' : status === 'soon' ? 'bg-amber-100' : 'bg-brand-50'
                  }`}>
                    <Award className={`w-5 h-5 ${status === 'expired' ? 'text-red-500' : status === 'soon' ? 'text-amber-500' : 'text-brand-600'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="font-black text-heading text-lg leading-tight">{item.credential_name}</div>
                    {item.issuing_body && <div className="font-bold text-muted mb-2">{item.issuing_body}</div>}
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {item.issue_date && (
                        <span className="text-[10px] font-bold text-subtle">
                          Issued {new Date(item.issue_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </span>
                      )}
                      {item.expiry_date && (
                        <span className="text-[10px] font-bold text-subtle">
                          · Expires {new Date(item.expiry_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </span>
                      )}
                      {badge && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[9px] font-black uppercase tracking-wider ${badge.className}`}>
                          <badge.Icon className="w-2.5 h-2.5" /> {badge.label}
                        </span>
                      )}
                    </div>
                    {item.credential_number && (
                      <div className="text-[10px] text-subtle font-bold mt-1">#{item.credential_number}</div>
                    )}
                    {item.linked_document && (
                      <div className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-black text-brand-600 bg-brand-50 border border-brand-100 px-3 py-1 rounded-lg">
                        <FileText className="w-3 h-3" /> {(item.linked_document as any).document_name}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── Availability Tab ───────────────────────────────────────── */}
      {activeTab === 'availability' && (
        <div className="bg-white border-2 border-border rounded-[2rem] p-8 space-y-8">
          {/* Days */}
          <div>
            <h3 className="text-sm font-black text-heading uppercase tracking-widest mb-4 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-brand-600" /> Available Days
            </h3>
            {(profile as any).available_days?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(profile as any).available_days.map((d: string) => (
                  <span key={d} className="w-14 h-14 rounded-2xl bg-brand-600 text-white flex items-center justify-center font-black text-sm shadow-md shadow-brand-600/20">
                    {DAYS_MAP[d] || d}
                  </span>
                ))}
              </div>
            ) : <p className="text-subtle italic text-sm">No days specified.</p>}
          </div>

          {/* Hours */}
          {((profile as any).available_from || (profile as any).available_to) && (
            <div>
              <h3 className="text-sm font-black text-heading uppercase tracking-widest mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4 text-brand-600" /> Preferred Shift Hours
              </h3>
              <div className="flex items-center gap-3">
                <span className="bg-surface border-2 border-border px-5 py-3 rounded-xl font-black text-heading">
                  {(profile as any).available_from || '–'}
                </span>
                <span className="text-subtle font-black">→</span>
                <span className="bg-surface border-2 border-border px-5 py-3 rounded-xl font-black text-heading">
                  {(profile as any).available_to || '–'}
                </span>
              </div>
            </div>
          )}

          {/* Notes */}
          {(profile as any).availability_notes && (
            <div>
              <h3 className="text-sm font-black text-heading uppercase tracking-widest mb-3 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-brand-600" /> Availability Notes
              </h3>
              <p className="text-text-muted leading-relaxed bg-surface p-4 rounded-xl border-2 border-border">
                {(profile as any).availability_notes}
              </p>
            </div>
          )}

          {!(profile as any).available_days?.length && !(profile as any).available_from && !(profile as any).availability_notes && (
            <div className="text-center py-12">
              <CalendarDays className="w-10 h-10 text-subtle mx-auto mb-3" />
              <p className="text-muted font-bold">No availability information provided yet.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Documents / Compliance Tab ─────────────────────────────── */}
      {activeTab === 'documents' && centerId && (
        <ComplianceRecord
          centerId={centerId}
          staffId={String(staffId)}
          requirements={requirements}
          statuses={statuses}
          uploads={uploads}
          centerFiles={internalDocs}
          startDate={startDate || null}
          canViewConfidential={viewerRole === 'owner' || viewerRole === 'admin'}
          isSelf={!!currentUserId && profile.user_id === currentUserId}
          onChanged={loadData}
          openRequests={openRequests}
          onRequest={(requirementId) => setRequestFor({ requirementId })}
        />
      )}


      {requestFor && centerId && (
        <RequestDocumentsDialog
          centerId={centerId}
          initialStaffIds={[String(staffId)]}
          initialRequirementId={requestFor.requirementId}
          onClose={() => setRequestFor(null)}
          onCreated={(count) => {
            setRequestFor(null)
            if (count === 0) showAlert('There is already an open request for this item.')
            loadData()
          }}
        />
      )}

      {/* ── Activation Modal ───────────────────────────────────────── */}
      {showActivationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-border">
            <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mb-6 border-2 border-brand-100">
              <ShieldCheck className="w-8 h-8 text-brand-600" />
            </div>
            <h2 className="text-2xl font-black text-heading mb-2">{memberStatus === 'applying' ? 'Start Onboarding?' : 'Approve Staff Member?'}</h2>
            <p className="text-muted font-medium leading-relaxed mb-8">
              {memberStatus === 'applying'
                ? <>Accepting <span className="font-bold text-text-main">{profile.first_name} {profile.last_name}</span>&apos;s application starts their onboarding: they complete the checklist for the class you choose below. They cannot claim shifts until you approve them.</>
                : <>By approving <span className="font-bold text-text-main">{profile.first_name} {profile.last_name}</span>, they will instantly be able to view and claim open shifts at your center.</>}
            </p>
            <label className="block text-xs font-black text-heading uppercase tracking-widest mb-2">Employee class</label>
            <select value={approveClass} onChange={(e) => setApproveClass(e.target.value as EmploymentClass)} className="w-full mb-2 px-4 py-3 rounded-xl border-2 border-border bg-white font-bold text-heading focus:outline-none focus:border-brand-600">
              {(Object.entries(EMPLOYMENT_CLASS_LABELS) as [EmploymentClass, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}{requestedClass === value ? ' (requested)' : ''}</option>
              ))}
            </select>
            <p className="text-xs text-muted mb-8">Regular employees can work at only one center and do not pick up marketplace shifts.</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowActivationModal(false)}
                disabled={activating}
                className="flex-1 px-5 py-3 rounded-xl font-bold text-muted bg-surface border-2 border-border hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleActivateStaff}
                disabled={activating}
                className="flex-[2] flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-black text-white bg-brand-600 hover:bg-brand-800 disabled:opacity-70 transition-colors shadow-lg shadow-brand-600/20"
              >
                {activating ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle2 className="w-5 h-5" /> {memberStatus === 'applying' ? 'Start Onboarding' : 'Confirm Activation'}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
