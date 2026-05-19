'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LifeBuoy, Loader2, CheckCircle2, MessageSquare, Clock, Building2, User } from 'lucide-react'

export default function AdminSupportPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [tickets, setTickets] = useState<any[]>([])
  
  // Update State
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const { data: t } = await supabase
      .from('support_tickets')
      .select(`
        *,
        centers(name)
      `)
      .order('created_at', { ascending: false })
    
    setTickets(t || [])
    setLoading(false)
  }

  async function updateStatus(ticketId: string, newStatus: string) {
    setUpdatingId(ticketId)
    const { error } = await supabase
      .from('support_tickets')
      .update({ status: newStatus })
      .eq('id', ticketId)
    
    if (!error) {
      await loadData()
    } else {
      alert("Failed to update status: " + error.message)
    }
    setUpdatingId(null)
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-10 h-10 animate-spin text-blue-500" /></div>
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Support Tickets</h1>
        <p className="text-slate-500">Manage and resolve center support requests.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
        {tickets.length === 0 ? (
          <div className="py-20 text-center">
            <LifeBuoy className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-900 mb-2">No active tickets</h3>
            <p className="text-slate-500 max-w-sm mx-auto">There are no support tickets in the system right now.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium text-sm">
                <th className="px-6 py-4">Ticket details</th>
                <th className="px-6 py-4">Center / Requester</th>
                <th className="px-6 py-4">Priority</th>
                <th className="px-6 py-4">Status & Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-6 w-2/5">
                    <div className="font-bold text-slate-900 mb-1 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-slate-400" /> {t.subject}
                    </div>
                    <div className="text-sm text-slate-600 line-clamp-2 leading-relaxed">{t.description}</div>
                    <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-2">
                      {new Date(t.created_at).toLocaleString()}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-1">
                      <Building2 className="w-4 h-4 text-slate-400" /> {t.centers?.name || 'Unknown Center'}
                    </div>
                    {/* Note: auth.users join is not allowed directly without special RPC or view, 
                        but we used auth_users if a view exists. Since it's auth.users, standard query might fail.
                        Wait, we requested auth_users:created_by(email) but created_by references auth.users.
                        Let's just show ID or if it fails we handle it below.
                    */}
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                       <User className="w-3 h-3" /> {t.created_by?.substring(0,8)}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs font-bold uppercase tracking-widest ${
                      t.priority === 'urgent' ? 'text-rose-500' :
                      t.priority === 'high' ? 'text-amber-500' :
                      'text-slate-500'
                    }`}>
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {updatingId === t.id ? (
                      <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                    ) : (
                      <select
                        value={t.status}
                        onChange={(e) => updateStatus(t.id, e.target.value)}
                        className={`text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full outline-none cursor-pointer border ${
                          t.status === 'open' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                          t.status === 'resolved' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                          'bg-blue-50 text-blue-600 border-blue-200'
                        }`}
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
