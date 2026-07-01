'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getTierLimits, SubscriptionTier } from '@/lib/types'
import { CheckCircle2, ShieldCheck, CreditCard, Loader2 } from 'lucide-react'

// You would replace these with actual Stripe Price IDs from your Stripe Dashboard
const STRIPE_PRICES = {
  starter: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER || 'price_starter_placeholder',
  growth: process.env.NEXT_PUBLIC_STRIPE_PRICE_GROWTH || 'price_growth_placeholder',
  network: process.env.NEXT_PUBLIC_STRIPE_PRICE_NETWORK || 'price_network_placeholder',
}

export default function BillingPage() {
  const [loading, setLoading] = useState<SubscriptionTier | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [currentTier, setCurrentTier] = useState<SubscriptionTier | null>(null)
  const [isActive, setIsActive] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)
  const [domainKey, setDomainKey] = useState<'childcare' | 'healthcare'>('childcare')
  const supabase = createClient()

  useEffect(() => {
    async function loadSubscription() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: admin } = await supabase
        .from('center_admins')
        .select('center_id')
        .eq('user_id', user.id)
        .single()

      if (admin) {
        const { data: center } = await supabase
          .from('centers')
          .select('subscription_tier, subscription_status, domain_key')
          .eq('id', admin.center_id)
          .single()

        if (center) {
          setCurrentTier(center.subscription_tier as SubscriptionTier)
          setIsActive(center.subscription_status === 'active' || center.subscription_status === 'trialing')
          if (center.domain_key) {
            setDomainKey(center.domain_key as 'childcare' | 'healthcare')
          }
        }
      }
      setPageLoading(false)
    }
    loadSubscription()
  }, [])

  async function handleManageSubscription() {
    setPortalLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        throw new Error(data.error || 'Failed to open portal')
      }
    } catch (err: any) {
      console.error(err)
      setError(err.message)
      setPortalLoading(false)
    }
  }

  async function handleSubscribe(tier: SubscriptionTier) {
    if (tier === 'enterprise') {
      window.location.href = `mailto:sales@carelocal.${domainKey === 'healthcare' ? 'net' : 'co'}`
      return
    }

    setLoading(tier)
    setError(null)

    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tierId: tier,
          billingCycle
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to initialize checkout')
      }

      // Redirect to Stripe Checkout
      if (data.url) {
        window.location.href = data.url
      }
    } catch (err: any) {
      console.error(err)
      setError(err.message)
    } finally {
      setLoading(null)
    }
  }

  const tiers: { id: SubscriptionTier, name: string, description: string, features: string[] }[] = [
    {
      id: 'starter',
      name: 'Starter',
      description: domainKey === 'healthcare' ? 'Perfect for single-location clinical practices.' : 'Perfect for single-location centers.',
      features: domainKey === 'healthcare'
        ? ['Up to 30 Active Medical Staff', '1 Clinic Location', 'Credential Review Vault', 'Standard Support']
        : ['Up to 30 Active Staff', '1 Facility Location', 'Basic Compliance Tracking', 'Standard Support']
    },
    {
      id: 'growth',
      name: 'Growth',
      description: domainKey === 'healthcare' ? 'For growing clinics and medical groups.' : 'For growing centers and small groups.',
      features: domainKey === 'healthcare'
        ? ['Up to 100 Active Medical Staff', 'Up to 3 Clinic Locations', 'Advanced Credential Workflows', 'Priority Support']
        : ['Up to 100 Active Staff', 'Up to 3 Facility Locations', 'Advanced Compliance Workflows', 'Priority Support']
    },
    {
      id: 'network',
      name: 'Network',
      description: domainKey === 'healthcare' ? 'Ideal for healthcare provider networks.' : 'Ideal for established childcare networks.',
      features: domainKey === 'healthcare'
        ? ['Up to 300 Active Medical Staff', 'Up to 10 Clinic Locations', 'Dedicated Account Manager', 'Custom API Access']
        : ['Up to 300 Active Staff', 'Up to 10 Facility Locations', 'Dedicated Account Manager', 'Custom API Access']
    }
  ]

  const tierOrder: SubscriptionTier[] = ['starter', 'growth', 'network']

  return (
    <div className="max-w-5xl mx-auto pb-24 px-6 md:px-10">
      <div className="mb-12 text-center max-w-2xl mx-auto">
        <h1 className="text-4xl font-extrabold text-[#0b3828] mb-4">Choose Your Plan</h1>
        <p className="text-[#6b7a73] text-lg mb-8">Select the right plan to manage your staff, compliance, and shifts effectively.</p>
        
        <div className="inline-flex items-center p-1 bg-[#f0f4f2] rounded-xl relative">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`relative w-32 py-2.5 text-sm font-bold rounded-lg transition-all z-10 ${
              billingCycle === 'monthly' ? 'text-[#0b3828]' : 'text-[#6b7a73] hover:text-[#1a2e25]'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle('yearly')}
            className={`relative w-40 py-2.5 text-sm font-bold rounded-lg transition-all z-10 flex items-center justify-center gap-1.5 ${
              billingCycle === 'yearly' ? 'text-[#0b3828]' : 'text-[#6b7a73] hover:text-[#1a2e25]'
            }`}
          >
            Yearly <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full uppercase tracking-tighter">2 Months Free</span>
          </button>
          <div 
            className="absolute top-1 bottom-1 w-32 bg-white rounded-lg shadow-sm border border-slate-200/50 transition-transform duration-300 ease-out"
            style={{ 
              transform: `translateX(${billingCycle === 'monthly' ? '0' : '100%'})`,
              width: billingCycle === 'yearly' ? '160px' : '128px'
            }}
          />
        </div>
      </div>

      {error && (
        <div className="mb-8 p-4 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold text-center">
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-8">
        {tiers.map((tier) => (
          <div key={tier.id} className="bg-white border-2 border-[#f0f4f2] rounded-3xl p-8 shadow-sm hover:shadow-lg transition-all flex flex-col relative overflow-hidden group">
            <div className="mb-6">
              <h3 className="text-xl font-black text-[#1a2e25] capitalize mb-2">{tier.name}</h3>
              <p className="text-[#6b7a73] text-sm h-10">{tier.description}</p>
            </div>
            
            <div className="mb-8">
              <span className="text-4xl font-black text-brand-900">
                ${billingCycle === 'monthly' ? getTierLimits(domainKey)[tier.id].pricePerMonth : (getTierLimits(domainKey)[tier.id].pricePerMonth * 10)}
              </span>
              <span className="text-[#a8b5ae] font-bold">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span>
              {billingCycle === 'yearly' && (
                <div className="text-xs text-brand-600 font-bold mt-1">Billed annually</div>
              )}
            </div>

            <ul className="space-y-4 mb-8 flex-1">
              {tier.features.map((feature, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#157354] shrink-0" />
                  <span className="text-sm font-medium text-[#1a2e25]">{feature}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto">
              {pageLoading ? (
                <div className="w-full py-4 rounded-xl bg-slate-100 animate-pulse"></div>
              ) : isActive && currentTier === tier.id ? (
                <div className="flex flex-col gap-3">
                  <button
                    disabled
                    className="w-full py-4 rounded-xl font-black flex items-center justify-center gap-2 bg-[#edf7f3] text-[#157354] opacity-80 cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-5 h-5" /> Current Plan
                  </button>
                  <button
                    onClick={handleManageSubscription}
                    disabled={portalLoading}
                    className="text-xs font-bold text-red-600 hover:text-red-700 hover:underline text-center w-full transition-colors"
                  >
                    {portalLoading ? 'Loading...' : 'Cancel Subscription'}
                  </button>
                </div>
              ) : isActive ? (
                <div className="flex flex-col gap-3">
                  <button
                    onClick={handleManageSubscription}
                    disabled={portalLoading}
                    className={`w-full py-4 rounded-xl font-black flex items-center justify-center gap-2 transition-all ${
                      tier.id === 'growth' 
                        ? 'bg-[#157354] text-white hover:bg-[#0f4a36] shadow-md' 
                        : 'bg-[#edf7f3] text-[#157354] hover:bg-[#d4ede4]'
                    }`}
                  >
                    {portalLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <CreditCard className="w-5 h-5" /> {(tierOrder.indexOf(tier.id) > tierOrder.indexOf(currentTier as any)) ? 'Upgrade to ' + tier.name : 'Downgrade to ' + tier.name}
                      </>
                    )}
                  </button>
                  {/* Keep spacing aligned with Current Plan card */}
                  <div className="h-[18px]"></div>
                </div>
              ) : (
                <button
                  onClick={() => handleSubscribe(tier.id)}
                  disabled={loading !== null}
                  className={`w-full py-4 rounded-xl font-black flex items-center justify-center gap-2 transition-all ${
                    tier.id === 'growth' 
                      ? 'bg-[#157354] text-white hover:bg-[#0f4a36] shadow-md' 
                      : 'bg-[#edf7f3] text-[#157354] hover:bg-[#d4ede4]'
                  }`}
                >
                  {loading === tier.id ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <CreditCard className="w-5 h-5" /> Subscribe
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Enterprise Card */}
      <div className="mt-8 bg-[#0b3828] text-white rounded-3xl p-10 flex flex-col md:flex-row items-center justify-between gap-8 shadow-xl relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-[#157354] rounded-full blur-[100px] opacity-30 pointer-events-none"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-[#74c3a8] font-black uppercase tracking-widest text-xs mb-2">
            <ShieldCheck className="w-4 h-4" /> Enterprise Edition
          </div>
          <h3 className="text-2xl font-black mb-2">Need unlimited capacity?</h3>
          <p className="text-[#a9dac9] max-w-md">Custom onboarding, SLA guarantees, and unlimited locations and staff for large enterprises.</p>
        </div>
        <button
          onClick={() => handleSubscribe('enterprise')}
          className="relative z-10 shrink-0 bg-white text-[#0b3828] font-black px-8 py-4 rounded-xl hover:bg-gray-100 transition-colors"
        >
          Contact Sales
        </button>
      </div>
    </div>
  )
}
