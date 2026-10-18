'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  StaffProfile, StaffExperience, StaffCredential, StaffDocument, StaffReference, MIN_STAFF_REFERENCES,
  MetroArea, AgeGroup, AGE_GROUP_LABELS
} from '@/lib/types'
import {
  User, Mail, Phone, Save, Loader2, Globe, Briefcase, Award,
  CalendarDays, Plus, Pencil, Trash2, CheckCircle2, AlertTriangle,
  XCircle, FileText, ChevronDown, X, ShieldCheck, Link2, Star, Camera, GraduationCap
} from 'lucide-react'
import { useIsRegularOnly } from '@/lib/hooks/useIsRegularOnly'
import { useLookups } from '@/hooks/use-lookups'
import { AcademicQualificationsTab } from '@/components/staff/AcademicQualificationsTab'
import { StaffAvatar } from '@/components/StaffAvatar'
import { getAvatarUploadUrl, deleteAvatar } from '@/app/actions/avatar.actions'
import { showAlert, showConfirm } from '@/lib/dialog'

// ─── Helpers ────────────────────────────────────────────────────────────────

type TabId = 'personal' | 'academic' | 'experience' | 'references' | 'credentials' | 'availability' | 'reviews'

const MONTHS = [
  'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'
]

function monthYearStr(month?: number, year?: number, isCurrent?: boolean) {
  if (isCurrent) return 'Present'
  if (!month || !year) return ''
  return `${MONTHS[month - 1]} ${year}`
}

