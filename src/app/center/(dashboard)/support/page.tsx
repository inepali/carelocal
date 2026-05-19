'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, LifeBuoy, AlertCircle, Loader2, CheckCircle2, MessageSquare, Clock } from 'lucide-react'

export default function CenterSupportPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [tickets, setTickets] = useState<any[]>([])
  const [centerId, setCenterId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    if (admin) {
      setCenterId(admin.center_id)
      const { data: t } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('center_id', admin.center_id)
        .order('created_at', { ascending: false })
      
      setTickets(t || [])
    }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!centerId || !userId || !subject || !description) return
    setSubmitting(true)

    const { error } = await supabase
      .from('support_tickets')
      .insert({
        center_id: centerId,
        created_by: userId,
        subject,
        description,
        priority
      })

    if (!error) {
      setIsModalOpen(false)
      setSubject('')
      setDescription('')
      setPriority('medium')
      loadData()
    } else {
      alert("Failed to create ticket: " + error.message)
    }
    setSubmitting(false)
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-10 h-10 animate-spin text-[#157354]" /></div>
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Support</h1>
          <p className="text-[#6b7a73]">Need help? Open a ticket and our support team will assist you.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 bg-[#157354] text-white font-bold px-6 py-3 rounded-xl hover:bg-[#0f4a36] shadow-sm transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" /> Open Ticket
        </button>
      </div>

      <div className="bg-white border border-[#e2e8e4] rounded-[2rem] shadow-sm overflow-hidden">
        {tickets.length === 0 ? (
          <div className="py-20 text-center">
            <LifeBuoy className="w-16 h-16 text-[#e2e8e4] mx-auto mb-4" />
            <h3 className="text-xl font-bold text-[#0b3828] mb-2">No support tickets</h3>
            <p className="text-[#6b7a73] max-w-sm mx-auto mb-6">You haven't opened any support tickets yet. We're here if you need us!</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f8faf9] border-b border-[#e2e8e4] text-[#6b7a73] font-medium text-sm">
                <th className="px-6 py-4">Ticket</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Priority</th>
                <th className="px-6 py-4">Created On</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8e4]">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-[#f8faf9] transition-colors">
                  <td className="px-6 py-6">
                    <div className="font-bold text-[#1a2e25] mb-1 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-[#a8b5ae]" /> {t.subject}
                    </div>
                    <div className="text-xs text-[#6b7a73] truncate max-w-xs">{t.description}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-widest ${
                      t.status === 'open' ? 'bg-[#d4ede4] text-[#0f4a36]' :
                      t.status === 'resolved' ? 'bg-[#f0fdf4] text-[#16a34a]' :
                      'bg-amber-100 text-amber-800'
                    }`}>
                      {t.status === 'resolved' ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                      {t.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs font-bold uppercase tracking-widest ${
                      t.priority === 'urgent' ? 'text-rose-500' :
                      t.priority === 'high' ? 'text-amber-500' :
                      'text-[#6b7a73]'
                    }`}>
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-[#6b7a73] font-medium">
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b3828]/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 border-b border-[#e2e8e4] bg-[#f8faf9]">
              <h2 className="text-2xl font-black text-[#0b3828] tracking-tight">Open Support Ticket</h2>
              <p className="text-[#6b7a73] text-sm mt-1">Describe your issue and we'll get back to you shortly.</p>
            </div>
            
            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              <div>
                <label className="block text-sm font-bold text-[#1a2e25] mb-2 uppercase tracking-widest text-[10px]">Subject</label>
                <input 
                  required
                  autoFocus
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What do you need help with?"
                  className="w-full px-5 py-4 rounded-2xl border border-[#e2e8e4] focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all font-medium"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-[#1a2e25] mb-2 uppercase tracking-widest text-[10px]">Priority</label>
                <select 
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full px-5 py-4 rounded-2xl border border-[#e2e8e4] focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all font-medium bg-white"
                >
                  <option value="low">Low - Not urgent</option>
                  <option value="medium">Medium - Normal issue</option>
                  <option value="high">High - Blocking my work</option>
                  <option value="urgent">Urgent - System down/Critical</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-[#1a2e25] mb-2 uppercase tracking-widest text-[10px]">Description</label>
                <textarea 
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide as much detail as possible..."
                  rows={5}
                  className="w-full px-5 py-4 rounded-2xl border border-[#e2e8e4] focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all font-medium resize-none"
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-4 px-6 rounded-2xl border border-[#e2e8e4] font-bold text-[#6b7a73] hover:bg-[#f8faf9] transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={submitting}
                  className="flex-2 bg-[#157354] text-white font-bold py-4 px-8 rounded-2xl hover:bg-[#0f4a36] shadow-lg shadow-[#157354]/20 transition-all flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Submit Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
