'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CreditCard, ShieldCheck, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { showAlert } from '@/lib/dialog'

export default function SubscriptionTab() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)
  const [subscription, setSubscription] = useState<{
    tier: string | null;
    status: string | null;
    hasCustomer: boolean;
  } | null>(null)

  useEffect(() => {
    async function fetchSubscription() {
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
          .select('subscription_tier, subscription_status, stripe_customer_id')
          .eq('id', admin.center_id)
          .single()

        if (center) {
          setSubscription({
            tier: center.subscription_tier,
            status: center.subscription_status,
            hasCustomer: !!center.stripe_customer_id
          })
        }
      }
      setLoading(false)
    }
    fetchSubscription()
  }, [])

  const handleManageSubscription = async () => {
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

  if (loading) {
    return (
      <div className="py-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    )
  }

  const isActive = subscription?.status === 'active' || subscription?.status === 'trialing'

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h2 className="text-2xl font-black text-heading tracking-tight mb-2">Subscription & Billing</h2>
        <p className="text-muted font-medium">Manage your CareLocal plan and billing details.</p>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden mb-8">
        <div className="p-8 border-b border-slate-100 bg-surface/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl ${isActive ? 'bg-brand-50 text-brand-600' : 'bg-[#fffbeb] text-amber-600'}`}>
              <CreditCard className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-heading">Current Plan</h2>
              <p className="text-sm font-bold text-muted">
                Status: <span className={isActive ? 'text-brand-600 uppercase tracking-wider text-[11px]' : 'text-amber-600 uppercase tracking-wider text-[11px]'}>{subscription?.status || 'None'}</span>
              </p>
            </div>
          </div>
          
          {isActive && (
            <div className="px-4 py-2 bg-brand-50 text-[#16a34a] rounded-lg text-sm font-bold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Active Plan
            </div>
          )}
        </div>

        <div className="p-8">
          {subscription?.tier ? (
            <div className="mb-6">
              <div className="text-sm font-bold text-muted mb-1 uppercase tracking-widest">Selected Tier</div>
              <div className="text-3xl font-black text-text-main capitalize">{subscription.tier}</div>
            </div>
          ) : (
            <div className="mb-6 flex items-start gap-3 p-4 bg-[#fffbeb] text-[#b45309] rounded-xl">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-bold">You are currently not subscribed to any plan. You may be on a free trial or your plan has expired.</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4 mt-8 pt-6 border-t border-slate-100">
            {subscription?.hasCustomer && (
              <button
                onClick={handleManageSubscription}
                disabled={portalLoading}
                className="flex items-center justify-center gap-2 bg-brand-600 text-white font-black px-6 py-3.5 rounded-xl hover:bg-brand-800 transition-all shadow-md disabled:opacity-70 flex-1 sm:flex-none"
              >
                {portalLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
                Manage Subscription
              </button>
            )}
            
            <Link
              href="/center/settings/billing"
              className="flex items-center justify-center gap-2 bg-surface text-text-main border border-border font-black px-6 py-3.5 rounded-xl hover:bg-brand-50 hover:border-brand-600 hover:text-brand-600 transition-all flex-1 sm:flex-none"
            >
              View Pricing Tiers
            </Link>
          </div>
          
          {subscription?.hasCustomer && (
            <p className="text-xs font-bold text-subtle mt-4">
              Clicking "Manage Subscription" will open the secure Stripe billing portal where you can update your payment method, download invoices, upgrade, downgrade, or cancel your plan.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