function getExpiryStatus(expiryDate?: string): 'valid' | 'soon' | 'expired' | null {
  if (!expiryDate) return null
  const exp = new Date(expiryDate)
  const now = new Date()
  const diff = (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  if (diff < 0) return 'expired'
  if (diff <= 60) return 'soon'
  return 'valid'
}

const EXPIRY_BADGE: Record<'valid'|'soon'|'expired', { label: string; className: string; Icon: any }> = {
  valid:   { label: 'Valid',         className: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  soon:    { label: 'Expires Soon',  className: 'bg-amber-50  text-amber-700  border-amber-200',    Icon: AlertTriangle },
  expired: { label: 'Expired',       className: 'bg-red-50    text-red-700    border-red-200',      Icon: XCircle },
}

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

const YEARS = Array.from({ length: 40 }, (_, i) => new Date().getFullYear() - i)

// ─── Shared section layout (matches My Documents) ───────────────────────────

const LBL    = 'block text-sm font-medium text-text-main mb-1.5'
const FLD    = 'w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-text-main text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition'
const TH_ROW = 'border-b border-border text-[15px] font-bold text-text-main'
const TBODY  = 'divide-y divide-border text-sm font-normal text-text-muted'

function fmtDate(date?: string) {
  return date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

function ProfileSection({ Icon, title, subtitle, action, children }: {
  Icon: React.ElementType
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border bg-surface px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-text-main">{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-800"
    >
      <Plus className="h-4 w-4" /> Add New
    </button>
  )
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button onClick={onEdit} className="rounded-lg p-2 text-brand-600 transition-colors hover:bg-brand-50" title="Edit">
        <Pencil className="h-4 w-4" />
      </button>
      <button onClick={onDelete} className="rounded-lg p-2 text-subtle transition-colors hover:bg-red-50 hover:text-red-500" title="Delete">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

function FormButtons({ saving, disabled, label, onSave, onCancel }: {
  saving: boolean
  disabled: boolean
  label: string
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex justify-end gap-2">
      <button onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-border text-muted text-sm font-medium hover:bg-surface transition-colors">
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={saving || disabled}
        className="inline-flex items-center gap-2 bg-brand-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-brand-800 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 text-white/70" />} {label}
      </button>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function StaffProfilePage() {
  const supabase = createClient()

  // ── Shared state ──
  const [loading, setLoading]         = useState(true)
  const [profile, setProfile]         = useState<Partial<StaffProfile>>({})
  const [metros, setMetros]           = useState<MetroArea[]>([])
  const [staffId, setStaffId]         = useState<string | null>(null)
  const [vaultDocs, setVaultDocs]     = useState<StaffDocument[]>([])
  const [reviews, setReviews]         = useState<any[]>([])
  const [activeTab, setActiveTab]     = useState<TabId>('personal')
  const { isRegularOnly } = useIsRegularOnly()
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  async function handleAvatarUpload(file: File) {
    if (!staffId) return
    if (file.size > 5 * 1024 * 1024) {
      showAlert('Please choose an image under 5 MB.')
      return
    }

    setUploadingAvatar(true)
    try {
      const presigned = await getAvatarUploadUrl(file.name, file.type)
      if (!presigned.success || !presigned.uploadUrl || !presigned.fileKey) {
        showAlert(presigned.error || 'Failed to prepare photo upload')
        return
      }

      const uploadRes = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!uploadRes.ok) {
        showAlert('Photo upload failed. Please try again.')
        return
      }

      const { error } = await supabase.from('staff_profiles').update({ avatar_url: presigned.fileKey }).eq('id', staffId)
      if (error) {
        await deleteAvatar(presigned.fileKey)
        showAlert('Failed to save photo: ' + error.message)
        return
      }

      const previousKey = profile.avatar_url
      setProfile(prev => ({ ...prev, avatar_url: presigned.fileKey }))
      if (previousKey) await deleteAvatar(previousKey)
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleAvatarRemove() {
    if (!staffId || !profile.avatar_url) return
    if (!await showConfirm('Remove your profile photo?')) return

    setUploadingAvatar(true)
    const previousKey = profile.avatar_url
    const { error } = await supabase.from('staff_profiles').update({ avatar_url: null }).eq('id', staffId)
    if (error) {
      showAlert('Failed to remove photo: ' + error.message)
    } else {
      setProfile(prev => ({ ...prev, avatar_url: undefined }))
      await deleteAvatar(previousKey)
    }
    setUploadingAvatar(false)
  }

  // ── Load everything once ──
  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profileData } = await supabase
        .from('staff_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (profileData) {
        setProfile(profileData)
        setStaffId(profileData.id)
      } else {
        setProfile({ email: user.email, user_id: user.id })
      }

      const { data: metroData } = await supabase
        .from('metro_areas')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true })
      setMetros(metroData || [])

      if (profileData?.id) {
        const { data: docs } = await supabase
          .from('staff_documents')
          .select('id, document_name, document_category')
          .eq('staff_id', profileData.id)
        setVaultDocs((docs || []) as any)

        // Fetch Reviews from Centers
        const { data: revs } = await supabase
          .from('shift_reviews')
          .select('*')
          .eq('reviewee_id', profileData.id)
          .eq('reviewer_type', 'center')
        
        if (revs && revs.length > 0) {
           const cIds = revs.map((r: any) => r.reviewer_id)
           const { data: cData } = await supabase.from('centers').select('id, name').in('id', cIds)
           const cMap = (cData || []).reduce((acc: any, curr: any) => { acc[curr.id] = curr.name; return acc; }, {})
           setReviews(revs.map((r: any) => ({ ...r, reviewer_name: cMap[r.reviewer_id] || 'Center' })))
        }
      }

      setLoading(false)
    }
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="animate-pulse space-y-6 max-w-5xl">
        <div className="h-8 w-48 bg-slate-200 rounded mb-8" />
        <div className="h-12 w-full bg-slate-100 rounded-2xl" />
        <div className="h-72 bg-white rounded-[2.5rem] border border-border" />
      </div>
    )
  }

  const ALL_TABS: { id: TabId; label: string; Icon: any }[] = [
    { id: 'personal',      label: 'Personal Info',  Icon: User },
    { id: 'academic',      label: 'Education', Icon: GraduationCap },
    { id: 'experience',    label: 'Experience',      Icon: Briefcase },
    { id: 'references',    label: 'References',      Icon: Link2 },
    { id: 'credentials',   label: 'Credentials',     Icon: Award },
    { id: 'availability',  label: 'Availability',    Icon: CalendarDays },
    { id: 'reviews',       label: 'Care Score',      Icon: Star },
  ]
  // Regular employees don't pick up marketplace shifts, so availability doesn't apply
  const TABS = ALL_TABS.filter(tab => !(isRegularOnly && tab.id === 'availability'))

  return (
    <div className="max-w-5xl pb-32">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-4xl font-black text-heading mb-2 tracking-tight">My Profile</h1>
        <p className="text-muted text-lg font-medium">
          {isRegularOnly ? 'Manage your background and credentials.' : 'Manage your background, credentials and availability.'}
        </p>
      </div>

      {/* Avatar strip */}
      <div className="flex items-center gap-6 mb-10 p-6 bg-white rounded-2xl border border-border shadow-sm">
        <label
          className={`relative group shrink-0 ${staffId ? 'cursor-pointer' : 'cursor-not-allowed'}`}
          title={staffId ? 'Change profile photo' : 'Save your personal info first'}
        >
          <StaffAvatar
            avatarKey={profile.avatar_url}
            firstName={profile.first_name}
            lastName={profile.last_name}
            className="w-20 h-20 rounded-[1.5rem] bg-brand-600 text-white text-2xl font-bold shadow-lg shadow-brand-600/30"
          />
          {staffId && (
            <span className={`absolute inset-0 rounded-[1.5rem] bg-black/45 text-white flex items-center justify-center transition-opacity ${uploadingAvatar ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              {uploadingAvatar ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
            </span>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            disabled={!staffId || uploadingAvatar}
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) handleAvatarUpload(file)
            }}
          />
        </label>
        <div>
          <div className="text-xl font-semibold text-text-main tracking-tight">{profile.first_name} {profile.last_name}</div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-medium tracking-wide text-subtle">Verified Member</span>
          </div>
          {staffId && (
            <div className="flex items-center gap-3 mt-2 text-xs font-semibold">
              <label className="text-brand-600 hover:underline cursor-pointer">
                {profile.avatar_url ? 'Change photo' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  disabled={uploadingAvatar}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) handleAvatarUpload(file)
                  }}
                />
              </label>
              {profile.avatar_url && (
                <button type="button" onClick={handleAvatarRemove} disabled={uploadingAvatar} className="text-red-600 hover:underline disabled:opacity-50">
                  Remove
                </button>
              )}
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
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'personal' && (
        <PersonalInfoTab
          profile={profile}
          setProfile={setProfile}
          metros={metros}
          vaultDocCount={vaultDocs.length}
        />
      )}
      {activeTab === 'academic' && staffId && (
        <AcademicQualificationsTab staffId={staffId} />
      )}
      {activeTab === 'experience' && staffId && (
        <ExperienceTab staffId={staffId} supabase={supabase} />
      )}
      {activeTab === 'references' && staffId && (
        <ReferencesTab staffId={staffId} supabase={supabase} />
      )}
      {activeTab === 'credentials' && staffId && (
        <CredentialsTab staffId={staffId} supabase={supabase} vaultDocs={vaultDocs} />
      )}
      {activeTab === 'availability' && (
        <AvailabilityTab profile={profile} setProfile={setProfile} supabase={supabase} />
      )}
      {activeTab === 'reviews' && (
        <ReviewsTab reviews={reviews} />
      )}
    </div>
  )
}

// ─── Personal Info Tab ───────────────────────────────────────────────────────

function PersonalInfoTab({
  profile, setProfile, metros, vaultDocCount
}: {
  profile: Partial<StaffProfile>
  setProfile: (p: Partial<StaffProfile>) => void
  metros: MetroArea[]
  vaultDocCount: number
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage('')
    const { error } = await supabase.from('staff_profiles').upsert({
      user_id:      profile.user_id,
      first_name:   profile.first_name || '',
      last_name:    profile.last_name  || '',
      email:        profile.email,
      phone:        profile.phone,
      bio:          profile.bio,
      city:         profile.city,
      state:        profile.state,
      zip:          profile.zip,
      metro_area_id: profile.metro_area_id || null,
      preferred_payment_methods: profile.preferred_payment_methods || [],
    }, { onConflict: 'user_id' })
    setMessage(error ? `Error: ${error.message}` : 'Profile updated!')
    setSaving(false)
  }

  const F = 'w-full px-4 py-3 rounded-xl border border-border bg-white text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition'
  const L = 'block text-sm font-medium text-text-main mb-1.5'

  const { data: paymentLookups } = useLookups('Payment Method')

  const activeMethods: string[] = profile.preferred_payment_methods || []

  function togglePayment(key: string) {
    const next = activeMethods.includes(key)
      ? activeMethods.filter(m => m !== key)
      : [...activeMethods, key]
    setProfile({ ...profile, preferred_payment_methods: next })
  }

  return (
    <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
      <form onSubmit={handleSave} className="p-8 md:p-10 space-y-8">
        {message && (
          <div className={`p-4 rounded-xl text-sm font-black border-2 ${message.includes('Error') ? 'bg-red-50 text-red-700 border-red-100' : 'bg-brand-50 text-[#16a34a] border-[#bbf7d0]'}`}>
            {message}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <label className={L}>First Name</label>
            <input type="text" value={profile.first_name || ''} onChange={e => setProfile({...profile, first_name: e.target.value})} className={F} />
          </div>
          <div>
            <label className={L}>Last Name</label>
            <input type="text" value={profile.last_name || ''} onChange={e => setProfile({...profile, last_name: e.target.value})} className={F} />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <label className={L}>Email</label>
            <input type="email" disabled value={profile.email || ''} className={`${F} opacity-40 cursor-not-allowed bg-surface`} />
          </div>
          <div>
            <label className={L}>Phone</label>
            <input type="tel" value={profile.phone || ''} onChange={e => setProfile({...profile, phone: e.target.value})} placeholder="(555) 000-0000" className={F} />
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-6">
          <div>
            <label className={L}>City</label>
            <input type="text" value={profile.city || ''} onChange={e => setProfile({...profile, city: e.target.value})} className={F} />
          </div>
          <div>
            <label className={L}>State</label>
            <input type="text" value={profile.state || ''} onChange={e => setProfile({...profile, state: e.target.value})} placeholder="TX" className={F} />
          </div>
          <div>
            <label className={L}>ZIP</label>
            <input type="text" value={profile.zip || ''} onChange={e => setProfile({...profile, zip: e.target.value})} className={F} />
          </div>
        </div>

        <div className="grid sm:grid-cols-1 gap-6 pt-4 border-t border-border">
          <div>
            <label className={L}>Metro Area</label>
            <select value={profile.metro_area_id || ''} onChange={e => setProfile({...profile, metro_area_id: e.target.value})} className={`${F} appearance-none cursor-pointer`}>
              <option value="">Select region...</option>
              {metros.map(m => <option key={m.id} value={m.id}>{m.name} ({m.state_code})</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={L}>Bio</label>
          <textarea value={profile.bio || ''} onChange={e => setProfile({...profile, bio: e.target.value})} rows={4} placeholder="Tell centers about your background..." className={`${F} resize-none`} />
        </div>

        <div className="pt-6 border-t border-border">
          <label className="block text-[15px] font-bold text-text-main mb-1">Preferred Payment Methods</label>
          <p className="text-xs text-muted mb-3">Select all the ways you&apos;re comfortable receiving payment for shifts.</p>
          <div className="flex flex-wrap gap-1.5">
            {paymentLookups.filter(m => m.is_active || activeMethods.includes(m.value)).map(method => {
              const active = activeMethods.includes(method.value)
              return (
                <button
                  key={method.value}
                  type="button"
                  onClick={() => togglePayment(method.value)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    active
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-text-muted border-border hover:border-brand-600/40 hover:text-heading'
                  }`}
                >
                  {method.label}
                </button>
              )
            })}
          </div>
          {activeMethods.length === 0 && (
            <p className="text-xs text-subtle mt-2">No preference selected — centers will see all methods as acceptable.</p>
          )}
        </div>

        <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-3 bg-brand-600 text-white font-semibold px-8 py-3 rounded-xl hover:bg-brand-800 shadow-sm transition-colors disabled:opacity-60">
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5 text-white/60" /> Save Profile</>}
        </button>
      </form>


    </div>
  )
}

