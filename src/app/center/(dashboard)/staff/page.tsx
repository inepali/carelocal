'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffProfile, CenterStaff, STAFF_TYPE_LABELS, StaffType } from '@/lib/types'
import { Users, Search, Filter, ShieldCheck, Mail, Phone, MoreHorizontal, ArrowRight, CheckCircle2, Clock } from 'lucide-react'
import { getStaffInviteLink } from '@/lib/api/invites'
import Link from 'next/link'

export default function StaffPoolPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [staff, setStaff] = useState<any[]>([])
  const [centerSlug, setCenterSlug] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    async function loadStaffPool() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: adminData } = await supabase
        .from('center_admins')
        .select(`
          center_id,
          centers (slug)
        `)
        .eq('user_id', user.id)
        .single()

      if (!adminData) {
        setLoading(false)
        return
      }

      // @ts-ignore
      setCenterSlug(adminData.centers.slug)

      // Fetch active and invited staff for this center
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
      setLoading(false)
    }

    loadStaffPool()
  }, [])

  const copyInviteLink = () => {
     if (!centerSlug) return
     const link = getStaffInviteLink(centerSlug)
     navigator.clipboard.writeText(link)
     alert("Invite link copied to clipboard: " + link)
  }

  if (loading) {
     return <div className="animate-pulse space-y-4">
        <div className="h-64 bg-white rounded-2xl border border-[#e2e8e4]"></div>
     </div>
  }

  const filteredStaff = staff.filter(s => {
      const searchStr = searchTerm.toLowerCase()
      const profile = s.staff_profiles
      if (!profile) return false
      return (
          profile.first_name.toLowerCase().includes(searchStr) ||
          profile.last_name.toLowerCase().includes(searchStr) ||
          profile.email.toLowerCase().includes(searchStr)
      )
  })

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Staff Pool</h1>
          <p className="text-[#6b7a73]">Manage the educators and support staff eligible to claim your shifts.</p>
        </div>
        <button 
           onClick={copyInviteLink}
           className="inline-flex items-center justify-center bg-[#157354] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#0f4a36] shadow-sm transition-colors"
        >
           Copy Invite Link
        </button>
      </div>

      <div className="bg-white border border-[#e2e8e4] rounded-2xl shadow-sm overflow-hidden text-sm">
         <div className="p-4 border-b border-[#e2e8e4] flex flex-col sm:flex-row gap-4 bg-[#f8faf9]">
            <div className="relative flex-1">
               <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-[#a8b5ae]" />
               <input 
                  type="text" 
                  placeholder="Search staff by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#e2e8e4] bg-white text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition"
               />
            </div>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#e2e8e4] rounded-lg text-[#6b7a73] font-medium hover:bg-[#f8faf9] transition-colors shrink-0">
               <Filter className="w-4 h-4" /> Filter Role
            </button>
         </div>

         <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="border-b border-[#e2e8e4] text-[#6b7a73] font-medium">
                   <th className="px-6 py-4">Name</th>
                   <th className="px-6 py-4">Role</th>
                   <th className="px-6 py-4">Contact</th>
                   <th className="px-6 py-4">Document Status</th>
                   <th className="px-6 py-4">State</th>
                   <th className="px-6 py-4"></th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-[#e2e8e4]">
                 {filteredStaff.length === 0 ? (
                   <tr>
                     <td colSpan={6} className="px-6 py-16 text-center text-[#6b7a73]">
                       <Users className="w-10 h-10 text-[#e2e8e4] mx-auto mb-3" />
                       <p className="font-semibold text-[#1a2e25] text-base mb-1">Your pool is empty</p>
                       <p className="max-w-xs mx-auto mb-4">Send your invite link to your existing substitutes and floats to get started.</p>
                       <button onClick={copyInviteLink} className="text-[#157354] font-medium hover:underline">
                           Copy Invite Link
                       </button>
                     </td>
                   </tr>
                 ) : (
                   filteredStaff.map((s, idx) => {
                       const profile = s.staff_profiles
                       if(!profile) return null
                       return (
                       <tr key={idx} className="hover:bg-[#f8faf9] transition-colors">
                           <td className="px-6 py-4">
                               <Link href={`/center/dashboard/staff/${profile.id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                                   <div className="w-10 h-10 rounded-full bg-[#edf7f3] text-[#157354] flex items-center justify-center font-bold text-lg shrink-0">
                                       {profile.first_name[0]}
                                   </div>
                                   <div>
                                       <div className="font-bold text-[#1a2e25] flex items-center gap-1.5">
                                          {profile.first_name} {profile.last_name}
                                          <ArrowRight className="w-3 h-3 text-[#a8b5ae]" />
                                       </div>
                                       <div className="text-xs text-[#a8b5ae]">Joined {new Date(s.added_at).toLocaleDateString()}</div>
                                   </div>
                               </Link>
                           </td>
                           <td className="px-6 py-4">
                               <span className="font-medium text-[#3d5a4f]">
                                  {STAFF_TYPE_LABELS[profile.staff_type as StaffType]}
                               </span>
                           </td>
                           <td className="px-6 py-4 text-[#6b7a73]">
                               <div className="flex items-center gap-1.5 mb-1">
                                   <Mail className="w-3.5 h-3.5" /> <span className="truncate max-w-[150px] block">{profile.email}</span>
                               </div>
                               {profile.phone && (
                               <div className="flex items-center gap-1.5">
                                   <Phone className="w-3.5 h-3.5" /> <span>{profile.phone}</span>
                               </div>
                               )}
                           </td>
                           <td className="px-6 py-4">
                               {/* Mock document status for now */}
                               <div className="inline-flex items-center gap-1.5 text-amber-600 bg-amber-50 px-2.5 py-1 rounded-md text-xs font-semibold">
                                   <ShieldCheck className="w-3.5 h-3.5" /> Review Needed
                               </div>
                           </td>
                           <td className="px-6 py-4">
                               <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                                   s.status === 'active' ? 'bg-[#d4ede4] text-[#157354]' : 'bg-gray-100 text-gray-700'
                               }`}>
                                   {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                               </span>
                           </td>
                           <td className="px-6 py-4 text-right">
                               <Link 
                                 href={`/center/dashboard/staff/${profile.id}`}
                                 className="text-[#157354] hover:text-[#0b3828] font-medium bg-[#edf7f3] px-3 py-1.5 rounded-lg transition-colors border border-[#a9dac9]"
                               >
                                  Review Docs
                               </Link>
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
