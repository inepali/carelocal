'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffProfile, CenterStaff, EMPLOYMENT_CLASS_LABELS, EmploymentClass } from '@/lib/types'
import { Users, Search, Filter, ShieldCheck, Mail, Phone, ArrowRight, CheckCircle2, Clock, Loader2, Sparkles, UserPlus } from 'lucide-react'
import { getStaffInviteLink } from '@/lib/api/invites'
import Link from 'next/link'
import { useCenterContext } from '../context'
import { StaffAvatar } from '@/components/StaffAvatar'
import { useLookups } from '@/hooks/use-lookups'
import { lookupLabel } from '@/lib/lookups'
import { showAlert } from '@/lib/dialog'

export default function StaffPoolPage() {
  const { staffTerm } = useCenterContext()
  const { data: roleLookups } = useLookups('Role')
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [staff, setStaff] = useState<any[]>([])
  const [nearbyStaff, setNearbyStaff] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'pool' | 'onboarding' | 'discover'>('pool')
  const [centerInfo, setCenterInfo] = useState<{ id: string, slug: string, city: string, zip: string } | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [classFilter, setClassFilter] = useState<'all' | EmploymentClass>('all')
  const [inviting, setInviting] = useState<string | null>(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')

  useEffect(() => {
    async function loadStaffPool() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: adminData } = await supabase
        .from('center_admins')
        .select(`
          center_id,
          centers (slug, city, zip)
        `)
        .eq('user_id', user.id)
        .single()

      if (!adminData) {
        setLoading(false)
        return
      }

      const center = adminData.centers as any
      setCenterInfo({
        id: adminData.center_id,
        slug: center.slug,
        city: center.city,
        zip: center.zip
      })

      // Fetch all center_staff records
      const { data: staffData } = await supabase
        .from('center_staff')
        .select(`
          status,
          employment_class,
          requested_employment_class,
          added_at,
          staff_profiles (
             id,
             first_name,
             last_name,
             email,
             phone,
             staff_type,
             avatar_url
          )
        `)
        .eq('center_id', adminData.center_id)
        .order('added_at', { ascending: false })

      setStaff(staffData || [])
      
      // Load nearby staff (discovery)
      const { data: nearby } = await supabase
        .from('staff_profiles')
        .select('*')
        .or(`city.eq.${center.city},zip.eq.${center.zip}`)
        .limit(20)

      const existingStaffIds = new Set((staffData || []).map(s => (s as any).staff_profiles?.id))
      setNearbyStaff((nearby || []).filter(s => !existingStaffIds.has(s.id)))

      setLoading(false)
    }

    loadStaffPool()
  }, [])

  const handleInvite = async (staffId: string) => {
    if (!centerInfo) return
    setInviting(staffId)
    
    const { error } = await supabase
      .from('center_staff')
      .insert({
        center_id: centerInfo.id,
        staff_id: staffId,
        status: 'invited'
      })

    if (error) {
      showAlert("Failed to invite staff: " + error.message)
    } else {
      const profile = nearbyStaff.find(s => s.id === staffId)
      if (profile) {
        setStaff([{ status: 'invited', employment_class: 'substitute', added_at: new Date().toISOString(), staff_profiles: profile }, ...staff])
        setNearbyStaff(nearbyStaff.filter(s => s.id !== staffId))
      }
    }
    setInviting(null)
  }

  const [copied, setCopied] = useState(false)

  const copyInviteLink = () => {
     if (!centerInfo) return
     const link = getStaffInviteLink(centerInfo.slug)
     navigator.clipboard.writeText(link)
     setCopied(true)
     setTimeout(() => setCopied(false), 2000)
  }

  const handleSendEmailInvite = (e: React.FormEvent) => {
     e.preventDefault()
     if (!centerInfo || !inviteEmail) return
     
     const link = getStaffInviteLink(centerInfo.slug)
     const subject = encodeURIComponent("You're invited to join our center on Carelocal")
     const body = encodeURIComponent(`Hi there,\n\nWe would like to invite you to join our educator pool on Carelocal.\n\nPlease click the link below to get started and create your account:\n\n${link}\n\nThanks,\nOur Team`)
     
     window.location.href = `mailto:${inviteEmail}?subject=${subject}&body=${body}`
     
     setShowInviteModal(false)
     setInviteEmail('')
  }

  if (loading) {
     return (
       <div className="animate-pulse space-y-6 max-w-6xl py-10">
         <div className="h-12 w-64 bg-slate-200 rounded mb-8"></div>
         <div className="h-64 bg-white rounded-3xl border border-border"></div>
       </div>
     )
  }

  // Filter staff by status and search
  const myPool = staff.filter(s => s.status === 'active')
  const onboardingRequests = staff.filter(s => s.status === 'invited' || s.status === 'applying')

  const filterList = (list: any[]) => {
      const searchStr = searchTerm.toLowerCase()
      return list.filter(item => {
        const profile = item.staff_profiles || item
        if (activeTab !== 'discover' && classFilter !== 'all' && item.employment_class !== classFilter) return false
        return (
          profile.first_name?.toLowerCase().includes(searchStr) ||
          profile.last_name?.toLowerCase().includes(searchStr) ||
          profile.email?.toLowerCase().includes(searchStr)
        )
      })
  }

  const displayedList = 
    activeTab === 'pool' ? filterList(myPool) :
    activeTab === 'onboarding' ? filterList(onboardingRequests) :
    filterList(nearbyStaff)

  return (
    <div className="max-w-6xl pb-20">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-heading mb-1">{staffTerm} Dashboard</h1>
          <p className="text-muted">Manage your {staffTerm.toLowerCase()} and review incoming onboarding requests.</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="bg-brand-50 p-1.5 rounded-2xl border border-brand-200 flex shadow-sm">
            <button 
              onClick={() => setActiveTab('pool')}
              className={`px-6 py-2.5 rounded-xl font-black text-sm transition-all flex items-center gap-2 ${activeTab === 'pool' ? 'bg-brand-600 text-white shadow-md' : 'text-text-muted hover:bg-brand-100'}`}
            >
              <Users className="w-4 h-4" /> My Pool ({myPool.length})
            </button>
            <button 
              onClick={() => setActiveTab('onboarding')}
              className={`px-6 py-2.5 rounded-xl font-black text-sm transition-all flex items-center gap-2 relative ${activeTab === 'onboarding' ? 'bg-brand-600 text-white shadow-md' : 'text-text-muted hover:bg-brand-100'}`}
            >
              <Sparkles className="w-4 h-4" /> Onboarding 
              {onboardingRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white shadow-sm ring-2 ring-white">
                  {onboardingRequests.length}
                </span>
              )}
            </button>
            <button 
              onClick={() => setActiveTab('discover')}
              className={`px-6 py-2.5 rounded-xl font-black text-sm transition-all flex items-center gap-2 ${activeTab === 'discover' ? 'bg-brand-600 text-white shadow-md' : 'text-text-muted hover:bg-brand-100'}`}
            >
              <UserPlus className="w-4 h-4" /> Discover ({nearbyStaff.length})
            </button>
          </div>
          <button 
             onClick={() => setShowInviteModal(true)}
             className="inline-flex items-center justify-center gap-2 font-semibold px-5 py-3 rounded-xl shadow-sm bg-brand-600 text-white hover:bg-brand-800"
          >
             Invite {staffTerm}
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            type="text"
            placeholder={`Search ${activeTab === 'discover' ? `local ${staffTerm.toLowerCase()}` : `your ${staffTerm.toLowerCase()}`}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-white text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600"
          />
        </div>
        {activeTab !== 'discover' && (
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value as 'all' | EmploymentClass)}
            title="Filter by employee class"
            className="px-4 py-2.5 rounded-xl border border-border bg-white text-sm font-medium text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600"
          >
            <option value="all">All Classes</option>
            {(Object.entries(EMPLOYMENT_CLASS_LABELS) as [EmploymentClass, string][]).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        {displayedList.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              {activeTab === 'onboarding' ? <Sparkles className="w-8 h-8 text-brand-200" /> : <Users className="w-8 h-8 text-brand-200" />}
            </div>
            <h3 className="text-xl font-bold text-heading mb-1">No results found</h3>
            <p className="text-muted max-w-sm mx-auto mb-6">
              {activeTab === 'onboarding' ? "You don't have any pending onboarding requests at the moment." : `Spread the word to get more ${staffTerm.toLowerCase()} into your pool!`}
            </p>
            <button onClick={copyInviteLink} disabled={copied} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-80">
              {copied ? <><CheckCircle2 className="w-4 h-4" /> Copied!</> : 'Copy Invite Link'}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-border text-[15px] font-bold text-text-main">
                  <th scope="col" className="px-6 py-4">{staffTerm} Member</th>
                  <th scope="col" className="px-4 py-4">Specialization</th>
                  <th scope="col" className="px-4 py-4">Onboarding Status</th>
                  <th scope="col" className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm text-text-muted">
                {displayedList.map((item, idx) => {
                  const profile = item.staff_profiles || item
                  const status = item.status || 'available'
                  const shownClass = item.status === 'active' ? item.employment_class : (item.requested_employment_class ?? item.employment_class)

                  return (
                    <tr key={idx} className="align-top hover:bg-surface">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <StaffAvatar
                            avatarKey={profile.avatar_url}
                            firstName={profile.first_name}
                            lastName={profile.last_name}
                            className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 font-black text-sm"
                          />
                          <div>
                            <div className="font-semibold text-text-main">{profile.first_name} {profile.last_name}</div>
                            <div className="text-xs text-muted">{profile.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          <span className="inline-flex rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-text-muted">
                            {lookupLabel(roleLookups, profile.staff_type)}
                          </span>
                          {shownClass && (
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${
                              shownClass === 'regular' ? 'bg-brand-50 text-brand-600 border-brand-100' : 'bg-white text-muted border-border'
                            }`}>
                              {EMPLOYMENT_CLASS_LABELS[shownClass as EmploymentClass]}{item.status !== 'active' && ' (requested)'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {status === 'invited' || status === 'applying' ? (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                            <Clock className="w-4 h-4" /> {status === 'applying' ? 'Applied · Pending Review' : 'Pending Review'}
                          </div>
                        ) : status === 'active' ? (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#16a34a]">
                            <CheckCircle2 className="w-4 h-4" /> Ready to Work
                          </div>
                        ) : (
                          <div className="text-xs font-semibold text-subtle">Nearby</div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {activeTab === 'discover' ? (
                          <button
                            onClick={() => handleInvite(profile.id)}
                            disabled={inviting === profile.id}
                            className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800 disabled:opacity-50"
                          >
                            {inviting === profile.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Invite to Pool'}
                          </button>
                        ) : (
                          <Link
                            href={`/center/team_member/${profile.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800"
                          >
                            View Profile <ArrowRight className="w-3.5 h-3.5" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8">
              <div className="w-16 h-16 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                <Mail className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-black text-heading mb-2 tracking-tight">Invite {staffTerm}</h2>
              <p className="text-muted font-medium mb-8 leading-relaxed">
                Send an email invitation directly to a {staffTerm.toLowerCase()} member so they can join your pool.
              </p>
              
              <form onSubmit={handleSendEmailInvite}>
                <div className="mb-6">
                  <label className="block text-xs font-black text-heading uppercase tracking-widest mb-2">
                    Email Address
                  </label>
                  <input 
                    type="email" 
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="educator@example.com"
                    className="w-full px-5 py-4 rounded-xl border-2 border-border focus:outline-none focus:ring-4 focus:ring-brand-600/10 focus:border-brand-600 transition-all font-medium text-text-main"
                  />
                </div>
                
                <div className="flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    className="flex-1 px-5 py-4 rounded-xl font-black text-xs uppercase tracking-widest text-muted bg-surface border border-border hover:bg-surface-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={!inviteEmail}
                    className="flex-1 px-5 py-4 rounded-xl font-black text-xs uppercase tracking-widest text-white bg-brand-600 hover:bg-brand-800 shadow-lg shadow-brand-600/20 transition-all disabled:opacity-50"
                  >
                    Open Email
                  </button>
                </div>
              </form>

              <div className="mt-8 pt-6 border-t border-border text-center">
                <p className="text-xs font-bold text-muted uppercase tracking-wider mb-3">Or share the link directly</p>
                <button 
                  type="button"
                  onClick={copyInviteLink}
                  disabled={copied}
                  className={`w-full px-5 py-3 rounded-xl font-black text-xs uppercase tracking-widest border transition-colors flex items-center justify-center gap-2 ${
                    copied 
                      ? 'bg-brand-50 text-brand-600 border-[#dcfce7]' 
                      : 'text-brand-600 border-brand-600/20 bg-white hover:bg-brand-50'
                  }`}
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" /> Copied!
                    </>
                  ) : (
                    <>
                      <ArrowRight className="w-4 h-4" /> Copy Invite Link
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