// ─── Experience Tab ──────────────────────────────────────────────────────────

type ExpForm = Partial<StaffExperience> & { _open?: boolean }

function ExperienceTab({ staffId, supabase }: { staffId: string; supabase: any }) {
  const [items, setItems]       = useState<StaffExperience[]>([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState<ExpForm | null>(null)
  const [saving, setSaving]     = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase
      .from('staff_experiences')
      .select('*')
      .eq('staff_id', staffId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  async function handleSave() {
    if (!form?.employer || !form?.role) return
    setSaving(true)
    const payload = {
      staff_id:    staffId,
      employer:    form.employer,
      role:        form.role,
      age_group:   form.age_group || null,
      start_month: form.start_month || null,
      start_year:  form.start_year  || null,
      end_month:   form.is_current ? null : (form.end_month || null),
      end_year:    form.is_current ? null : (form.end_year  || null),
      is_current:  !!form.is_current,
      description: form.description || null,
    }
    if (form.id) {
      await supabase.from('staff_experiences').update(payload).eq('id', form.id)
    } else {
      await supabase.from('staff_experiences').insert(payload)
    }
    setForm(null)
    await load()
    setSaving(false)
  }

  async function handleDelete(id: string) {
    await supabase.from('staff_experiences').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }


  return (
    <ProfileSection
      Icon={Briefcase}
      title="Work Experience"
      subtitle={`${items.length} position${items.length === 1 ? '' : 's'}`}
      action={!form && <AddButton onClick={() => setForm({ is_current: false })} />}
    >
      {form && (
        <div className="p-6 space-y-4 border-b border-border bg-surface">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-heading">{form.id ? 'Edit' : 'New'} Experience</h3>
            <button onClick={() => setForm(null)} className="text-subtle hover:text-heading transition-colors"><X className="w-5 h-5" /></button>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className={LBL}>Employer / Center Name *</label>
              <input className={FLD} value={form.employer || ''} onChange={e => setForm({...form, employer: e.target.value})} placeholder="Sunshine Childcare Center" />
            </div>
            <div>
              <label className={LBL}>Your Role / Title *</label>
              <input className={FLD} value={form.role || ''} onChange={e => setForm({...form, role: e.target.value})} placeholder="Lead Teacher" />
            </div>
            <div>
              <label className={LBL}>Primary Age Group</label>
              <select className={`${FLD} appearance-none cursor-pointer`} value={form.age_group || ''} onChange={e => setForm({...form, age_group: e.target.value as AgeGroup || undefined})}>
                <option value="">Select...</option>
                {Object.entries(AGE_GROUP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className={LBL}>Start Month</label>
              <select className={`${FLD} appearance-none`} value={form.start_month || ''} onChange={e => setForm({...form, start_month: Number(e.target.value) || undefined})}>
                <option value="">Month</option>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={LBL}>Start Year</label>
              <select className={`${FLD} appearance-none`} value={form.start_year || ''} onChange={e => setForm({...form, start_year: Number(e.target.value) || undefined})}>
                <option value="">Year</option>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {!form.is_current && <>
              <div>
                <label className={LBL}>End Month</label>
                <select className={`${FLD} appearance-none`} value={form.end_month || ''} onChange={e => setForm({...form, end_month: Number(e.target.value) || undefined})}>
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className={LBL}>End Year</label>
                <select className={`${FLD} appearance-none`} value={form.end_year || ''} onChange={e => setForm({...form, end_year: Number(e.target.value) || undefined})}>
                  <option value="">Year</option>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </>}
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div className={`w-10 h-6 rounded-full transition-colors ${form.is_current ? 'bg-brand-600' : 'bg-border'} relative`}
              onClick={() => setForm({...form, is_current: !form.is_current})}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_current ? 'translate-x-5' : 'translate-x-1'}`} />
            </div>
            <span className="text-sm font-medium text-text-main">I currently work here</span>
          </label>

          <div>
            <label className={LBL}>Description (optional)</label>
            <textarea className={`${FLD} resize-none`} rows={2} value={form.description || ''} onChange={e => setForm({...form, description: e.target.value})} placeholder="Brief description of your responsibilities..." />
          </div>

          <FormButtons saving={saving} disabled={!form.employer || !form.role} label="Save Experience" onSave={handleSave} onCancel={() => setForm(null)} />
        </div>
      )}

      {loading ? (
        <div className="p-6 animate-pulse space-y-3">
          <div className="h-8 bg-surface-2 rounded-lg" />
          <div className="h-8 bg-surface-2 rounded-lg" />
        </div>
      ) : items.length === 0 ? (
        !form && <div className="px-6 py-6 text-sm text-muted">No work experience added yet. Add your background to help centers match you.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className={TH_ROW}>
                <th scope="col" className="px-6 py-4">Employer</th>
                <th scope="col" className="px-6 py-4">Role</th>
                <th scope="col" className="px-6 py-4">Age Group</th>
                <th scope="col" className="px-6 py-4">Period</th>
                <th scope="col" className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {items.map(item => (
                <tr key={item.id} className="hover:bg-surface transition-colors align-top">
                  <td className="px-6 py-4">
                    <div className="text-text-main">{item.employer}</div>
                    {item.description && <div className="mt-0.5 max-w-xs text-xs text-muted line-clamp-2">{item.description}</div>}
                  </td>
                  <td className="px-6 py-4">{item.role}</td>
                  <td className="px-6 py-4">{item.age_group ? AGE_GROUP_LABELS[item.age_group] : '—'}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {(item.start_month || item.start_year)
                      ? `${monthYearStr(item.start_month, item.start_year)} – ${monthYearStr(item.end_month, item.end_year, item.is_current)}`
                      : monthYearStr(item.end_month, item.end_year, item.is_current) || '—'}
                  </td>
                  <td className="px-6 py-4">
                    <RowActions onEdit={() => setForm(item)} onDelete={() => handleDelete(item.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ProfileSection>
  )
}

// ─── References Tab ─────────────────────────────────────────────────────────

type RefForm = Partial<StaffReference>

function ReferencesTab({ staffId, supabase }: { staffId: string; supabase: any }) {
  const [items, setItems]     = useState<StaffReference[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm]       = useState<RefForm | null>(null)
  const [saving, setSaving]   = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase
      .from('staff_references')
      .select('*')
      .eq('staff_id', staffId)
      .order('created_at', { ascending: true })
    setItems(data || [])
    setLoading(false)
  }

  const complete = !!(form?.full_name?.trim() && form?.email?.trim() && form?.phone?.trim() && form?.business?.trim() && form?.title?.trim())

  async function handleSave() {
    if (!form || !complete) return
    setSaving(true)
    const payload = {
      staff_id:  staffId,
      full_name: form.full_name!.trim(),
      email:     form.email!.trim(),
      phone:     form.phone!.trim(),
      business:  form.business!.trim(),
      title:     form.title!.trim(),
    }
    const { error } = form.id
      ? await supabase.from('staff_references').update(payload).eq('id', form.id)
      : await supabase.from('staff_references').insert(payload)
    setSaving(false)
    if (error) { showAlert('Failed to save reference: ' + error.message); return }
    setForm(null)
    load()
  }

  async function handleDelete(id: string) {
    if (!await showConfirm('Remove this reference?')) return
    await supabase.from('staff_references').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const missing = Math.max(0, MIN_STAFF_REFERENCES - items.length)

  return (
    <ProfileSection
      Icon={Link2}
      title="References"
      subtitle={`${items.length} of at least ${MIN_STAFF_REFERENCES}`}
      action={!form && <AddButton onClick={() => setForm({})} />}
    >
      {!loading && missing > 0 && (
        <div className="px-6 py-3 text-sm font-medium text-amber-800 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Add {missing} more reference{missing === 1 ? '' : 's'}. Centers ask for at least {MIN_STAFF_REFERENCES} professional references.
        </div>
      )}

      {form && (
        <div className="p-6 space-y-4 border-b border-border bg-surface">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-heading">{form.id ? 'Edit' : 'New'} Reference</h3>
            <button onClick={() => setForm(null)} className="text-subtle hover:text-heading transition-colors"><X className="w-5 h-5" /></button>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={LBL}>Full Name *</label>
              <input className={FLD} value={form.full_name || ''} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="Jane Smith" />
            </div>
            <div>
              <label className={LBL}>Title *</label>
              <input className={FLD} value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Center Director" />
            </div>
            <div>
              <label className={LBL}>Business *</label>
              <input className={FLD} value={form.business || ''} onChange={e => setForm({ ...form, business: e.target.value })} placeholder="Sunshine Childcare Center" />
            </div>
            <div>
              <label className={LBL}>Email *</label>
              <input type="email" className={FLD} value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="jane@example.com" />
            </div>
            <div>
              <label className={LBL}>Phone *</label>
              <input type="tel" className={FLD} value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="(704) 555-0123" />
            </div>
          </div>
          <FormButtons saving={saving} disabled={!complete} label="Save Reference" onSave={handleSave} onCancel={() => setForm(null)} />
        </div>
      )}

      {loading ? (
        <div className="p-6 animate-pulse space-y-3">
          <div className="h-8 bg-surface-2 rounded-lg" />
          <div className="h-8 bg-surface-2 rounded-lg" />
        </div>
      ) : items.length === 0 ? (
        !form && <div className="px-6 py-6 text-sm text-muted">No references added yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className={TH_ROW}>
                <th scope="col" className="px-6 py-4">Name</th>
                <th scope="col" className="px-6 py-4">Business</th>
                <th scope="col" className="px-6 py-4">Title</th>
                <th scope="col" className="px-6 py-4">Contact</th>
                <th scope="col" className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {items.map(item => (
                <tr key={item.id} className="hover:bg-surface transition-colors align-top">
                  <td className="px-6 py-4 text-text-main">{item.full_name}</td>
                  <td className="px-6 py-4">{item.business}</td>
                  <td className="px-6 py-4">{item.title}</td>
                  <td className="px-6 py-4 text-xs">
                    <div>{item.email}</div>
                    <div className="text-muted">{item.phone}</div>
                  </td>
                  <td className="px-6 py-4">
                    <RowActions onEdit={() => setForm(item)} onDelete={() => handleDelete(item.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ProfileSection>
  )
}

// ─── Credentials Tab ─────────────────────────────────────────────────────────

type CredForm = Partial<StaffCredential>

function CredentialsTab({ staffId, supabase, vaultDocs }: { staffId: string; supabase: any; vaultDocs: StaffDocument[] }) {
  const [items, setItems]     = useState<StaffCredential[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm]       = useState<CredForm | null>(null)
  const [saving, setSaving]   = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase
      .from('staff_credentials')
      .select('*, linked_document:staff_documents(id, document_name)')
      .eq('staff_id', staffId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  async function handleSave() {
    if (!form?.credential_name) return
    setSaving(true)
    const payload = {
      staff_id:           staffId,
      credential_name:    form.credential_name,
      issuing_body:       form.issuing_body       || null,
      credential_number:  form.credential_number  || null,
      issue_date:         form.issue_date          || null,
      expiry_date:        form.expiry_date         || null,
      linked_document_id: form.linked_document_id || null,
    }
    if (form.id) {
      await supabase.from('staff_credentials').update(payload).eq('id', form.id)
    } else {
      await supabase.from('staff_credentials').insert(payload)
    }
    setForm(null)
    await load()
    setSaving(false)
  }

  async function handleDelete(id: string) {
    await supabase.from('staff_credentials').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }


  return (
    <ProfileSection
      Icon={Award}
      title="Credentials & Certifications"
      subtitle={`${items.length} credential${items.length === 1 ? '' : 's'}`}
      action={!form && <AddButton onClick={() => setForm({})} />}
    >
      {form && (
        <div className="p-6 space-y-4 border-b border-border bg-surface">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-heading">{form.id ? 'Edit' : 'New'} Credential</h3>
            <button onClick={() => setForm(null)} className="text-subtle hover:text-heading"><X className="w-5 h-5" /></button>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className={LBL}>Credential Name *</label>
              <input className={FLD} value={form.credential_name || ''} onChange={e => setForm({...form, credential_name: e.target.value})} placeholder="CPR / First Aid" />
            </div>
            <div>
              <label className={LBL}>Issuing Organization</label>
              <input className={FLD} value={form.issuing_body || ''} onChange={e => setForm({...form, issuing_body: e.target.value})} placeholder="American Red Cross" />
            </div>
            <div>
              <label className={LBL}>Credential / License Number</label>
              <input className={FLD} value={form.credential_number || ''} onChange={e => setForm({...form, credential_number: e.target.value})} placeholder="Optional" />
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className={LBL}>Issue Date</label>
              <input type="date" className={FLD} value={form.issue_date || ''} onChange={e => setForm({...form, issue_date: e.target.value})} />
            </div>
            <div>
              <label className={LBL}>Expiry Date</label>
              <input type="date" className={FLD} value={form.expiry_date || ''} onChange={e => setForm({...form, expiry_date: e.target.value})} />
            </div>
            {vaultDocs.length > 0 && (
              <div>
                <label className={LBL}><Link2 className="w-3 h-3 inline mr-1" />Linked Document</label>
                <select className={`${FLD} appearance-none cursor-pointer`} value={form.linked_document_id || ''} onChange={e => setForm({...form, linked_document_id: e.target.value || undefined})}>
                  <option value="">None</option>
                  {vaultDocs.map(d => <option key={d.id} value={d.id}>{d.document_name}</option>)}
                </select>
              </div>
            )}
          </div>

          <FormButtons saving={saving} disabled={!form.credential_name} label="Save Credential" onSave={handleSave} onCancel={() => setForm(null)} />
        </div>
      )}

      {loading ? (
        <div className="p-6 animate-pulse space-y-3">
          <div className="h-8 bg-surface-2 rounded-lg" />
          <div className="h-8 bg-surface-2 rounded-lg" />
        </div>
      ) : items.length === 0 ? (
        !form && <div className="px-6 py-6 text-sm text-muted">No credentials added yet. Add CPR, CDA, background checks, and more.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className={TH_ROW}>
                <th scope="col" className="px-6 py-4">Credential</th>
                <th scope="col" className="px-6 py-4">Number</th>
                <th scope="col" className="px-6 py-4">Issued</th>
                <th scope="col" className="px-6 py-4">Expires</th>
                <th scope="col" className="px-6 py-4">Status</th>
                <th scope="col" className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {items.map(item => {
                const status = getExpiryStatus(item.expiry_date)
                const badge  = status ? EXPIRY_BADGE[status] : null
                return (
                  <tr key={item.id} className="hover:bg-surface transition-colors align-top">
                    <td className="px-6 py-4">
                      <div className="text-text-main">{item.credential_name}</div>
                      {item.issuing_body && <div className="text-xs text-muted">{item.issuing_body}</div>}
                      {item.linked_document && (
                        <div className="mt-1 inline-flex items-center gap-1 text-xs text-brand-600">
                          <FileText className="w-3 h-3" /> {(item.linked_document as any).document_name}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">{item.credential_number || '—'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{fmtDate(item.issue_date)}</td>
                    <td className={`px-6 py-4 whitespace-nowrap ${status === 'expired' ? 'text-red-600' : ''}`}>{fmtDate(item.expiry_date)}</td>
                    <td className="px-6 py-4">
                      {badge ? (
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${badge.className}`}>
                          <badge.Icon className="w-3 h-3" /> {badge.label}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <RowActions onEdit={() => setForm(item)} onDelete={() => handleDelete(item.id)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </ProfileSection>
  )
}

// ─── Availability Tab ────────────────────────────────────────────────────────

function AvailabilityTab({
  profile, setProfile, supabase
}: {
  profile: Partial<StaffProfile>
  setProfile: (p: Partial<StaffProfile>) => void
  supabase: any
}) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const activeDays: string[] = profile.available_days || []

  function toggleDay(key: string) {
    const next = activeDays.includes(key)
      ? activeDays.filter(d => d !== key)
      : [...activeDays, key]
    setProfile({ ...profile, available_days: next })
  }

  async function handleSave() {
    setSaving(true)
    setMessage('')
    const { error } = await supabase.from('staff_profiles').update({
      available_days:     profile.available_days     || [],
      available_from:     profile.available_from     || null,
      available_to:       profile.available_to       || null,
      availability_notes: profile.availability_notes || null,
    }).eq('user_id', profile.user_id)
    setMessage(error ? `Error: ${error.message}` : 'Availability saved!')
    setSaving(false)
  }


  return (
    <ProfileSection Icon={CalendarDays} title="Availability" subtitle="When you are open to picking up shifts">
      <div className="p-6 space-y-6">
        {message && (
          <div className={`p-3 rounded-xl text-sm font-medium border ${message.includes('Error') ? 'bg-red-50 text-red-700 border-red-100' : 'bg-brand-50 text-[#16a34a] border-[#bbf7d0]'}`}>
            {message}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-start">
          {/* Days picker */}
          <div>
            <div className={LBL}>Days Available</div>
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map(day => {
                const active = activeDays.includes(day.key)
                return (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => toggleDay(day.key)}
                    aria-pressed={active}
                    className={`w-11 h-9 rounded-lg text-sm transition-colors border ${
                      active
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-muted border-border hover:border-brand-600/40 hover:text-heading'
                    }`}
                  >
                    {day.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Time range */}
          <div>
            <div className={LBL}>Preferred Shift Hours</div>
            <div className="flex items-center gap-2">
              <input type="time" aria-label="Earliest start time" className={FLD} value={profile.available_from || ''} onChange={e => setProfile({...profile, available_from: e.target.value})} />
              <span className="text-sm text-muted">to</span>
              <input type="time" aria-label="Latest end time" className={FLD} value={profile.available_to || ''} onChange={e => setProfile({...profile, available_to: e.target.value})} />
            </div>
          </div>
        </div>

        <div>
          <div className={LBL}>Availability Notes</div>
          <textarea
            className={`${FLD} resize-none`}
            rows={2}
            value={profile.availability_notes || ''}
            onChange={e => setProfile({...profile, availability_notes: e.target.value})}
            placeholder="e.g. Available for last-minute shifts, prefer mornings, not available school holidays..."
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-brand-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-brand-800 transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 text-white/70" />} Save Availability
          </button>
        </div>
      </div>
    </ProfileSection>
  )
}

// ─── Reviews Tab ───────────────────────────────────────────────────────────

function ReviewsTab({ reviews }: { reviews: any[] }) {
  return (
    <div className="space-y-4">
      {reviews.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-[2rem] border-2 border-dashed border-border">
          <Star className="w-10 h-10 text-subtle mx-auto mb-3" />
          <p className="text-muted font-bold text-sm">No Care Score ratings yet.</p>
          <p className="text-subtle text-xs mt-1">Complete shifts to build your reputation!</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {reviews.map(review => (
            <div key={review.id} className="p-6 rounded-[1.5rem] bg-white border border-border hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="font-bold text-text-main text-lg">{review.reviewer_name}</div>
                <div className="flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className={`w-5 h-5 ${i < review.rating ? 'text-amber-400 fill-amber-400' : 'text-border fill-transparent'}`} />
                  ))}
                </div>
              </div>
              {review.tags && review.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {review.tags.map((tag: string) => (
                    <span key={tag} className="text-[10px] font-black uppercase tracking-widest bg-brand-50 text-brand-600 px-2.5 py-1 rounded-lg border border-brand-100">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {review.public_comment && (
                <p className="text-sm text-text-muted mt-3 italic p-4 bg-surface rounded-xl border border-border">"{review.public_comment}"</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
