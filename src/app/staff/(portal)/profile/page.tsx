'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffProfile, STAFF_TYPE_LABELS, StaffType } from '@/lib/types'
import { User, Mail, Phone, Calendar as CalendarIcon, Clock, Save, Loader2 } from 'lucide-react'

export default function StaffProfilePage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [profile, setProfile] = useState<Partial<StaffProfile>>({})

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('staff_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (data) {
        setProfile(data)
      } else {
        // If profile doesn't exist, might need to set one up, but auth flow should do this
        setProfile({ email: user.email, user_id: user.id })
      }
      setLoading(false)
    }

    loadProfile()
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    const { error } = await supabase
      .from('staff_profiles')
      .update({
        first_name: profile.first_name,
        last_name: profile.last_name,
        phone: profile.phone,
        bio: profile.bio,
      })
      .eq('user_id', profile.user_id)

    if (error) {
      setMessage(`Error: ${error.message}`)
    } else {
      setMessage('Profile updated successfully!')
    }
    setSaving(false)
  }

  if (loading) {
     return <div className="animate-pulse space-y-4 max-w-2xl">
        <div className="h-64 bg-white rounded-2xl border border-[#e2e8e4]"></div>
     </div>
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">My Profile</h1>
        <p className="text-[#6b7a73]">Manage your personal information and availability.</p>
      </div>

      <div className="bg-white border border-[#e2e8e4] rounded-2xl shadow-sm overflow-hidden mb-8">
        <div className="p-8 border-b border-[#e2e8e4] bg-[#f8faf9] flex items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-[#157354] text-white flex items-center justify-center text-3xl font-bold">
                {profile.first_name?.[0]}{profile.last_name?.[0]}
            </div>
            <div>
                <h2 className="text-2xl font-bold text-[#1a2e25]">{profile.first_name} {profile.last_name}</h2>
                <div className="text-[#6b7a73] font-medium flex items-center gap-2 mt-1">
                    <span className="bg-[#edf7f3] text-[#157354] px-2 py-0.5 rounded text-sm uppercase tracking-wide">
                        {profile.staff_type ? STAFF_TYPE_LABELS[profile.staff_type as StaffType] : 'Staff'}
                    </span>
                    <span>•</span>
                    <span className="text-sm">Since {profile.created_at ? new Date(profile.created_at).getFullYear() : '2024'}</span>
                </div>
            </div>
        </div>

        <form onSubmit={handleSave} className="p-8 space-y-6">
            {message && (
                <div className={`p-4 rounded-xl text-sm border ${message.includes('Error') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-[#f0fdf4] text-[#16a34a] border-[#bbf7d0]'}`}>
                    {message}
                </div>
            )}

            <div className="grid sm:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">First Name</label>
                    <input 
                        type="text" 
                        value={profile.first_name || ''}
                        onChange={(e) => setProfile({...profile, first_name: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354]"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Last Name</label>
                    <input 
                        type="text" 
                        value={profile.last_name || ''}
                        onChange={(e) => setProfile({...profile, last_name: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354]"
                    />
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-[#1a2e25] mb-1.5 flex items-center gap-2">
                        <Mail className="w-4 h-4 text-[#a8b5ae]" /> Email
                    </label>
                    <input 
                        type="email" 
                        disabled
                        value={profile.email || ''}
                        className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-[#f8faf9] text-[#6b7a73] cursor-not-allowed"
                    />
                    <p className="text-xs text-[#a8b5ae] mt-1">Contact your center to change email.</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-[#1a2e25] mb-1.5 flex items-center gap-2">
                        <Phone className="w-4 h-4 text-[#a8b5ae]" /> Phone Number
                    </label>
                    <input 
                        type="tel" 
                        value={profile.phone || ''}
                        onChange={(e) => setProfile({...profile, phone: e.target.value})}
                        placeholder="(555) 123-4567"
                        className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354]"
                    />
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Bio (Optional)</label>
                <textarea 
                    value={profile.bio || ''}
                    onChange={(e) => setProfile({...profile, bio: e.target.value})}
                    placeholder="A brief introduction about your experience..."
                    rows={4}
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] resize-none"
                />
            </div>

            <div className="pt-4 border-t border-[#e2e8e4] flex justify-end">
                <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-2 bg-[#157354] text-white font-semibold px-8 py-3 rounded-xl hover:bg-[#0f4a36] transition-colors disabled:opacity-60 shadow-sm"
                >
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-4 h-4" /> Save Profile</>}
                </button>
            </div>
        </form>
      </div>

    </div>
  )
}
