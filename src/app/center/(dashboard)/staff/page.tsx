'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffProfile, CenterStaff, STAFF_TYPE_LABELS, StaffType } from '@/lib/types'
import { Users, Search, Filter, ShieldCheck, Mail, Phone, ArrowRight, CheckCircle2, Clock, Loader2, Sparkles, UserPlus } from 'lucide-react'
import { getStaffInviteLink } from '@/lib/api/invites'
import Link from 'next/link'

export default function StaffPoolPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [staff, setStaff] = useState<any[]>([])
  const [nearbyStaff, setNearbyStaff] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'pool' | 'onboarding' | 'discover'>('pool')
  const [centerInfo, setCenterInfo] = useState<{ id: string, slug: string, city: string, zip: string } | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [inviting, setInviting] = useState<string | null>(null)

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
      alert("Failed to invite staff: " + error.message)
    } else {
      const profile = nearbyStaff.find(s => s.id === staffId)
      if (profile) {
        setStaff([{ status: 'invited', added_at: new Date().toISOString(), staff_profiles: profile }, ...staff])
        setNearbyStaff(nearbyStaff.filter(s => s.id !== staffId))
      }
    }
    setInviting(null)
  }

  const copyInviteLink = () => {
     if (!centerInfo) return
     const link = getStaffInviteLink(centerInfo.slug)
     navigator.clipboard.writeText(link)
     alert("Invite link copied to clipboard: " + link)
  }

  if (loading) {
     return (
       <div className="animate-pulse space-y-6 max-w-6xl mx-auto py-10">
         <div className="h-12 w-64 bg-slate-200 rounded mb-8"></div>
         <div className="h-64 bg-white rounded-3xl border border-[#e2e8e4]"></div>
       </div>
     )
  }

  // Filter staff by status and search
  const myPool = staff.filter(s => s.status === 'active')
  const onboardingRequests = staff.filter(s => s.status === 'invited')

  const filterList = (list: any[]) => {
      const searchStr = searchTerm.toLowerCase()
      return list.filter(item => {
        const profile = item.staff_profiles || item
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
    <div className="max-w-6xl mx-auto pb-20">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6 mb-10">
        <div>
          <h1 className="text-4xl font-black text-[#0b3828] mb-2 tracking-tight">Staffing Dashboard</h1>
          <p className="text-[#6b7a73] font-medium text-lg">Manage your educators and review incoming onboarding requests.</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="bg-[#edf7f3] p-1.5 rounded-2xl border border-[#a9dac9] flex shadow-sm">
            <button 
              onClick={() => setActiveTab('pool')}
              className={`px-6 py-2.5 rounded-xl font-black text-sm transition-all flex items-center gap-2 ${activeTab === 'pool' ? 'bg-[#157354] text-white shadow-md' : 'text-[#3d5a4f] hover:bg-[#d4ede4]'}`}
            >
              <Users className="w-4 h-4" /> My Pool ({myPool.length})
            </button>
            <button 
              onClick={() => setActiveTab('onboarding')}
              className={`px-6 py-2.5 rounded-xl font-black text-sm transition-all flex items-center gap-2 relative ${activeTab === 'onboarding' ? 'bg-[#157354] text-white shadow-md' : 'text-[#3d5a4f] hover:bg-[#d4ede4]'}`}
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
              className={`px-6 py-2.5 rounded-xl font-black text-sm transition-all flex items-center gap-2 ${activeTab === 'discover' ? 'bg-[#157354] text-white shadow-md' : 'text-[#3d5a4f] hover:bg-[#d4ede4]'}`}
            >
              <UserPlus className="w-4 h-4" /> Discover ({nearbyStaff.length})
            </button>
          </div>
          <button 
             onClick={copyInviteLink}
             className="inline-flex items-center justify-center bg-white border-2 border-[#157354]/10 text-[#157354] font-black px-8 py-3 rounded-2xl hover:bg-[#f8faf9] hover:border-[#157354] shadow-sm transition-all active:scale-95"
          >
             Invite Staff
          </button>
        </div>
      </div>

      <div className="bg-white border-2 border-[#f0f4f2] rounded-[2.5rem] shadow-xl overflow-hidden">
         <div className="p-6 border-b border-[#f0f4f2] flex flex-col md:flex-row gap-4 bg-[#f8faf9]/50">
            <div className="relative flex-1">
               <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-[#a8b5ae]" />
               <input 
                  type="text" 
                  placeholder={`Search ${activeTab === 'discover' ? 'local educators' : 'your staff'}...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-6 py-4 rounded-[1.25rem] border-2 border-[#f0f4f2] bg-white text-[#1a2e25] font-medium focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all"
               />
            </div>
         </div>

         <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="border-b border-[#f0f4f2] text-[#6b7a73] font-black uppercase tracking-widest text-[10px]">
                   <th className="px-8 py-5">Staff Member</th>
                   <th className="px-8 py-5">Specialization</th>
                   <th className="px-8 py-5">Onboarding Status</th>
                   <th className="px-8 py-5">Action</th>
                 </tr>
               </thead>
                <tbody className="divide-y divide-[#f0f4f2]">
                  {displayedList.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-8 py-24 text-center">
                        <div className="w-20 h-20 bg-[#edf7f3] rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                           {activeTab === 'onboarding' ? <Sparkles className="w-10 h-10 text-[#a9dac9]" /> : <Users className="w-10 h-10 text-[#a9dac9]" />}
                        </div>
                        <h3 className="text-2xl font-black text-[#0b3828] mb-2 tracking-tight">No results found</h3>
                        <p className="text-[#6b7a73] max-w-xs mx-auto text-lg mb-8">
                          {activeTab === 'onboarding' ? "You don't have any pending onboarding requests at the moment." : "Spread the word to get more educators into your pool!"}
                        </p>
                        <button onClick={copyInviteLink} className="bg-[#fbbf24] text-[#0b3828] font-black px-10 py-4 rounded-2xl hover:bg-[#f59e0b] shadow-lg shadow-[#fbbf24]/20 transition-all">
                           Copy Invite Link
                        </button>
                      </td>
                    </tr>
                  ) : (
                    displayedList.map((item, idx) => {
                        const profile = item.staff_profiles || item
                        const status = item.status || 'available'
                        
                        return (
                        <tr key={idx} className="hover:bg-[#f8faf9] transition-all group">
                            <td className="px-8 py-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-2xl bg-[#edf7f3] text-[#157354] flex items-center justify-center font-black text-2xl shadow-sm group-hover:scale-110 transition-transform">
                                        {profile.first_name[0]}
                                    </div>
                                    <div>
                                        <div className="font-extrabold text-[#1a2e25] text-lg leading-tight">
                                           {profile.first_name} {profile.last_name}
                                        </div>
                                        <div className="text-sm text-[#6b7a73] font-medium">{profile.email}</div>
                                    </div>
                                </div>
                            </td>
                            <td className="px-8 py-6">
                                <div className="inline-flex items-center px-3 py-1 bg-[#f8faf9] text-[#3d5a4f] rounded-lg text-xs font-black uppercase tracking-widest border border-[#e2e8e4]">
                                   {STAFF_TYPE_LABELS[profile.staff_type as StaffType]}
                                </div>
                            </td>
                            <td className="px-8 py-6">
                                {status === 'invited' ? (
                                  <div className="flex items-center gap-2 text-amber-600 font-black text-xs uppercase tracking-widest">
                                     <Clock className="w-4 h-4" /> Pending Review
                                  </div>
                                ) : status === 'active' ? (
                                  <div className="flex items-center gap-2 text-[#16a34a] font-black text-xs uppercase tracking-widest">
                                     <CheckCircle2 className="w-4 h-4" /> Ready to Work
                                  </div>
                                ) : (
                                  <div className="text-[#a8b5ae] font-black text-xs uppercase tracking-widest leading-none">
                                     Nearby
                                  </div>
                                )}
                            </td>
                            <td className="px-8 py-6 text-right">
                               {activeTab === 'discover' ? (
                                 <button 
                                   onClick={() => handleInvite(profile.id)}
                                   disabled={inviting === profile.id}
                                   className="bg-[#157354] text-white font-black px-6 py-3 rounded-xl hover:bg-[#0f4a36] shadow-md shadow-[#157354]/10 transition-all active:scale-95 disabled:opacity-50"
                                 >
                                    {inviting === profile.id ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Invite to Pool'}
                                 </button>
                               ) : (
                                 <Link 
                                   href={`/center/staff/${profile.id}`}
                                   className="inline-flex items-center gap-2 text-[#157354] font-black hover:text-[#0b3828] text-sm group/link"
                                 >
                                    Review Paperwork <ArrowRight className="w-4 h-4 group-hover/link:translate-x-1 transition-transform" />
                                 </Link>
                               )}
                            </td>
                        </tr>
                        )
                    })
                  )}
                </tbody>
             </table>
         </div>
      </div>
    </div>
  )
}
