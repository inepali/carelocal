'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  StaffProfile, StaffExperience, StaffCredential, StaffDocument,
  MetroArea, AgeGroup, AGE_GROUP_LABELS
} from '@/lib/types'
import {
  User, Mail, Phone, Save, Loader2, Globe, Briefcase, Award,
  CalendarDays, Plus, Pencil, Trash2, CheckCircle2, AlertTriangle,
  XCircle, FileText, Clock, ChevronDown, X, ShieldCheck, Link2
} from 'lucide-react'

// ─── Helpers ────────────────────────────────────────────────────────────────

type TabId = 'personal' | 'experience' | 'credentials' | 'availability'

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

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function StaffProfilePage() {
  const supabase = createClient()

  // ── Shared state ──
  const [loading, setLoading]         = useState(true)
  const [profile, setProfile]         = useState<Partial<StaffProfile>>({})
  const [metros, setMetros]           = useState<MetroArea[]>([])
  const [staffId, setStaffId]         = useState<string | null>(null)
  const [vaultDocs, setVaultDocs]     = useState<StaffDocument[]>([])
  const [activeTab, setActiveTab]     = useState<TabId>('personal')

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
      }

      setLoading(false)
    }
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="animate-pulse space-y-6 max-w-3xl py-10 px-6">
        <div className="h-8 w-48 bg-slate-200 rounded mb-8" />
        <div className="h-12 w-full bg-slate-100 rounded-2xl" />
        <div className="h-72 bg-white rounded-[2.5rem] border border-[#e2e8e4]" />
      </div>
    )
  }

  const TABS: { id: TabId; label: string; Icon: any }[] = [
    { id: 'personal',      label: 'Personal Info',  Icon: User },
    { id: 'experience',    label: 'Experience',      Icon: Briefcase },
    { id: 'credentials',   label: 'Credentials',     Icon: Award },
    { id: 'availability',  label: 'Availability',    Icon: CalendarDays },
  ]

  return (
    <div className="max-w-3xl mx-auto pb-24 px-4 md:px-6">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-[#0b3828] mb-1.5 tracking-tight">My Profile</h1>
        <p className="text-[#6b7a73] text-base">Manage your background, credentials and availability.</p>
      </div>

      {/* Avatar strip */}
      <div className="flex items-center gap-6 mb-10 p-6 bg-white rounded-2xl border border-[#e2e8e4] shadow-sm">
        <div className="w-20 h-20 rounded-[1.5rem] bg-[#157354] text-white flex items-center justify-center text-2xl font-bold shadow-lg shadow-[#157354]/30 shrink-0">
          {profile.first_name?.[0]}{profile.last_name?.[0]}
        </div>
        <div>
          <div className="text-xl font-semibold text-[#1a2e25] tracking-tight">{profile.first_name} {profile.last_name}</div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-medium tracking-wide text-[#a8b5ae]">Verified Member</span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-8 scrollbar-none">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all shrink-0 border-2 ${
              activeTab === tab.id
                ? 'bg-[#157354] text-white border-[#157354] shadow-lg shadow-[#157354]/20'
                : 'bg-white text-[#6b7a73] border-[#f0f4f2] hover:border-[#157354]/30 hover:text-[#0b3828]'
            }`}
          >
            <tab.Icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
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
      {activeTab === 'experience' && staffId && (
        <ExperienceTab staffId={staffId} supabase={supabase} />
      )}
      {activeTab === 'credentials' && staffId && (
        <CredentialsTab staffId={staffId} supabase={supabase} vaultDocs={vaultDocs} />
      )}
      {activeTab === 'availability' && (
        <AvailabilityTab profile={profile} setProfile={setProfile} supabase={supabase} />
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

  const F = 'w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition'
  const L = 'block text-sm font-medium text-[#1a2e25] mb-1.5'

  const PAYMENT_METHODS = [
    { key: 'payroll',  label: 'Payroll',      emoji: '🏢' },
    { key: 'direct_deposit', label: 'Direct Deposit', emoji: '🏦' },
    { key: 'check',    label: 'Check',        emoji: '📝' },
    { key: 'cash',     label: 'Cash',         emoji: '💵' },
    { key: 'zelle',    label: 'Zelle',        emoji: '⚡' },
    { key: 'venmo',    label: 'Venmo',        emoji: '💙' },
    { key: 'cashapp',  label: 'Cash App',     emoji: '💚' },
    { key: 'paypal',   label: 'PayPal',       emoji: '🅿️' },
  ]

  const activeMethods: string[] = profile.preferred_payment_methods || []

  function togglePayment(key: string) {
    const next = activeMethods.includes(key)
      ? activeMethods.filter(m => m !== key)
      : [...activeMethods, key]
    setProfile({ ...profile, preferred_payment_methods: next })
  }

  return (
    <div className="bg-white border border-[#e2e8e4] rounded-2xl shadow-sm overflow-hidden">
      <form onSubmit={handleSave} className="p-8 md:p-10 space-y-8">
        {message && (
          <div className={`p-4 rounded-xl text-sm font-black border-2 ${message.includes('Error') ? 'bg-red-50 text-red-700 border-red-100' : 'bg-[#f0fdf4] text-[#16a34a] border-[#bbf7d0]'}`}>
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
            <input type="email" disabled value={profile.email || ''} className={`${F} opacity-40 cursor-not-allowed bg-[#f8faf9]`} />
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

        <div className="grid sm:grid-cols-1 gap-6 pt-4 border-t border-[#e2e8e4]">
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

        <div className="pt-4 border-t-2 border-[#f0f4f2]">
          <label className={L}>Preferred Payment Methods</label>
          <p className="text-[11px] text-[#a8b5ae] font-bold mb-4 -mt-1">Select all the ways you're comfortable receiving payment for shifts.</p>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map(method => {
              const active = activeMethods.includes(method.key)
              return (
                <button
                  key={method.key}
                  type="button"
                  onClick={() => togglePayment(method.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black border-2 transition-all ${
                    active
                      ? 'bg-[#157354] text-white border-[#157354] shadow-md shadow-[#157354]/20'
                      : 'bg-white text-[#6b7a73] border-[#f0f4f2] hover:border-[#157354]/30 hover:text-[#0b3828]'
                  }`}
                >
                  <span>{method.emoji}</span> {method.label}
                </button>
              )
            })}
          </div>
          {activeMethods.length === 0 && (
            <p className="text-[10px] text-[#a8b5ae] font-bold mt-3">No preference selected — centers will see all methods as acceptable.</p>
          )}
        </div>

        <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-3 bg-[#157354] text-white font-semibold px-8 py-3 rounded-xl hover:bg-[#0f4a36] shadow-sm transition-colors disabled:opacity-60">
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5 text-white/60" /> Save Profile</>}
        </button>
      </form>

      {/* Documents vault summary */}
      <div className="mx-8 md:mx-10 mb-10 p-5 rounded-2xl bg-[#f8faf9] border-2 border-[#f0f4f2] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm"><FileText className="w-5 h-5 text-[#157354]" /></div>
          <div>
            <div className="font-black text-sm text-[#0b3828]">Document Vault</div>
            <div className="text-[11px] text-[#6b7a73] font-bold">{vaultDocCount} {vaultDocCount === 1 ? 'document' : 'documents'} stored</div>
          </div>
        </div>
        <a href="/staff/documents" className="text-[11px] font-black text-[#157354] uppercase tracking-widest hover:underline flex items-center gap-1">
          Manage <ChevronDown className="w-3 h-3 -rotate-90" />
        </a>
      </div>
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

  const F = 'w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-[#1a2e25] text-sm focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition'
  const L = 'block text-sm font-medium text-[#1a2e25] mb-1.5'

  return (
    <div className="space-y-4">
      {/* Add button */}
      {!form && (
        <button
          onClick={() => setForm({ is_current: false })}
          className="w-full flex items-center justify-center gap-2 bg-white border-2 border-dashed border-[#157354]/30 text-[#157354] font-black text-sm py-4 rounded-2xl hover:border-[#157354] hover:bg-[#edf7f3] transition-all"
        >
          <Plus className="w-4 h-4" /> Add Work Experience
        </button>
      )}

      {/* Inline form */}
      {form && (
        <div className="bg-white border-2 border-[#157354]/20 rounded-[2rem] p-6 space-y-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-black text-[#0b3828]">{form.id ? 'Edit' : 'New'} Experience</h3>
            <button onClick={() => setForm(null)} className="text-[#a8b5ae] hover:text-[#0b3828] transition-colors"><X className="w-5 h-5" /></button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={L}>Employer / Center Name *</label>
              <input className={F} value={form.employer || ''} onChange={e => setForm({...form, employer: e.target.value})} placeholder="Sunshine Childcare Center" />
            </div>
            <div>
              <label className={L}>Your Role / Title *</label>
              <input className={F} value={form.role || ''} onChange={e => setForm({...form, role: e.target.value})} placeholder="Lead Teacher" />
            </div>
          </div>

          <div>
            <label className={L}>Primary Age Group</label>
            <select className={`${F} appearance-none cursor-pointer`} value={form.age_group || ''} onChange={e => setForm({...form, age_group: e.target.value as AgeGroup || undefined})}>
              <option value="">Select...</option>
              {Object.entries(AGE_GROUP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className={L}>Start Month</label>
              <select className={`${F} appearance-none`} value={form.start_month || ''} onChange={e => setForm({...form, start_month: Number(e.target.value) || undefined})}>
                <option value="">Month</option>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={L}>Start Year</label>
              <select className={`${F} appearance-none`} value={form.start_year || ''} onChange={e => setForm({...form, start_year: Number(e.target.value) || undefined})}>
                <option value="">Year</option>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {!form.is_current && <>
              <div>
                <label className={L}>End Month</label>
                <select className={`${F} appearance-none`} value={form.end_month || ''} onChange={e => setForm({...form, end_month: Number(e.target.value) || undefined})}>
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className={L}>End Year</label>
                <select className={`${F} appearance-none`} value={form.end_year || ''} onChange={e => setForm({...form, end_year: Number(e.target.value) || undefined})}>
                  <option value="">Year</option>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </>}
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div className={`w-10 h-6 rounded-full transition-colors ${form.is_current ? 'bg-[#157354]' : 'bg-[#e2e8e4]'} relative`}
              onClick={() => setForm({...form, is_current: !form.is_current})}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_current ? 'translate-x-5' : 'translate-x-1'}`} />
            </div>
            <span className="text-sm font-black text-[#1a2e25]">I currently work here</span>
          </label>

          <div>
            <label className={L}>Description (optional)</label>
            <textarea className={`${F} resize-none`} rows={3} value={form.description || ''} onChange={e => setForm({...form, description: e.target.value})} placeholder="Brief description of your responsibilities..." />
          </div>

          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving || !form.employer || !form.role}
              className="flex-1 bg-[#157354] text-white font-black py-3 rounded-xl hover:bg-[#0f4a36] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save Experience</>}
            </button>
            <button onClick={() => setForm(null)} className="px-6 py-3 rounded-xl border-2 border-[#f0f4f2] text-[#6b7a73] font-black hover:border-[#e2e8e4] transition-all text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-24 bg-white rounded-2xl border border-[#e2e8e4]" />
          <div className="h-24 bg-white rounded-2xl border border-[#e2e8e4]" />
        </div>
      ) : items.length === 0 && !form ? (
        <div className="text-center py-16 bg-white rounded-[2rem] border-2 border-dashed border-[#e2e8e4]">
          <Briefcase className="w-10 h-10 text-[#a8b5ae] mx-auto mb-3" />
          <p className="text-[#6b7a73] font-bold text-sm">No work experience added yet.</p>
          <p className="text-[#a8b5ae] text-xs mt-1">Add your childcare background to help centers match you.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="group bg-white border-2 border-[#f0f4f2] hover:border-[#157354]/20 rounded-2xl p-5 flex items-start gap-4 transition-all">
              <div className="w-11 h-11 rounded-xl bg-[#edf7f3] flex items-center justify-center shrink-0">
                <Briefcase className="w-5 h-5 text-[#157354]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-black text-[#0b3828] leading-tight">{item.employer}</div>
                    <div className="text-sm font-bold text-[#6b7a73]">{item.role}</div>
                  </div>
                  <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={() => setForm(item)} className="p-1.5 rounded-lg hover:bg-[#edf7f3] text-[#157354] transition-all"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => handleDelete(item.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-[10px] font-black text-[#a8b5ae] uppercase tracking-wider">
                    {monthYearStr(item.start_month, item.start_year)} {(item.start_month || item.start_year) ? '–' : ''} {monthYearStr(item.end_month, item.end_year, item.is_current)}
                  </span>
                  {item.age_group && (
                    <span className="bg-[#f8faf9] text-[#6b7a73] border border-[#e2e8e4] px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest">
                      {AGE_GROUP_LABELS[item.age_group]}
                    </span>
                  )}
                </div>
                {item.description && <p className="text-xs text-[#6b7a73] mt-2 leading-relaxed">{item.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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

  const F = 'w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-[#1a2e25] text-sm focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition'
  const L = 'block text-sm font-medium text-[#1a2e25] mb-1.5'

  return (
    <div className="space-y-4">
      {!form && (
        <button
          onClick={() => setForm({})}
          className="w-full flex items-center justify-center gap-2 bg-white border-2 border-dashed border-[#157354]/30 text-[#157354] font-black text-sm py-4 rounded-2xl hover:border-[#157354] hover:bg-[#edf7f3] transition-all"
        >
          <Plus className="w-4 h-4" /> Add Credential / Certification
        </button>
      )}

      {form && (
        <div className="bg-white border-2 border-[#157354]/20 rounded-[2rem] p-6 space-y-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-black text-[#0b3828]">{form.id ? 'Edit' : 'New'} Credential</h3>
            <button onClick={() => setForm(null)} className="text-[#a8b5ae] hover:text-[#0b3828]"><X className="w-5 h-5" /></button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={L}>Credential Name *</label>
              <input className={F} value={form.credential_name || ''} onChange={e => setForm({...form, credential_name: e.target.value})} placeholder="CPR / First Aid" />
            </div>
            <div>
              <label className={L}>Issuing Organization</label>
              <input className={F} value={form.issuing_body || ''} onChange={e => setForm({...form, issuing_body: e.target.value})} placeholder="American Red Cross" />
            </div>
          </div>

          <div>
            <label className={L}>Credential / License Number</label>
            <input className={F} value={form.credential_number || ''} onChange={e => setForm({...form, credential_number: e.target.value})} placeholder="Optional" />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={L}>Issue Date</label>
              <input type="date" className={F} value={form.issue_date || ''} onChange={e => setForm({...form, issue_date: e.target.value})} />
            </div>
            <div>
              <label className={L}>Expiry Date</label>
              <input type="date" className={F} value={form.expiry_date || ''} onChange={e => setForm({...form, expiry_date: e.target.value})} />
              <p className="text-[10px] text-[#a8b5ae] font-bold mt-1">You'll see expiry alerts when this approaches.</p>
            </div>
          </div>

          {vaultDocs.length > 0 && (
            <div>
              <label className={L}><Link2 className="w-3 h-3 inline mr-1" />Link to Document in Vault</label>
              <select className={`${F} appearance-none cursor-pointer`} value={form.linked_document_id || ''} onChange={e => setForm({...form, linked_document_id: e.target.value || undefined})}>
                <option value="">None</option>
                {vaultDocs.map(d => <option key={d.id} value={d.id}>{d.document_name}</option>)}
              </select>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving || !form.credential_name}
              className="flex-1 bg-[#157354] text-white font-black py-3 rounded-xl hover:bg-[#0f4a36] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Save Credential</>}
            </button>
            <button onClick={() => setForm(null)} className="px-6 py-3 rounded-xl border-2 border-[#f0f4f2] text-[#6b7a73] font-black hover:border-[#e2e8e4] transition-all text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-20 bg-white rounded-2xl border border-[#e2e8e4]" />
          <div className="h-20 bg-white rounded-2xl border border-[#e2e8e4]" />
        </div>
      ) : items.length === 0 && !form ? (
        <div className="text-center py-16 bg-white rounded-[2rem] border-2 border-dashed border-[#e2e8e4]">
          <Award className="w-10 h-10 text-[#a8b5ae] mx-auto mb-3" />
          <p className="text-[#6b7a73] font-bold text-sm">No credentials added yet.</p>
          <p className="text-[#a8b5ae] text-xs mt-1">Add CPR, CDA, background checks, and more.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => {
            const status = getExpiryStatus(item.expiry_date)
            const badge  = status ? EXPIRY_BADGE[status] : null
            return (
              <div key={item.id} className={`group bg-white border-2 rounded-2xl p-5 flex items-start gap-4 transition-all hover:shadow-sm ${
                status === 'expired' ? 'border-red-100 bg-red-50/30' :
                status === 'soon'    ? 'border-amber-100 bg-amber-50/20' :
                'border-[#f0f4f2] hover:border-[#157354]/20'
              }`}>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  status === 'expired' ? 'bg-red-100' : status === 'soon' ? 'bg-amber-100' : 'bg-[#edf7f3]'
                }`}>
                  <Award className={`w-5 h-5 ${status === 'expired' ? 'text-red-500' : status === 'soon' ? 'text-amber-500' : 'text-[#157354]'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-black text-[#0b3828] leading-tight">{item.credential_name}</div>
                      {item.issuing_body && <div className="text-sm font-bold text-[#6b7a73]">{item.issuing_body}</div>}
                    </div>
                    <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={() => setForm(item)} className="p-1.5 rounded-lg hover:bg-[#edf7f3] text-[#157354]"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDelete(item.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {item.issue_date && (
                      <span className="text-[10px] font-bold text-[#a8b5ae]">Issued {new Date(item.issue_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                    )}
                    {item.expiry_date && (
                      <span className="text-[10px] font-bold text-[#a8b5ae]">· Expires {new Date(item.expiry_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                    )}
                    {badge && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[9px] font-black uppercase tracking-wider ${badge.className}`}>
                        <badge.Icon className="w-2.5 h-2.5" /> {badge.label}
                      </span>
                    )}
                    {item.linked_document && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-black text-[#157354] bg-[#edf7f3] border border-[#d4ede4] px-2 py-0.5 rounded-lg">
                        <FileText className="w-2.5 h-2.5" /> {(item.linked_document as any).document_name}
                      </span>
                    )}
                  </div>
                  {item.credential_number && (
                    <div className="text-[10px] text-[#a8b5ae] font-bold mt-1">#{item.credential_number}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
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

  const F = 'w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-[#1a2e25] text-sm focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition'

  return (
    <div className="bg-white border border-[#e2e8e4] rounded-2xl shadow-sm p-8 space-y-8">
      {message && (
        <div className={`p-4 rounded-xl text-sm font-medium border-2 ${message.includes('Error') ? 'bg-red-50 text-red-700 border-red-100' : 'bg-[#f0fdf4] text-[#16a34a] border-[#bbf7d0]'}`}>
          {message}
        </div>
      )}

      {/* Days picker */}
      <div>
        <div className="text-sm font-medium text-[#1a2e25] mb-3 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-[#157354]" /> Days Available for Shifts
        </div>
        <div className="flex gap-2 flex-wrap">
          {DAYS.map(day => {
            const active = activeDays.includes(day.key)
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => toggleDay(day.key)}
                className={`w-14 h-14 rounded-2xl font-semibold text-sm transition-all border-2 ${
                  active
                    ? 'bg-[#157354] text-white border-[#157354] shadow-lg shadow-[#157354]/20 scale-105'
                    : 'bg-white text-[#6b7a73] border-[#f0f4f2] hover:border-[#157354]/30 hover:text-[#0b3828]'
                }`}
              >
                {day.label}
              </button>
            )
          })}
        </div>
        {activeDays.length === 0 && (
          <p className="text-xs text-[#a8b5ae] mt-3">Select the days you're open to working.</p>
        )}
      </div>

      {/* Time range */}
      <div>
        <div className="text-sm font-semibold text-[#1a2e25] mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#157354]" /> Preferred Shift Hours
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Earliest Start Time</label>
            <input type="time" className={F} value={profile.available_from || ''} onChange={e => setProfile({...profile, available_from: e.target.value})} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Latest End Time</label>
            <input type="time" className={F} value={profile.available_to || ''} onChange={e => setProfile({...profile, available_to: e.target.value})} />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <div className="text-sm font-medium text-[#1a2e25] mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#157354]" /> Availability Notes
        </div>
        <textarea
          className={`${F} resize-none`}
          rows={3}
          value={profile.availability_notes || ''}
          onChange={e => setProfile({...profile, availability_notes: e.target.value})}
          placeholder="e.g. Available for last-minute shifts, prefer mornings, not available school holidays..."
        />
      </div>

      {/* Summary chip */}
      {activeDays.length > 0 && (
        <div className="flex flex-wrap gap-2 p-4 bg-[#f8faf9] rounded-2xl border border-[#e2e8e4]">
          <span className="text-xs font-medium text-[#6b7a73] self-center mr-1">Your schedule:</span>
          {activeDays.map(d => (
            <span key={d} className="bg-[#157354] text-white text-xs font-medium px-3 py-1 rounded-lg capitalize">
              {DAYS.find(day => day.key === d)?.label}
            </span>
          ))}
          {(profile.available_from || profile.available_to) && (
            <span className="bg-[#edf7f3] text-[#157354] border border-[#d4ede4] text-xs font-medium px-3 py-1 rounded-lg">
              {profile.available_from || '–'} → {profile.available_to || '–'}
            </span>
          )}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-3 bg-[#157354] text-white font-semibold px-8 py-3 rounded-xl hover:bg-[#0f4a36] shadow-sm transition-colors disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5 text-white/60" /> Save Availability</>}
      </button>
    </div>
  )
}
