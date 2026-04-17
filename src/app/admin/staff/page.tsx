'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { 
  Users, 
  Search, 
  MapPin, 
  ShieldCheck, 
  Clock, 
  FileText,
  Mail,
  Phone
} from 'lucide-react'

export default function AdminStaffPage() {
  const supabase = createClient()
  const [staff, setStaff] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    async function loadStaff() {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (data) setStaff(data)
      setLoading(false)
    }
    loadStaff()
  }, [])

  const filteredStaff = staff.filter(s => 
    `${s.first_name} ${s.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.email.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) return <div className="animate-pulse space-y-4 pt-10 px-8"><div className="h-10 w-48 bg-slate-200 rounded-lg mb-8"></div><div className="h-96 bg-white rounded-3xl border border-slate-200"></div></div>

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">Global Staff Network</h1>
          <p className="text-slate-500 font-medium">Verify credentials and manage the global pool of educators.</p>
        </div>
        <div className="bg-white px-4 py-2.5 rounded-2xl border border-slate-200 flex items-center gap-2 group focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all">
          <Search className="w-5 h-5 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search staff by name or email..." 
            className="bg-transparent border-none outline-none text-sm font-bold text-slate-700 w-64"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Educator</th>
                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Location</th>
                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Role & Specs</th>
                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Verification</th>
                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStaff.map((person) => (
                <tr key={person.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-400 text-xs border border-slate-200">
                        {person.first_name[0]}{person.last_name[0]}
                      </div>
                      <div>
                        <div className="font-extrabold text-slate-900 text-sm mb-0.5 tracking-tight">{person.first_name} {person.last_name}</div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                           <Mail className="w-3 h-3 text-slate-300" /> {person.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      {person.city || 'N/A'}, {person.state || 'N/A'}
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="inline-flex items-center px-2.5 py-1 bg-slate-100 rounded-lg text-[10px] font-black text-slate-600 uppercase tracking-widest mb-1.5 border border-slate-200">
                      {person.staff_type}
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Joined {new Date(person.created_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-100 max-w-fit">
                      <ShieldCheck className="w-3.5 h-3.5" /> Verified
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <button className="text-slate-400 hover:text-blue-600 font-bold text-xs uppercase tracking-widest transition-colors flex items-center gap-1 ml-auto">
                       Profile <ChevronRight className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}
