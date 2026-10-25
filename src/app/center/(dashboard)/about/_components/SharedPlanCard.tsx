'use client'

import { useState } from 'react'
import { Building2, Check, Copy, Link2, Loader2, LogOut, Plus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { showAlert, showConfirm } from '@/lib/dialog'
import type { CenterPlanSummary } from '@/lib/center-plan'
import { TIER_LABELS } from '@/lib/types'

const formatDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * Sharing a paid Growth or Network plan with other centers. Each center stays independent (its own logins and
 * data); a secondary only takes its plan from the primary. Linking is by a one-time code: the primary's owner
 * creates it here, the other center's owner enters it on their own Subscription tab.
 */
export default function SharedPlanCard({ centerId, plan, onChanged }: { centerId: string; plan: CenterPlanSummary; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    const { error } = await fn()
    setBusy(false)
    if (error) { showAlert(error.message); return false }
    onChanged()
    return true
  }

  const createInvite = () => run(() => createClient().rpc('create_center_link_invite', { p_center_id: centerId }))

  /** Make an invite code, or, when the plan has no free slot (or can't share at all), explain and offer an upgrade. */
  async function addCenter() {
    const cap = plan.centers_cap
    const full = cap !== null && plan.centers_used >= cap
    if (plan.can_share && !full) return createInvite()

    const tier = TIER_LABELS[plan.own_tier]
    if (plan.can_share && plan.own_tier !== 'growth') {
      showAlert(`Your ${tier} plan covers ${cap} centers and all ${plan.centers_used} are in use. Contact us about an Enterprise plan to add more, or remove a center first.`, { title: 'Center limit reached' })
      return
    }
    const message = plan.can_share
      ? `Your Growth plan covers ${cap} centers and all ${plan.centers_used} are in use. Upgrade to Network to add up to 10 centers, or remove a center first.`
      : ['growth', 'network', 'enterprise'].includes(plan.own_tier)
        ? `Your ${tier} plan isn't active, so it can't cover other centers. Renew it to add centers.`
        : `Your ${tier} plan covers just this center. Upgrade to Growth (up to 3 centers) or Network (up to 10) to add more.`
    const ok = await showConfirm(message, { title: plan.can_share ? 'Center limit reached' : 'Upgrade to add centers', confirmLabel: 'See plans' })
    if (ok) document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' })
  }

  async function join() {
    if (!code.trim()) return
    if (await run(() => createClient().rpc('accept_center_link_invite', { p_center_id: centerId, p_code: code.trim() }))) setCode('')
  }

  async function unlink(id: string, name: string, leaving: boolean) {
    const ok = await showConfirm(
      leaving
        ? `Leave ${name}'s plan? This center goes back to its own plan right away.`
        : `Remove ${name} from your plan? It keeps the plan for 30 days, then goes back to its own plan.`,
      { title: leaving ? 'Leave shared plan' : 'Remove center', tone: 'danger', confirmLabel: leaving ? 'Leave' : 'Remove' },
    )
    if (ok) await run(() => createClient().rpc('unlink_center', { p_center_id: id }))
  }

  function copy(value: string) {
    navigator.clipboard?.writeText(value).then(() => { setCopied(value); setTimeout(() => setCopied(null), 1500) }).catch(() => {})
  }

  const card = 'bg-white rounded-3xl border border-slate-200 shadow-sm p-8 mb-8'
  const btn = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-50'

  // ── A secondary: on another center's plan ──
  if (plan.primary) {
    return (
      <div className={card}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-brand-50 p-3 text-brand-600"><Link2 className="h-6 w-6" /></div>
            <div>
              <h3 className="text-lg font-black text-heading">Shared plan</h3>
              <p className="text-sm text-muted">
                This center is on <strong className="text-text-main">{plan.primary.name}</strong>&rsquo;s {TIER_LABELS[plan.tier]} plan
                {plan.centers_cap ? ` (${plan.centers_used} of ${plan.centers_cap} centers)` : ''}. Billing is handled by {plan.primary.name}.
              </p>
              {plan.source === 'grace' && plan.grace_until && (
                <p className="mt-1 text-sm font-bold text-amber-600">Their plan has ended. This center keeps it until {formatDay(plan.grace_until)}; choose a plan below to keep going.</p>
              )}
            </div>
          </div>
          {plan.is_owner && (
            <button type="button" disabled={busy} onClick={() => unlink(centerId, plan.primary!.name, true)} className={`${btn} shrink-0 border border-border text-text-main hover:border-red-300 hover:text-red-600`}>
              <LogOut className="h-4 w-4" /> Leave
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── A primary (or a center that could become one) ──
  if (plan.can_share || plan.secondaries.length > 0) {
    const full = plan.centers_cap !== null && plan.centers_used >= plan.centers_cap
    return (
      <div className={card}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-black text-heading">Centers on this plan</h3>
            <p className="text-sm text-muted">
              Your {TIER_LABELS[plan.own_tier]} plan covers {plan.centers_cap ?? 'unlimited'} centers. Each center keeps its own logins, staff and records; only the plan is shared.
            </p>
          </div>
          <span className="shrink-0 rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-black text-brand-600">
            {plan.centers_used} / {plan.centers_cap ?? '∞'}
          </span>
        </div>

        <ul className="divide-y divide-border rounded-2xl border border-border">
          <li className="flex items-center gap-3 px-4 py-3 text-sm">
            <Building2 className="h-4 w-4 text-brand-600" />
            <span className="font-bold text-text-main">This center</span>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-brand-600">Primary</span>
          </li>
          {plan.secondaries.map(s => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <Building2 className="h-4 w-4 text-subtle" />
              <span className="min-w-0 flex-1 truncate font-semibold text-text-main">{s.name}</span>
              <span className="hidden text-xs text-muted sm:inline">Joined {formatDay(s.linked_at)}</span>
              {plan.is_owner && (
                <button type="button" disabled={busy} onClick={() => unlink(s.id, s.name, false)} aria-label={`Remove ${s.name}`} className="rounded-lg p-1.5 text-subtle hover:bg-red-50 hover:text-red-500">
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>

        {plan.is_owner && plan.invites.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">Open invite codes</div>
            <ul className="space-y-2">
              {plan.invites.map(i => (
                <li key={i.code} className="flex items-center gap-3 rounded-xl bg-surface px-4 py-2.5 text-sm">
                  <span className="font-mono text-base font-black tracking-widest text-heading">{i.code}</span>
                  <span className="flex-1 text-xs text-muted">One-time use · expires {formatDay(i.expires_at)}</span>
                  <button type="button" onClick={() => copy(i.code)} className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:underline">
                    {copied === i.code ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">The other center&rsquo;s owner enters the code under About → Subscription on their own account.</p>
          </div>
        )}

        {plan.is_owner && (
          <div className="mt-5">
            <button type="button" disabled={busy} onClick={addCenter} className={`${btn} bg-brand-600 text-white hover:bg-brand-800`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add a center
            </button>
            {full && <span className="ml-3 text-sm text-muted">All {plan.centers_cap} centers on your plan are in use.</span>}
          </div>
        )}
      </div>
    )
  }

  // ── Not sharing: the owner can join another center's plan ──
  if (!plan.is_owner) return null
  return (
    <div className={card}>
      <div className="mb-6 flex flex-col gap-3 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-black text-heading">Centers on this plan</h3>
          <p className="text-sm text-muted">Your {TIER_LABELS[plan.own_tier]} plan covers 1 center. Growth covers up to 3 and Network up to 10.</p>
        </div>
        <button type="button" disabled={busy} onClick={addCenter} className={`${btn} shrink-0 bg-brand-600 text-white hover:bg-brand-800`}>
          <Plus className="h-4 w-4" /> Add a center
        </button>
      </div>
      <h3 className="text-lg font-black text-heading">Join another center&rsquo;s plan</h3>
      <p className="mb-4 text-sm text-muted">
        If this center is part of a group on a Growth or Network plan, enter the invite code from the main center&rsquo;s owner. Your center stays separate; only the plan is shared.
        {plan.own_tier === 'starter' && ' (Cancel this center’s own Starter plan first, so you are not billed twice.)'}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') join() }}
          placeholder="XXXXX-XXXXX"
          aria-label="Invite code"
          className="rounded-xl border border-border bg-white px-4 py-2.5 font-mono text-sm font-bold tracking-widest focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10 sm:w-56"
        />
        <button type="button" disabled={busy || !code.trim()} onClick={join} className={`${btn} border border-brand-600 text-brand-600 hover:bg-brand-50`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Join plan
        </button>
      </div>
    </div>
  )
}
