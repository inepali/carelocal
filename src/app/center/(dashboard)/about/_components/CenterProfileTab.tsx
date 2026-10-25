'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Center, SubscriptionTier, getTierLimits, MetroArea, TIER_LABELS } from '@/lib/types'
import { loadCenterPlan } from '@/lib/center-plan'
import { Building2, Save, MapPin, ShieldCheck, Loader2, ExternalLink, Clock, Globe, ArrowRight } from 'lucide-react'
import { getDomainKey, type DomainKey } from '@/lib/domain-config'
import { showAlert } from '@/lib/dialog'

export default function CenterProfileTab() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [center, setCenter] = useState<Partial<Center>>({})
  const [metros, setMetros] = useState<MetroArea[]>([])
  
  const [activeStaffCount, setActiveStaffCount] = useState(0)
  const [activeLocationCount, setActiveLocationCount] = useState(0)
  const [effectiveTier, setEffectiveTier] = useState<SubscriptionTier | null>(null)
  const [locationCap, setLocationCap] = useState<number | null | undefined>(undefined)
  const [portalLoading, setPortalLoading] = useState(false)
  const [siteDomain, setSiteDomain] = useState<DomainKey>('childcare')

  useEffect(() => {
    loadData()
    if (typeof window !== 'undefined') {
      setSiteDomain(getDomainKey(window.location.host))
    }
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



      // Fetch Metro Areas for Expansion
      const { data: metroData } = await supabase
        .from('metro_areas')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true })
      
      setMetros(metroData || [])

      // Fetch active staff count (exact match)
      const { count: staffCount, error: staffCountErr } = await supabase
        .from('center_staff')
        .select('*', { count: 'exact', head: true })
        .eq('center_id', admin.center_id)
        .eq('status', 'active')
      
      if (!staffCountErr && staffCount !== null) {
        setActiveStaffCount(staffCount)
      }

      // The plan this center actually gets, and how many centers share it (a secondary's comes from its primary)
      try {
        const plan = await loadCenterPlan(admin.center_id)
        setEffectiveTier(plan.tier)
        setActiveLocationCount(plan.centers_used)
        setLocationCap(plan.centers_cap)
      } catch (err) {
        console.error('[profile] plan summary:', err)
        setActiveLocationCount(1)
      }
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
        max_capacity: center.max_capacity ?? null,
        metro_area_id: center.metro_area_id,
        timezone: center.timezone,
        staff_term: center.staff_term,
        work_area_term: center.work_area_term
      })
      .eq('id', center.id)

    if (error) {
      setMessage(`Error: ${error.message}`)
    } else {
      setMessage('Center profile updated successfully!')
      loadData()
    }
    setSaving(false)
  }

  const handleManageCredits = async () => {
    if (!center?.stripe_customer_id) {
      window.location.hash = 'subscription'
      return
    }
    
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        showAlert(data.error || 'Failed to open subscription portal')
      }
    } catch (err) {
      console.error(err)
      showAlert('An error occurred while opening the portal')
    } finally {
      setPortalLoading(false)
    }
  }

  if (loading) return <div className="p-12 animate-pulse font-black text-slate-300">Loading Center Profile...</div>

  const tier = effectiveTier ?? (center.subscription_tier as SubscriptionTier) ?? 'trial'
  const domainKey = (center.domain_key as DomainKey) || 'childcare'
  const tierLimits = getTierLimits(domainKey)[tier] ?? getTierLimits(domainKey).trial
  const limits = { ...tierLimits, maxLocations: locationCap === undefined ? tierLimits.maxLocations : locationCap ?? Infinity }

  const staffPercentage = limits.maxStaff === Infinity 
    ? 0 
    : Math.min(100, (activeStaffCount / limits.maxStaff) * 100)

  const locationPercentage = limits.maxLocations === Infinity 
    ? 0 
    : Math.min(100, (activeLocationCount / limits.maxLocations) * 100)

  return (
    <div>
      <div className="grid lg:grid-cols-3 gap-12 items-start">
        {/* ── Left: Main Settings ── */}
        <div className="lg:col-span-2 space-y-10">
          <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-5 border-b border-border bg-surface/50 flex items-center gap-3">
              <Building2 className="w-5 h-5 text-brand-600" />
              <h2 className="font-semibold text-text-main text-base">Center Profile</h2>
            </div>

            <form onSubmit={handleSave} className="p-8 space-y-6">
              {message && (
                <div className={`px-4 py-3 rounded-xl text-sm border ${message.includes('Error') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-brand-50 text-[#16a34a] border-[#bbf7d0]'}`}>
                  {message}
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-text-main mb-1.5">Legal Center Name</label>
                  <input 
                    type="text" 
                    value={center.name || ''}
                    onChange={(e) => setCenter({...center, name: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition"
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-8">
                  <div>
                    <label className="block text-sm font-medium text-text-main mb-1.5">
                      Director Name
                    </label>
                    <input 
                      type="text" 
                      value={center.director_name || ''}
                      onChange={(e) => setCenter({...center, director_name: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-main mb-1.5">
                      Primary Phone
                    </label>
                    <input 
                      type="tel" 
                      value={center.phone || ''}
                      onChange={(e) => setCenter({...center, phone: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition"
                    />
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t-2 border-border">
                  <div className="flex items-center gap-2 text-heading font-black uppercase tracking-[0.25em] text-[11px] mb-2">
                    <MapPin className="w-4 h-4" /> Physical Location
                  </div>
                  <input 
                    type="text" 
                    placeholder="Street Address"
                    value={center.address || ''}
                    onChange={(e) => setCenter({...center, address: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition"
                  />
                  <div className="grid grid-cols-3 gap-6">
                    <input 
                      type="text" placeholder="City"
                      value={center.city || ''}
                      onChange={(e) => setCenter({...center, city: e.target.value})}
                      className="col-span-1 px-4 py-3 rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 text-text-main transition"
                    />
                    <input 
                      type="text" placeholder="State"
                      value={center.state || ''}
                      onChange={(e) => setCenter({...center, state: e.target.value})}
                      className="col-span-1 px-4 py-3 rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 text-text-main transition"
                    />
                    <input 
                      type="text" placeholder="Zip"
                      value={center.zip || ''}
                      onChange={(e) => setCenter({...center, zip: e.target.value})}
                      className="col-span-1 px-4 py-3 rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 text-text-main transition"
                    />
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t-2 border-border">
                  <div className="flex items-center gap-3 text-brand-600 font-black uppercase tracking-[0.25em] text-[11px] mb-2">
                    <Globe className="w-4 h-4" /> Regional Expansion
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-text-main mb-1.5">Assigned Metro Area</label>
                      <select 
                        value={center.metro_area_id || ''}
                        onChange={(e) => setCenter({...center, metro_area_id: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition appearance-none cursor-pointer"
                      >
                         <option value="">Select established metro area...</option>
                         {metros.map(m => (
                           <option key={m.id} value={m.id}>{m.name} ({m.state_code})</option>
                         ))}
                      </select>
                      <p className="mt-3 text-[10px] text-subtle font-bold leading-relaxed">
                        Tagging your facility with a Metro Area enables regional discovery for staff across the Carolinas and expanding territories.
                      </p>
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-text-main mb-1.5">Facility Timezone</label>
                      <select 
                        value={center.timezone || ''}
                        onChange={(e) => setCenter({...center, timezone: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition appearance-none cursor-pointer"
                      >
                         <option value="">Select timezone...</option>
                         <option value="America/Puerto_Rico">Atlantic Time (AST)</option>
                         <option value="America/New_York">Eastern Time (EST)</option>
                         <option value="America/Chicago">Central Time (CST)</option>
                         <option value="America/Denver">Mountain Time (MST)</option>
                         <option value="America/Phoenix">Mountain Time - Arizona (MST)</option>
                         <option value="America/Los_Angeles">Pacific Time (PST)</option>
                         <option value="America/Anchorage">Alaska Time (AKST)</option>
                         <option value="Pacific/Honolulu">Hawaii Time (HST)</option>
                      </select>
                  </div>
                </div>

                <div className="pt-4 grid sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-text-main mb-1.5">State License No.</label>
                    <input
                      type="text"
                      value={center.license_number || ''}
                      onChange={(e) => setCenter({...center, license_number: e.target.value})}
                      className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-main mb-1.5">Capacity</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={center.max_capacity ?? ''}
                      onChange={(e) => setCenter({...center, max_capacity: e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value)))})}
                      placeholder="e.g. 120"
                      className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-8 border-t border-border">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold px-8 py-3 rounded-xl hover:bg-brand-800 disabled:opacity-60 transition-colors shadow-sm"
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" /> Save Center Profile</>}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* ── Right: Sidebar / Subscription ── */}
        <div className="lg:col-span-1 space-y-10">
          <div className="bg-brand-900 text-white rounded-[3rem] p-10 shadow-[0_20px_50px_rgba(11,56,40,0.4)] relative overflow-hidden group">
            {/* Background Glow */}
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-brand-600 rounded-full blur-[100px] opacity-20 group-hover:opacity-40 transition-opacity"></div>
            
            <div className="flex items-center gap-3 mb-10 relative z-10">
              <ShieldCheck className="w-8 h-8 text-brand-600" />
              <h2 className="font-black text-2xl tracking-tight">Expansion Plan</h2>
            </div>
            
            <div className="mb-12 relative z-10">
              <div className="text-[10px] text-brand-300 uppercase tracking-[0.25em] font-black mb-2 opacity-60">Tier Status</div>
              <div className="text-5xl font-black tracking-tighter">{TIER_LABELS[tier] ?? tier}</div>
              <div className="text-xs text-brand-200 mt-4 flex items-center gap-1.5 font-bold uppercase tracking-widest">
                <Clock className="w-4 h-4" /> 
                {center.subscription_status === 'trialing' ? 'Expansion Active' : 'Premium Region'}
              </div>
            </div>

            <div className="space-y-6 mb-12 relative z-10">
               <div className="space-y-3">
                 <div className="flex justify-between items-center text-[10px] uppercase font-black tracking-widest text-brand-300">
                    <span>Regional Staff Capacity</span>
                    <span className="font-mono">{activeStaffCount} / {limits.maxStaff === Infinity ? '∞' : limits.maxStaff}</span>
                 </div>
                 <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-amber-400 rounded-full shadow-[0_0_15px_rgba(251,191,36,0.5)] transition-all duration-500 ease-out" 
                      style={{ width: `${staffPercentage}%` }}
                    />
                 </div>
               </div>
               
               <div className="space-y-3">
                 <div className="flex justify-between items-center text-[10px] uppercase font-black tracking-widest text-brand-300">
                    <span>Facility Locations</span>
                    <span className="font-mono">{activeLocationCount} / {limits.maxLocations === Infinity ? '∞' : limits.maxLocations}</span>
                 </div>
                 <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden shadow-inner">
                    <div 
                      className="h-full bg-white/40 rounded-full transition-all duration-500 ease-out" 
                      style={{ width: `${locationPercentage}%` }}
                    />
                 </div>
               </div>
            </div>

            <button 
              onClick={handleManageCredits}
              disabled={portalLoading}
              className="w-full flex items-center justify-center gap-3 bg-white/10 hover:bg-white/20 text-white font-black py-5 rounded-[1.5rem] transition-all border-2 border-white/5 text-sm uppercase tracking-widest relative z-10 disabled:opacity-60 cursor-pointer"
            >
              {portalLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Managing Credits...
                </>
              ) : (
                <>
                  Manage Credits <ExternalLink className="w-4 h-4 opacity-60" />
                </>
              )}
            </button>
          </div>

          <div className="bg-white border-2 border-border rounded-[2.5rem] p-10 shadow-xl relative group">
             <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center mb-6 group-hover:rotate-12 transition-transform">
                <Globe className="w-6 h-6 text-brand-600" />
             </div>
             <h3 className="font-black text-text-main mb-3 uppercase tracking-widest text-xs">Regional Support</h3>
             <p className="text-sm text-muted font-medium leading-relaxed mb-6">Need to move your center to a different Metro Area or request a new region? Our expansion team is ready.</p>
             <a href={`mailto:expansion@${siteDomain === 'healthcare' ? 'carelocal.net' : siteDomain === 'senior' ? 'carelocalsenior.com' : 'carelocal.co'}`} className="text-brand-600 font-black text-sm hover:underline flex items-center gap-2">
                Open Support Ticket <ArrowRight className="w-4 h-4" />
             </a>
          </div>
        </div>
      </div>
    </div>
  )
}
