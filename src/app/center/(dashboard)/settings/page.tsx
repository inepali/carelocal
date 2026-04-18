'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Center, SubscriptionTier, TIER_LIMITS, MetroArea } from '@/lib/types'
import { Building2, Save, MapPin, Phone, Mail, User, ShieldCheck, Loader2, ExternalLink, Clock, Globe, ArrowRight } from 'lucide-react'

export default function CenterSettingsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [center, setCenter] = useState<Partial<Center>>({})
  const [subscription, setSubscription] = useState<any>(null)
  const [metros, setMetros] = useState<MetroArea[]>([])

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

      // Fetch Metro Areas for Expansion
      const { data: metroData } = await supabase
        .from('metro_areas')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true })
      
      setMetros(metroData || [])
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
        license_number: center.license_number,
        metro_area_id: center.metro_area_id
      })
      .eq('id', center.id)

    if (error) {
      setMessage(`Error: ${error.message}`)
    } else {
      setMessage('Center settings updated successfully!')
      loadData()
    }
    setSaving(false)
  }

  if (loading) return <div className="p-12 animate-pulse font-black text-slate-300">Loading Expansion Data...</div>

  const tier = (subscription?.tier as SubscriptionTier) || 'starter'
  const limits = TIER_LIMITS[tier]

  return (
    <div className="max-w-6xl mx-auto pb-24 px-6 md:px-10">
      <div className="mb-12">
        <h1 className="text-3xl font-extrabold text-[#0b3828] mb-2">Facility Settings</h1>
        <p className="text-[#6b7a73]">Manage your childcare center and expansion regions.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-12 items-start">
        {/* ── Left: Main Settings ── */}
        <div className="lg:col-span-2 space-y-10">
          <div className="bg-white border border-[#e2e8e4] rounded-2xl overflow-hidden shadow-sm">
            <div className="p-5 border-b border-[#e2e8e4] bg-[#f8faf9]/50 flex items-center gap-3">
              <Building2 className="w-5 h-5 text-[#157354]" />
              <h2 className="font-semibold text-[#1a2e25] text-base">Center Profile</h2>
            </div>

            <form onSubmit={handleSave} className="p-8 space-y-6">
              {message && (
                <div className={`px-4 py-3 rounded-xl text-sm border ${message.includes('Error') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-[#f0fdf4] text-[#16a34a] border-[#bbf7d0]'}`}>
                  {message}
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Legal Center Name</label>
                  <input 
                    type="text" 
                    value={center.name || ''}
                    onChange={(e) => setCenter({...center, name: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition"
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-8">
                  <div>
                    <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                      Director Name
                    </label>
                    <input 
                      type="text" 
                      value={center.director_name || ''}
                      onChange={(e) => setCenter({...center, director_name: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                      Primary Phone
                    </label>
                    <input 
                      type="tel" 
                      value={center.phone || ''}
                      onChange={(e) => setCenter({...center, phone: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition"
                    />
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t-2 border-[#f0f4f2]">
                  <div className="flex items-center gap-2 text-[#0b3828] font-black uppercase tracking-[0.25em] text-[11px] mb-2">
                    <MapPin className="w-4 h-4" /> Physical Location
                  </div>
                  <input 
                    type="text" 
                    placeholder="Street Address"
                    value={center.address || ''}
                    onChange={(e) => setCenter({...center, address: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition"
                  />
                  <div className="grid grid-cols-3 gap-6">
                    <input 
                      type="text" placeholder="City"
                      value={center.city || ''}
                      onChange={(e) => setCenter({...center, city: e.target.value})}
                      className="col-span-1 px-4 py-3 rounded-xl border border-[#e2e8e4] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] text-[#1a2e25] transition"
                    />
                    <input 
                      type="text" placeholder="State"
                      value={center.state || ''}
                      onChange={(e) => setCenter({...center, state: e.target.value})}
                      className="col-span-1 px-4 py-3 rounded-xl border border-[#e2e8e4] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] text-[#1a2e25] transition"
                    />
                    <input 
                      type="text" placeholder="Zip"
                      value={center.zip || ''}
                      onChange={(e) => setCenter({...center, zip: e.target.value})}
                      className="col-span-1 px-4 py-3 rounded-xl border border-[#e2e8e4] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] text-[#1a2e25] transition"
                    />
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t-2 border-[#f0f4f2]">
                  <div className="flex items-center gap-3 text-[#157354] font-black uppercase tracking-[0.25em] text-[11px] mb-2">
                    <Globe className="w-4 h-4" /> Regional Expansion
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Assigned Metro Area</label>
                      <select 
                        value={center.metro_area_id || ''}
                        onChange={(e) => setCenter({...center, metro_area_id: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition appearance-none cursor-pointer"
                      >
                         <option value="">Select established metro area...</option>
                         {metros.map(m => (
                           <option key={m.id} value={m.id}>{m.name} ({m.state_code})</option>
                         ))}
                      </select>
                      <p className="mt-3 text-[10px] text-[#a8b5ae] font-bold leading-relaxed">
                        Tagging your facility with a Metro Area enables regional discovery for staff across the Carolinas and expanding territories.
                      </p>
                  </div>
                </div>

                <div className="pt-4">
                  <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">State License No.</label>
                  <input 
                    type="text" 
                    value={center.license_number || ''}
                    onChange={(e) => setCenter({...center, license_number: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition"
                  />
                </div>
              </div>

              <div className="pt-6 flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center justify-center gap-2 bg-[#157354] text-white font-semibold px-8 py-3 rounded-xl hover:bg-[#0f4a36] disabled:opacity-60 transition-colors shadow-sm"
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" /> Save Center Settings</>}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* ── Right: Sidebar / Subscription ── */}
        <div className="lg:col-span-1 space-y-10">
          <div className="bg-[#0b3828] text-white rounded-[3rem] p-10 shadow-[0_20px_50px_rgba(11,56,40,0.4)] relative overflow-hidden group">
            {/* Background Glow */}
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-[#157354] rounded-full blur-[100px] opacity-20 group-hover:opacity-40 transition-opacity"></div>
            
            <div className="flex items-center gap-3 mb-10 relative z-10">
              <ShieldCheck className="w-8 h-8 text-[#157354]" />
              <h2 className="font-black text-2xl tracking-tight">Expansion Plan</h2>
            </div>
            
            <div className="mb-12 relative z-10">
              <div className="text-[10px] text-[#74c3a8] uppercase tracking-[0.25em] font-black mb-2 opacity-60">Tier Status</div>
              <div className="text-5xl font-black capitalize tracking-tighter">{tier}</div>
              <div className="text-xs text-[#a9dac9] mt-4 flex items-center gap-1.5 font-bold uppercase tracking-widest">
                <Clock className="w-4 h-4" /> 
                {subscription?.status === 'trialing' ? 'Expansion Active' : 'Premium Region'}
              </div>
            </div>

            <div className="space-y-6 mb-12 relative z-10">
               <div className="space-y-3">
                 <div className="flex justify-between items-center text-[10px] uppercase font-black tracking-widest text-[#74c3a8]">
                    <span>Regional Staff Capacity</span>
                    <span className="font-mono">12 / {limits.maxStaff === Infinity ? '∞' : limits.maxStaff}</span>
                 </div>
                 <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-[#fbbf24] w-[40%] rounded-full shadow-[0_0_15px_rgba(251,191,36,0.5)]" />
                 </div>
               </div>
               
               <div className="space-y-3">
                 <div className="flex justify-between items-center text-[10px] uppercase font-black tracking-widest text-[#74c3a8]">
                    <span>Facility Locations</span>
                    <span className="font-mono">1 / {limits.maxLocations === Infinity ? '∞' : limits.maxLocations}</span>
                 </div>
                 <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden shadow-inner">
                    <div className="h-full bg-white/40 w-[10%]" />
                 </div>
               </div>
            </div>

            <button className="w-full flex items-center justify-center gap-3 bg-white/10 hover:bg-white/20 text-white font-black py-5 rounded-[1.5rem] transition-all border-2 border-white/5 text-sm uppercase tracking-widest relative z-10">
              Manage Credits <ExternalLink className="w-4 h-4 opacity-60" />
            </button>
          </div>

          <div className="bg-white border-2 border-[#f0f4f2] rounded-[2.5rem] p-10 shadow-xl relative group">
             <div className="w-12 h-12 rounded-2xl bg-[#edf7f3] flex items-center justify-center mb-6 group-hover:rotate-12 transition-transform">
                <Globe className="w-6 h-6 text-[#157354]" />
             </div>
             <h3 className="font-black text-[#1a2e25] mb-3 uppercase tracking-widest text-xs">Regional Support</h3>
             <p className="text-sm text-[#6b7a73] font-medium leading-relaxed mb-6">Need to move your center to a different Metro Area or request a new region? Our expansion team is ready.</p>
             <a href="mailto:expansion@carelocal.io" className="text-[#157354] font-black text-sm hover:underline flex items-center gap-2">
                Open Support Ticket <ArrowRight className="w-4 h-4" />
             </a>
          </div>
        </div>
      </div>
    </div>
  )
}
