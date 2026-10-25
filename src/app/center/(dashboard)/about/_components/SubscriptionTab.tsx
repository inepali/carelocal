'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, CreditCard, ShieldCheck, AlertCircle } from 'lucide-react'
import { TIER_LABELS, trialDaysLeft, type SubscriptionTier } from '@/lib/types'
import { loadCenterPlan, type CenterPlanSummary } from '@/lib/center-plan'
import { useCenterContext } from '../../context'
import PlanPicker from './PlanPicker'
import SharedPlanCard from './SharedPlanCard'
import { showAlert } from '@/lib/dialog'

const formatDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function SubscriptionTab() {
  const { centerId } = useCenterContext()
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)
  const [subscription, setSubscription] = useState<{
    tier: string | null;
    status: string | null;
    hasCustomer: boolean;
    trialDaysLeft: number;
  } | null>(null)
  const [plan, setPlan] = useState<CenterPlanSummary | null>(null)

  const load = useCallback(async () => {
    if (!centerId) return
    const [{ data: center }, summary] = await Promise.all([
      createClient()
        .from('centers')
        .select('subscription_tier, subscription_status, stripe_customer_id, created_at, trial_months, trial_started_at')
        .eq('id', centerId)
        .single(),
      loadCenterPlan(centerId).catch(err => { console.error('[subscription] plan summary:', err); return null }),
    ])
    if (center) {
      setSubscription({
        // The plan this center actually gets (a secondary's comes from its primary)
        tier: summary?.tier ?? center.subscription_tier,
        status: summary?.status ?? center.subscription_status,
        hasCustomer: !!center.stripe_customer_id,
        trialDaysLeft: trialDaysLeft(center),
      })
    }
    setPlan(summary)
    setLoading(false)
  }, [centerId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

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

  const shared = plan?.source === 'primary'
  const isTrial = subscription?.tier === 'trial'
  // A trial is not a paid plan: only a Stripe-backed subscription (or a shared one) counts as active
  const isActive = !isTrial && (subscription?.status === 'active' || subscription?.status === 'trialing')

  return (
    <div className="max-w-5xl">
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
                Status: <span className={isActive ? 'text-brand-600 uppercase tracking-wider text-[11px]' : 'text-amber-600 uppercase tracking-wider text-[11px]'}>{isTrial ? 'Free trial' : shared ? 'Shared' : subscription?.status || 'None'}</span>
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
              <div className="text-3xl font-black text-text-main">{TIER_LABELS[subscription.tier as SubscriptionTier] ?? subscription.tier}</div>
              {shared && plan?.primary && (
                <p className="mt-2 text-sm font-bold text-brand-600">Shared from {plan.primary.name}</p>
              )}
              {plan?.source === 'grace' && plan.grace_until && !plan.primary && (
                <p className="mt-2 text-sm font-bold text-amber-600">
                  Your shared plan has ended. This center keeps it until {formatDay(plan.grace_until)}; choose a plan below to keep going.
                </p>
              )}
              {isTrial && (
                <p className="mt-2 text-sm font-bold text-amber-600">
                  {subscription.trialDaysLeft > 0
                    ? `${subscription.trialDaysLeft} day${subscription.trialDaysLeft === 1 ? '' : 's'} left. No card needed until you choose a plan below.`
                    : 'Your free trial has ended. Choose a plan below to keep going.'}
                </p>
              )}
            </div>
          ) : (
            <div className="mb-6 flex items-start gap-3 p-4 bg-[#fffbeb] text-[#b45309] rounded-xl">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-bold">You are currently not subscribed to any plan. Choose a plan below.</p>
            </div>
          )}

          {subscription?.hasCustomer && !shared && (
            <div className="flex flex-col sm:flex-row gap-4 mt-8 pt-6 border-t border-slate-100">
              <button
                onClick={handleManageSubscription}
                disabled={portalLoading}
                className="flex items-center justify-center gap-2 bg-brand-600 text-white font-black px-6 py-3.5 rounded-xl hover:bg-brand-800 transition-all shadow-md disabled:opacity-70 flex-1 sm:flex-none"
              >
                {portalLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
                Manage Subscription
              </button>
            </div>
          )}

          {subscription?.hasCustomer && !shared && (
            <p className="text-xs font-bold text-subtle mt-4">
              Clicking &quot;Manage Subscription&quot; will open the secure Stripe billing portal where you can update your payment method, download invoices, upgrade, downgrade, or cancel your plan.
            </p>
          )}
        </div>
      </div>

      {plan && centerId && <SharedPlanCard centerId={centerId} plan={plan} onChanged={load} />}

      {/* A center on a shared plan is billed through its primary */}
      {!shared && <PlanPicker />}
    </div>
  )
}
