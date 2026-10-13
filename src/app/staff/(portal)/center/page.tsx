'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Building, Clock, Mail, MapPin, Phone, User } from 'lucide-react'
import { Center, CenterStaff, EMPLOYMENT_CLASS_LABELS } from '@/lib/types'
import { CenterChecklist } from '@/components/staff/CenterChecklist'

type Membership = CenterStaff & { center: Center }

/** Single-center view for regular employees (a regular belongs to exactly one center) */
export default function MyCenterPage() {
   const [loading, setLoading] = useState(true)
   const [staffId, setStaffId] = useState<string | null>(null)
   const [membership, setMembership] = useState<Membership | null>(null)

   useEffect(() => {
      async function load() {
         const supabase = createClient()
         const { data: { user } } = await supabase.auth.getUser()
         if (!user) return

         const { data: profile } = await supabase
            .from('staff_profiles')
            .select('id')
            .eq('user_id', user.id)
            .single()

         if (profile) {
            setStaffId(profile.id)
            const { data } = await supabase
               .from('center_staff')
               .select('*, center:centers(*)')
               .eq('staff_id', profile.id)
               .eq('employment_class', 'regular')
               .neq('status', 'removed')
               .maybeSingle()
            setMembership(data)
         }
         setLoading(false)
      }

      load()
   }, [])

   if (loading) return (
      <div className="max-w-4xl animate-pulse">
         <div className="h-40 bg-white rounded-3xl border border-[#e2e8e4] mb-8"></div>
         <div className="h-64 bg-white rounded-3xl border border-[#e2e8e4]"></div>
      </div>
   )

   if (!membership || !staffId) return (
      <div className="max-w-5xl text-center py-20 bg-white rounded-[2rem] border-2 border-dashed border-[#e2e8e4]">
         <Building className="w-12 h-12 text-[#a8b5ae] mx-auto mb-4" />
         <p className="text-[#6b7a73] font-bold">You aren&apos;t assigned to a center yet.</p>
         <p className="text-sm text-[#a8b5ae] mt-1">Please contact your center administrator.</p>
      </div>
   )

   const center = membership.center
   const details = [
      { label: 'Director / Contact', Icon: User, value: center.director_name },
      {
         label: 'Address', Icon: MapPin,
         value: [center.address, `${center.city}, ${center.state} ${center.zip || ''}`.trim()].filter(Boolean).join(', ')
      },
      { label: 'Phone', Icon: Phone, value: center.phone, href: center.phone ? `tel:${center.phone}` : undefined },
      { label: 'Email', Icon: Mail, value: center.email, href: center.email ? `mailto:${center.email}` : undefined },
   ]

   return (
      <div className="max-w-5xl">
         <div className="mb-10">
            <h1 className="text-4xl font-black text-[#0b3828] mb-2 tracking-tight">My Center</h1>
            <p className="text-[#6b7a73] text-lg font-medium">Your workplace details and required documentation.</p>
         </div>

         <div className="bg-white rounded-[2rem] border-2 border-[#f0f4f2] overflow-hidden shadow-sm mb-8">
            <div className="p-8 flex flex-col md:flex-row items-center gap-6 border-b-2 border-[#f0f4f2]">
               <div className="w-16 h-16 rounded-2xl bg-[#157354] flex items-center justify-center shadow-lg shadow-[#157354]/20 shrink-0">
                  <Building className="w-8 h-8 text-white" />
               </div>
               <div className="flex-1 text-center md:text-left">
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mb-1">
                     <h2 className="text-2xl font-black text-[#0b3828] leading-tight">{center.name}</h2>
                     <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.1em] border-2 bg-[#edf7f3] text-[#157354] border-[#d4ede4]">
                        {EMPLOYMENT_CLASS_LABELS[membership.employment_class]} Employee
                     </span>
                     <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.1em] border-2 ${membership.status === 'active' ? 'bg-[#f0fdf4] text-[#157354] border-[#dcfce7]' : 'bg-[#f8faf9] text-[#6b7a73] border-[#e2e8e4]'}`}>
                        {membership.status}
                     </span>
                  </div>
                  <div className="text-[#6b7a73] font-medium flex items-center justify-center md:justify-start gap-1.5 text-sm mt-2">
                     <Clock className="w-4 h-4 text-[#a8b5ae]" /> Joined {new Date(membership.added_at).toLocaleDateString()}
                  </div>
               </div>
            </div>

            <div className="p-8 grid gap-6 sm:grid-cols-2">
               {details.map(({ label, Icon, value, href }) => (
                  <div key={label}>
                     <div className="flex items-center gap-2 mb-2 text-[#6b7a73]">
                        <Icon className="w-4 h-4 text-[#a8b5ae]" />
                        <span className="text-xs font-black uppercase tracking-widest">{label}</span>
                     </div>
                     <p className="text-[#0b3828] font-bold text-lg leading-tight break-words">
                        {value ? (
                           href ? <a href={href} className="hover:text-[#157354] hover:underline transition-colors">{value}</a> : value
                        ) : 'Not provided'}
                     </p>
                  </div>
               ))}
            </div>
         </div>

         <div className="p-8 bg-[#f8faf9] rounded-[2rem] border-2 border-[#f0f4f2]">
            <CenterChecklist
               centerId={membership.center_id}
               staffId={staffId}
               employmentClass={membership.employment_class}
               description="Link the documents your center requires from your vault."
            />
         </div>
      </div>
   )
}
