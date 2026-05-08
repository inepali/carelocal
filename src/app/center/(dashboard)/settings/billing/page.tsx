'use client'

import { useState } from 'react'
import { TIER_LIMITS, SubscriptionTier } from '@/lib/types'
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

  async function handleSubscribe(tier: SubscriptionTier) {
    if (tier === 'enterprise') {
      window.location.href = 'mailto:sales@carelocal.io'
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
          priceId: STRIPE_PRICES[tier as keyof typeof STRIPE_PRICES]
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
      description: 'Perfect for single-location centers.',
      features: ['Up to 30 Active Staff', '1 Facility Location', 'Basic Compliance Tracking', 'Standard Support']
    },
    {
      id: 'growth',
      name: 'Growth',
      description: 'For growing centers and small groups.',
      features: ['Up to 100 Active Staff', 'Up to 3 Facility Locations', 'Advanced Compliance Workflows', 'Priority Support']
    },
    {
      id: 'network',
      name: 'Network',
      description: 'Ideal for established childcare networks.',
      features: ['Up to 300 Active Staff', 'Up to 10 Facility Locations', 'Dedicated Account Manager', 'Custom API Access']
    }
  ]

  return (
    <div className="max-w-5xl mx-auto pb-24 px-6 md:px-10">
      <div className="mb-12 text-center max-w-2xl mx-auto">
        <h1 className="text-4xl font-extrabold text-[#0b3828] mb-4">Choose Your Plan</h1>
        <p className="text-[#6b7a73] text-lg">Select the right plan to manage your staff, compliance, and shifts effectively.</p>
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
              <span className="text-4xl font-black text-[#0b3828]">${TIER_LIMITS[tier.id].pricePerMonth}</span>
              <span className="text-[#a8b5ae] font-bold">/mo</span>
            </div>

            <ul className="space-y-4 mb-8 flex-1">
              {tier.features.map((feature, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#157354] shrink-0" />
                  <span className="text-sm font-medium text-[#1a2e25]">{feature}</span>
                </li>
              ))}
            </ul>

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
