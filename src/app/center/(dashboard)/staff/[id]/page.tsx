'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  StaffProfile, CenterDocumentRequirement, StaffDocument,
  CenterStaffDocumentStatus, DocReviewStatus, STAFF_TYPE_LABELS,
  StaffType, StaffExperience, StaffCredential,
  AGE_GROUP_LABELS, AgeGroup
} from '@/lib/types'
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, FileText, ExternalLink,
  MessageSquare, AlertCircle, Loader2, ShieldCheck, User, Briefcase,
  Award, CalendarDays, MapPin, Phone, Mail, CreditCard,
  AlertTriangle, Globe, Star
} from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { getPresignedViewUrl } from '@/app/actions/storage.actions'

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

const PAYMENT_LABELS: Record<string, string> = {
  payroll: '🏢 Payroll', direct_deposit: '🏦 Direct Deposit', check: '📝 Check',
  cash: '💵 Cash', zelle: '⚡ Zelle', venmo: '💙 Venmo', cashapp: '💚 Cash App', paypal: '🅿️ PayPal'
}

type TabId = 'overview' | 'experience' | 'credentials' | 'availability' | 'documents'

// ─── Page ────────────────────────────────────────────────────────────────────

export default function StaffReviewPage() {
  const { id: staffId } = useParams()
  const supabase = createClient()

  const [loading, setLoading]         = useState(true)
  const [profile, setProfile]         = useState<StaffProfile | null>(null)
  const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])
  const [uploads, setUploads]         = useState<StaffDocument[]>([])
  const [statuses, setStatuses]       = useState<CenterStaffDocumentStatus[]>([])
  const [experiences, setExperiences] = useState<StaffExperience[]>([])
  const [credentials, setCredentials] = useState<StaffCredential[]>([])
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [centerId, setCenterId]       = useState<string | null>(null)
  const [activeTab, setActiveTab]     = useState<TabId>('overview')
  const [showActivationModal, setShowActivationModal] = useState(false)
  const [activating, setActivating]   = useState(false)
  const [reviews, setReviews]         = useState<any[]>([])

  useEffect(() => { loadData() }, [staffId])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    if (!admin) return
    setCenterId(admin.center_id)

    // 1. Staff Profile (full)
    const { data: staffProfile } = await supabase
      .from('staff_profiles')
      .select('*')
      .eq('id', staffId)
      .single()
    setProfile(staffProfile)

    if (staffProfile) {
      // 2. Center Requirements
      const { data: reqs } = await supabase
        .from('center_document_requirements')
        .select('*')
        .eq('center_id', admin.center_id)
        .order('sort_order', { ascending: true })
      setRequirements(reqs || [])

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

      // 5. Experiences
      const { data: exp } = await supabase
        .from('staff_experiences')
        .select('*')
        .eq('staff_id', staffId)
        .order('sort_order', { ascending: true })
      setExperiences(exp || [])

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
    }
    setLoading(false)
  }

  async function handleView(fileKey?: string, bucketName?: string, fallbackUrl?: string) {
    if (!fileKey || !bucketName) {
      if (fallbackUrl) window.open(fallbackUrl, '_blank')
      else alert('No file access info available')
      return
    }
    const res = await getPresignedViewUrl(fileKey, bucketName)
    if (res.success && res.url) window.open(res.url, '_blank')
    else alert(res.error || 'Failed to generate access link')
  }

  async function handleReview(requirementId: string, matchedDocId: string | null, status: DocReviewStatus) {
    setReviewingId(requirementId)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: admin } = await supabase.from('center_admins').select('center_id').eq('user_id', user!.id).single()
    const payload = {
      center_id: admin!.center_id, staff_id: staffId, requirement_id: requirementId,
      matched_document_id: matchedDocId, status, center_reviewed: true,
      reviewed_by: user!.id, reviewed_at: new Date().toISOString(), review_notes: reviewNotes
    }
    const existing = statuses.find(s => s.requirement_id === requirementId)
    const { error } = existing
      ? await supabase.from('center_staff_document_status').update(payload).eq('id', existing.id)
      : await supabase.from('center_staff_document_status').insert(payload)
    if (!error) { setReviewNotes(''); setReviewingId(null); loadData() }
    else { alert('Failed to save review.'); setReviewingId(null) }
  }

  async function handleActivateStaff() {
    setActivating(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: admin } = await supabase.from('center_admins').select('center_id').eq('user_id', user!.id).single()
    const { error } = await supabase.from('center_staff').update({ status: 'active', added_at: new Date().toISOString() })
      .eq('center_id', admin!.center_id).eq('staff_id', staffId)
    setActivating(false)
    setShowActivationModal(false)
    if (!error) { loadData() }
    else alert('Failed to approve: ' + error.message)
  }

  if (loading) return (
    <div className="max-w-5xl mx-auto p-8 animate-pulse space-y-6">
      <div className="h-8 w-40 bg-slate-200 rounded" />
      <div className="h-40 bg-white rounded-3xl border border-[#e2e8e4]" />
      <div className="h-72 bg-white rounded-3xl border border-[#e2e8e4]" />
    </div>
  )
  if (!profile) return <div className="p-8 text-[#6b7a73] font-medium">Staff member not found.</div>

  const TABS: { id: TabId; label: string; Icon: any }[] = [
    { id: 'overview',     label: 'Overview',     Icon: User },
    { id: 'experience',   label: 'Experience',   Icon: Briefcase },
    { id: 'credentials',  label: 'Credentials',  Icon: Award },
    { id: 'availability', label: 'Availability', Icon: CalendarDays },
    { id: 'documents',    label: 'Documents',    Icon: ShieldCheck },
  ]

  // compliance progress
  const acceptedCount = statuses.filter(s => s.status === 'accepted').length
  const totalReqs = requirements.length

  return (
    <div className="max-w-5xl mx-auto pb-20 px-4">
      {/* Back */}
      <div className="mb-8">
        <Link href="/center/staff" className="inline-flex items-center gap-2 text-sm text-[#6b7a73] hover:text-[#157354] transition-colors font-bold">
          <ArrowLeft className="w-4 h-4" /> Back to Staff Pool
        </Link>
      </div>

      {/* Header card */}
      <div className="bg-white border-2 border-[#f0f4f2] rounded-[2.5rem] shadow-sm mb-8 overflow-hidden">
        <div className="p-8 bg-[#f8faf9] border-b-2 border-[#f0f4f2] flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="w-24 h-24 rounded-[2rem] bg-[#157354] text-white flex items-center justify-center text-4xl font-black shadow-xl shadow-[#157354]/25 shrink-0">
            {profile.first_name[0]}{profile.last_name[0]}
          </div>
          <div className="flex-1">
            <h1 className="text-3xl font-black text-[#0b3828] tracking-tight mb-1">
              {profile.first_name} {profile.last_name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <span className="bg-[#edf7f3] text-[#157354] px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest border border-[#d4ede4]">
                {STAFF_TYPE_LABELS[profile.staff_type as StaffType] || profile.staff_type}
              </span>
              {totalReqs > 0 && (
                <span className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest border ${
                  acceptedCount === totalReqs ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                  {acceptedCount}/{totalReqs} Docs Verified
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-[#6b7a73] font-medium">
              <span className="flex items-center gap-1.5"><Mail className="w-4 h-4 text-[#a8b5ae]" />{profile.email}</span>
              {profile.phone && <span className="flex items-center gap-1.5"><Phone className="w-4 h-4 text-[#a8b5ae]" />{profile.phone}</span>}
              {(profile.city || profile.state) && (
                <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-[#a8b5ae]" />{profile.city}{profile.city && profile.state ? ', ' : ''}{profile.state}</span>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowActivationModal(true)}
            className="bg-[#157354] text-white font-black px-8 py-4 rounded-2xl hover:bg-[#0f4a36] shadow-lg shadow-[#157354]/20 transition-all flex items-center gap-2 active:scale-95 shrink-0"
          >
            <CheckCircle2 className="w-5 h-5" /> Approve & Activate
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-6 scrollbar-none">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-black whitespace-nowrap transition-all shrink-0 border-2 ${
              activeTab === tab.id
                ? 'bg-[#157354] text-white border-[#157354] shadow-lg shadow-[#157354]/20'
                : 'bg-white text-[#6b7a73] border-[#f0f4f2] hover:border-[#157354]/30 hover:text-[#0b3828]'
            }`}
          >
            <tab.Icon className="w-4 h-4" />
            {tab.label}
            {tab.id === 'documents' && totalReqs > 0 && acceptedCount < totalReqs && (
              <span className="ml-1 bg-amber-400 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                {totalReqs - acceptedCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ───────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Bio */}
          <div className="bg-white border-2 border-[#f0f4f2] rounded-[2rem] p-8">
            <h2 className="text-lg font-black text-[#0b3828] mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-[#157354]" /> About
            </h2>
            {profile.bio ? (
              <p className="text-[#3d5a4f] leading-relaxed">{profile.bio}</p>
            ) : (
              <p className="text-[#a8b5ae] italic text-sm">No bio provided.</p>
            )}
          </div>

          {/* Payment preferences */}
          {(profile as any).preferred_payment_methods?.length > 0 && (
            <div className="bg-white border-2 border-[#f0f4f2] rounded-[2rem] p-8">
              <h2 className="text-lg font-black text-[#0b3828] mb-4 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[#157354]" /> Payment Preferences
              </h2>
              <div className="flex flex-wrap gap-2">
                {(profile as any).preferred_payment_methods.map((m: string) => (
                  <span key={m} className="px-4 py-2 bg-[#edf7f3] text-[#157354] border border-[#d4ede4] rounded-xl text-sm font-black">
                    {PAYMENT_LABELS[m] || m}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quick stats */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="bg-white border-2 border-[#f0f4f2] rounded-2xl p-6 text-center">
              <div className="text-3xl font-black text-[#157354] mb-1">{experiences.length}</div>
              <div className="text-xs font-black text-[#6b7a73] uppercase tracking-widest">Work Experiences</div>
            </div>
            <div className="bg-white border-2 border-[#f0f4f2] rounded-2xl p-6 text-center">
              <div className="text-3xl font-black text-[#157354] mb-1">{credentials.length}</div>
              <div className="text-xs font-black text-[#6b7a73] uppercase tracking-widest">Credentials</div>
            </div>
            <div className="bg-white border-2 border-[#f0f4f2] rounded-2xl p-6 text-center">
              <div className="text-3xl font-black text-[#157354] mb-1">{(profile as any).available_days?.length || 0}</div>
              <div className="text-xs font-black text-[#6b7a73] uppercase tracking-widest">Days Available</div>
            </div>
          </div>

          {/* Reviews */}
          {reviews.length > 0 && (
            <div className="bg-white border-2 border-[#f0f4f2] rounded-[2rem] p-8 mt-6">
              <h2 className="text-lg font-black text-[#0b3828] mb-4 flex items-center gap-2">
                <Star className="w-5 h-5 text-[#fbbf24] fill-[#fbbf24]" /> Reviews from Centers
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {reviews.map(review => (
                  <div key={review.id} className="p-5 rounded-2xl bg-[#f8faf9] border border-[#e2e8e4]">
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-black text-[#1a2e25] text-sm">{review.reviewer_name}</div>
                      <div className="flex gap-1">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} className={`w-4 h-4 ${i < review.rating ? 'text-[#fbbf24] fill-[#fbbf24]' : 'text-[#e2e8e4] fill-transparent'}`} />
                        ))}
                      </div>
                    </div>
                    {review.tags && review.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {review.tags.map((tag: string) => (
                          <span key={tag} className="text-[9px] font-black uppercase tracking-widest bg-[#edf7f3] text-[#157354] px-2 py-1 rounded-md border border-[#d4ede4]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {review.public_comment && (
                      <p className="text-sm text-[#3d5a4f] italic bg-white p-3 rounded-xl border border-[#e2e8e4]">"{review.public_comment}"</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Experience Tab ─────────────────────────────────────────── */}
      {activeTab === 'experience' && (
        <div className="space-y-4">
          {experiences.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-[#e2e8e4]">
              <Briefcase className="w-10 h-10 text-[#a8b5ae] mx-auto mb-3" />
              <p className="text-[#6b7a73] font-bold">No work experience added yet.</p>
            </div>
          ) : (
            experiences.map(item => (
              <div key={item.id} className="bg-white border-2 border-[#f0f4f2] rounded-2xl p-6 flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#edf7f3] flex items-center justify-center shrink-0">
                  <Briefcase className="w-5 h-5 text-[#157354]" />
                </div>
                <div className="flex-1">
                  <div className="font-black text-[#0b3828] text-lg leading-tight">{item.employer}</div>
                  <div className="font-bold text-[#6b7a73] mb-2">{item.role}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold text-[#a8b5ae] uppercase tracking-wider">
                      {monthYearStr(item.start_month, item.start_year)}
                      {(item.start_month || item.start_year) ? ' – ' : ''}
                      {monthYearStr(item.end_month, item.end_year, item.is_current)}
                    </span>
                    {item.age_group && (
                      <span className="bg-[#f8faf9] text-[#6b7a73] border border-[#e2e8e4] px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest">
                        {AGE_GROUP_LABELS[item.age_group as AgeGroup]}
                      </span>
                    )}
                    {item.is_current && (
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest">
                        Current
                      </span>
                    )}
                  </div>
                  {item.description && <p className="text-sm text-[#6b7a73] mt-3 leading-relaxed">{item.description}</p>}
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
            <div className="text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-[#e2e8e4]">
              <Award className="w-10 h-10 text-[#a8b5ae] mx-auto mb-3" />
              <p className="text-[#6b7a73] font-bold">No credentials added yet.</p>
            </div>
          ) : (
            credentials.map(item => {
              const status = getExpiryStatus(item.expiry_date)
              const badge  = status ? EXPIRY_BADGE[status] : null
              return (
                <div key={item.id} className={`bg-white border-2 rounded-2xl p-6 flex items-start gap-4 ${
                  status === 'expired' ? 'border-red-100 bg-red-50/20' :
                  status === 'soon'    ? 'border-amber-100 bg-amber-50/10' :
                  'border-[#f0f4f2]'
                }`}>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                    status === 'expired' ? 'bg-red-100' : status === 'soon' ? 'bg-amber-100' : 'bg-[#edf7f3]'
                  }`}>
                    <Award className={`w-5 h-5 ${status === 'expired' ? 'text-red-500' : status === 'soon' ? 'text-amber-500' : 'text-[#157354]'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="font-black text-[#0b3828] text-lg leading-tight">{item.credential_name}</div>
                    {item.issuing_body && <div className="font-bold text-[#6b7a73] mb-2">{item.issuing_body}</div>}
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {item.issue_date && (
                        <span className="text-[10px] font-bold text-[#a8b5ae]">
                          Issued {new Date(item.issue_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </span>
                      )}
                      {item.expiry_date && (
                        <span className="text-[10px] font-bold text-[#a8b5ae]">
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
                      <div className="text-[10px] text-[#a8b5ae] font-bold mt-1">#{item.credential_number}</div>
                    )}
                    {item.linked_document && (
                      <div className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-black text-[#157354] bg-[#edf7f3] border border-[#d4ede4] px-3 py-1 rounded-lg">
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
        <div className="bg-white border-2 border-[#f0f4f2] rounded-[2rem] p-8 space-y-8">
          {/* Days */}
          <div>
            <h3 className="text-sm font-black text-[#0b3828] uppercase tracking-widest mb-4 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-[#157354]" /> Available Days
            </h3>
            {(profile as any).available_days?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(profile as any).available_days.map((d: string) => (
                  <span key={d} className="w-14 h-14 rounded-2xl bg-[#157354] text-white flex items-center justify-center font-black text-sm shadow-md shadow-[#157354]/20">
                    {DAYS_MAP[d] || d}
                  </span>
                ))}
              </div>
            ) : <p className="text-[#a8b5ae] italic text-sm">No days specified.</p>}
          </div>

          {/* Hours */}
          {((profile as any).available_from || (profile as any).available_to) && (
            <div>
              <h3 className="text-sm font-black text-[#0b3828] uppercase tracking-widest mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#157354]" /> Preferred Shift Hours
              </h3>
              <div className="flex items-center gap-3">
                <span className="bg-[#f8faf9] border-2 border-[#f0f4f2] px-5 py-3 rounded-xl font-black text-[#0b3828]">
                  {(profile as any).available_from || '–'}
                </span>
                <span className="text-[#a8b5ae] font-black">→</span>
                <span className="bg-[#f8faf9] border-2 border-[#f0f4f2] px-5 py-3 rounded-xl font-black text-[#0b3828]">
                  {(profile as any).available_to || '–'}
                </span>
              </div>
            </div>
          )}

          {/* Notes */}
          {(profile as any).availability_notes && (
            <div>
              <h3 className="text-sm font-black text-[#0b3828] uppercase tracking-widest mb-3 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#157354]" /> Availability Notes
              </h3>
              <p className="text-[#3d5a4f] leading-relaxed bg-[#f8faf9] p-4 rounded-xl border-2 border-[#f0f4f2]">
                {(profile as any).availability_notes}
              </p>
            </div>
          )}

          {!(profile as any).available_days?.length && !(profile as any).available_from && !(profile as any).availability_notes && (
            <div className="text-center py-12">
              <CalendarDays className="w-10 h-10 text-[#a8b5ae] mx-auto mb-3" />
              <p className="text-[#6b7a73] font-bold">No availability information provided yet.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Documents / Compliance Tab ─────────────────────────────── */}
      {activeTab === 'documents' && (
        <div className="bg-white border-2 border-[#f0f4f2] rounded-[2rem] overflow-hidden">
          <div className="p-6 border-b-2 border-[#f0f4f2] bg-[#f8faf9] flex items-center justify-between">
            <h2 className="text-lg font-black text-[#0b3828] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#157354]" /> Compliance Review
            </h2>
            <span className={`px-3 py-1 rounded-lg text-xs font-black border ${
              acceptedCount === totalReqs && totalReqs > 0
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              {acceptedCount} / {totalReqs} verified
            </span>
          </div>

          <div className="p-6 space-y-6">
            {requirements.length === 0 ? (
              <div className="text-center py-12 text-[#a8b5ae]">
                <Globe className="w-10 h-10 mx-auto mb-3" />
                <p className="font-bold">No document requirements configured for your center.</p>
                <p className="text-sm mt-1">Add requirements in your center settings.</p>
              </div>
            ) : (
              requirements.map((req) => {
                const status    = statuses.find(s => s.requirement_id === req.id)
                const matchedDoc = uploads.find(u => u.id === status?.matched_document_id)
                return (
                  <div key={req.id} className="border-2 border-[#f0f4f2] rounded-2xl overflow-hidden">
                    {/* Req header */}
                    <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#f8faf9] border-b-2 border-[#f0f4f2]">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-black text-[#1a2e25]">{req.document_name}</span>
                          {req.is_required && (
                            <span className="text-[9px] bg-[#157354] text-white px-2 py-0.5 rounded-full uppercase tracking-wider">Required</span>
                          )}
                        </div>
                        <p className="text-xs text-[#6b7a73]">{req.notes || 'No specific instructions.'}</p>
                      </div>
                      <div className="shrink-0">
                        {status?.status === 'accepted' ? (
                          <div className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full text-xs font-black border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                          </div>
                        ) : status?.status === 'rejected' ? (
                          <div className="flex items-center gap-1.5 text-red-600 bg-red-50 px-3 py-1.5 rounded-full text-xs font-black border border-red-100">
                            <XCircle className="w-3.5 h-3.5" /> Flagged
                          </div>
                        ) : status?.status === 'pending_review' ? (
                          <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full text-xs font-black border border-amber-100 animate-pulse">
                            <Clock className="w-3.5 h-3.5" /> Needs Review
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-[#a8b5ae] bg-[#f8faf9] px-3 py-1.5 rounded-full text-xs font-black border border-[#e2e8e4]">
                            <AlertCircle className="w-3.5 h-3.5" /> Missing
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="p-5 bg-white">
                      {matchedDoc ? (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className="w-11 h-11 rounded-xl bg-[#edf7f3] flex items-center justify-center shrink-0">
                              <FileText className="w-5 h-5 text-[#157354]" />
                            </div>
                            <div>
                              <div className="font-black text-[#1a2e25] text-sm">{matchedDoc.document_name}</div>
                              <div className="text-xs text-[#6b7a73] flex items-center gap-2 mt-0.5">
                                <span>Uploaded {new Date(matchedDoc.uploaded_at).toLocaleDateString()}</span>
                                {matchedDoc.expiry_date && (
                                  <>
                                    <span>·</span>
                                    <span className={new Date(matchedDoc.expiry_date) < new Date() ? 'text-red-500 font-bold' : ''}>
                                      Expires {new Date(matchedDoc.expiry_date).toLocaleDateString()}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleView(matchedDoc.file_key, matchedDoc.bucket_name, matchedDoc.file_url)}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#edf7f3] text-[#157354] font-black text-xs hover:bg-[#d4ede4] transition-colors border border-[#d4ede4]"
                          >
                            <ExternalLink className="w-3.5 h-3.5" /> View File
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-[#6b7a73] text-sm italic">
                          <AlertCircle className="w-4 h-4 text-[#a8b5ae]" /> Staff has not linked a document yet.
                        </div>
                      )}

                      {/* Review actions */}
                      {(matchedDoc || status?.status === 'rejected') && (
                        <div className="mt-5 pt-5 border-t-2 border-[#f0f4f2]">
                          <label className="block text-[10px] font-black text-[#0b3828] uppercase tracking-widest mb-2 flex items-center gap-1.5">
                            <MessageSquare className="w-3 h-3" /> Review Notes
                          </label>
                          <textarea
                            value={reviewNotes || status?.review_notes || ''}
                            onChange={e => setReviewNotes(e.target.value)}
                            placeholder="e.g. Looks good, valid state license."
                            className="w-full px-4 py-3 rounded-xl border-2 border-[#f0f4f2] bg-white text-sm focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all mb-4"
                            rows={2}
                          />
                          <div className="flex gap-3">
                            <button
                              onClick={() => handleReview(req.id, matchedDoc?.id || null, 'accepted')}
                              disabled={reviewingId === req.id || !matchedDoc}
                              className="flex-1 flex items-center justify-center gap-2 bg-[#157354] text-white font-black py-3 rounded-xl hover:bg-[#0f4a36] disabled:opacity-50 transition-all text-sm"
                            >
                              {reviewingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4" /> Accept</>}
                            </button>
                            <button
                              onClick={() => handleReview(req.id, matchedDoc?.id || null, 'rejected')}
                              disabled={reviewingId === req.id || !matchedDoc}
                              className="flex-1 flex items-center justify-center gap-2 bg-white text-red-600 border-2 border-red-100 font-black py-3 rounded-xl hover:bg-red-50 disabled:opacity-50 transition-all text-sm"
                            >
                              {reviewingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><XCircle className="w-4 h-4" /> Reject</>}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* ── Activation Modal ───────────────────────────────────────── */}
      {showActivationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-[#e2e8e4]">
            <div className="w-16 h-16 bg-[#edf7f3] rounded-2xl flex items-center justify-center mb-6 border-2 border-[#d4ede4]">
              <ShieldCheck className="w-8 h-8 text-[#157354]" />
            </div>
            <h2 className="text-2xl font-black text-[#0b3828] mb-2">Approve Staff Member?</h2>
            <p className="text-[#6b7a73] font-medium leading-relaxed mb-8">
              By approving <span className="font-bold text-[#1a2e25]">{profile.first_name} {profile.last_name}</span>, they will instantly be able to view and claim open shifts at your center.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowActivationModal(false)}
                disabled={activating}
                className="flex-1 px-5 py-3 rounded-xl font-bold text-[#6b7a73] bg-[#f8faf9] border-2 border-[#f0f4f2] hover:bg-[#f0f4f2] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleActivateStaff}
                disabled={activating}
                className="flex-[2] flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-black text-white bg-[#157354] hover:bg-[#0f4a36] disabled:opacity-70 transition-colors shadow-lg shadow-[#157354]/20"
              >
                {activating ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle2 className="w-5 h-5" /> Confirm Activation</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
