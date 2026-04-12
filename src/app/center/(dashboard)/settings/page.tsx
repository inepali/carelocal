'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Center, SubscriptionTier, TIER_LIMITS } from '@/lib/types'
import { Building2, Save, MapPin, Phone, Mail, User, ShieldCheck, Loader2, ExternalLink, Clock } from 'lucide-react'

export default function CenterSettingsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [center, setCenter] = useState<Partial<Center>>({})
  const [subscription, setSubscription] = useState<any>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    if (admin) {
      const { data: centerData } = await supabase
        .from('centers')
        .select('*')
        .eq('id', admin.center_id)
        .single()
      
      setCenter(centerData || {})

      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('center_id', admin.center_id)
        .single()
      
      setSubscription(subData)
    }
    setLoading(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    const { error } = await supabase
      .from('centers')
      .update({
        name: center.name,
        director_name: center.director_name,
        phone: center.phone,
        address: center.address,
        city: center.city,
        state: center.state,
        zip: center.zip,
        license_number: center.license_number
      })
      .eq('id', center.id)

    if (error) {
      setMessage(`Error: ${error.message}`)
    } else {
      setMessage('Center settings updated successfully!')
    }
    setSaving(false)
  }

  if (loading) return <div className="p-8">Loading settings...</div>

  const tier = (subscription?.tier as SubscriptionTier) || 'starter'
  const limits = TIER_LIMITS[tier]

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Center Settings</h1>
        <p className="text-[#6b7a73]">Manage your facility details and subscription.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* ── Left: Main Settings ── */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-[#e2e8e4] rounded-3xl overflow-hidden shadow-sm">
            <div className="p-6 border-b border-[#e2e8e4] bg-[#f8faf9] flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#157354]" />
              <h2 className="font-bold text-[#1a2e25]">Profile Details</h2>
            </div>

            <form onSubmit={handleSave} className="p-8 space-y-6">
              {message && (
                <div className={`p-4 rounded-xl text-sm border ${message.includes('Error') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-[#f0fdf4] text-[#16a34a] border-[#bbf7d0]'}`}>
                  {message}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[#1a2e25] mb-1.5 text-xs text-muted-foreground uppercase tracking-widest font-bold">Center Name</label>
                <input 
                  type="text" 
                  value={center.name || ''}
                  onChange={(e) => setCenter({...center, name: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-[#1a2e25] mb-1.5 flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-widest font-bold">
                    <User className="w-3.5 h-3.5" /> Director Name
                  </label>
                  <input 
                    type="text" 
                    value={center.director_name || ''}
                    onChange={(e) => setCenter({...center, director_name: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1a2e25] mb-1.5 flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-widest font-bold">
                    <Phone className="w-3.5 h-3.5" /> Center Phone
                  </label>
                  <input 
                    type="tel" 
                    value={center.phone || ''}
                    onChange={(e) => setCenter({...center, phone: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="block text-sm font-medium text-[#1a2e25] mb-1.5 text-xs text-muted-foreground uppercase tracking-widest font-bold">Address</label>
                <div className="space-y-4">
                  <input 
                    type="text" 
                    placeholder="Street Address"
                    value={center.address || ''}
                    onChange={(e) => setCenter({...center, address: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
                  />
                  <div className="grid grid-cols-3 gap-4">
                    <input 
                      type="text" placeholder="City"
                      value={center.city || ''}
                      onChange={(e) => setCenter({...center, city: e.target.value})}
                      className="col-span-1 px-4 py-3 rounded-xl border border-[#e2e8e4] focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
                    />
                    <input 
                      type="text" placeholder="State"
                      value={center.state || ''}
                      onChange={(e) => setCenter({...center, state: e.target.value})}
                      className="col-span-1 px-4 py-3 rounded-xl border border-[#e2e8e4] focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
                    />
                    <input 
                      type="text" placeholder="Zip"
                      value={center.zip || ''}
                      onChange={(e) => setCenter({...center, zip: e.target.value})}
                      className="col-span-1 px-4 py-3 rounded-xl border border-[#e2e8e4] focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#1a2e25] mb-1.5 text-xs text-muted-foreground uppercase tracking-widest font-bold">License Number</label>
                <input 
                  type="text" 
                  value={center.license_number || ''}
                  onChange={(e) => setCenter({...center, license_number: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
                />
              </div>

              <div className="pt-4 border-t border-[#e2e8e4] flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 bg-[#157354] text-white font-bold px-8 py-3 rounded-xl hover:bg-[#0f4a36] disabled:opacity-50 transition-all shadow-md"
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-4 h-4" /> Save Changes</>}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* ── Right: Sidebar / Subscription ── */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-[#0b3828] text-white rounded-3xl p-8 shadow-xl">
            <div className="flex items-center gap-2 mb-6">
              <ShieldCheck className="w-6 h-6 text-[#157354]" />
              <h2 className="font-bold text-lg">Subscription</h2>
            </div>
            
            <div className="mb-8">
              <div className="text-sm text-[#74c3a8] uppercase tracking-widest font-bold mb-1">Current Plan</div>
              <div className="text-3xl font-extrabold capitalize">{tier} Plan</div>
              <div className="text-xs text-[#a9dac9] mt-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> 
                {subscription?.status === 'trialing' ? 'Free Trial ends in 45 days' : 'Billed Monthly'}
              </div>
            </div>

            <div className="space-y-4 mb-8">
               <div className="flex justify-between items-center text-sm">
                  <span className="text-[#74c3a8]">Staff Pooled</span>
                  <span className="font-mono">12 / {limits.maxStaff === Infinity ? '∞' : limits.maxStaff}</span>
               </div>
               <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-[#fbbf24] w-[40%]" />
               </div>
               <div className="flex justify-between items-center text-sm">
                  <span className="text-[#74c3a8]">Locations</span>
                  <span className="font-mono">1 / {limits.maxLocations === Infinity ? '∞' : limits.maxLocations}</span>
               </div>
            </div>

            <button className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl transition-all border border-white/10">
              Manage Billing <ExternalLink className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-white border border-[#e2e8e4] rounded-3xl p-6 shadow-sm">
             <h3 className="font-bold text-[#1a2e25] mb-2 uppercase tracking-widest text-xs">Help & Support</h3>
             <p className="text-sm text-[#6b7a73] mb-4">Need help setting up your center or pool? Our team is available metrowise in Charlotte.</p>
             <a href="mailto:support@carelocal.io" className="text-[#157354] font-bold text-sm hover:underline">Contact Support →</a>
          </div>
        </div>
      </div>
    </div>
  )
}
