'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Mail, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { friendlyBillingError } from '@/lib/billing'
import { showAlert, showConfirm } from '@/lib/dialog'

interface State { enabled: boolean; is_owner: boolean; parent_page: boolean }

/**
 * Billing page: the owner's "Billing for families" switch. On: each parent who pays gets an email when billing is
 * submitted (their own share only), and sees a Billing tab on the parent page (bills, payments, credit, ACH drafts).
 */
export default function FamilyBillingCard({ centerId }: { centerId: string }) {
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('center_parent_billing_get', { p_center_id: centerId })
    // Not set up on this database yet: show nothing
    if (error) { setState(null); return }
    setState(data as State)
  }, [centerId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  if (!state) return null

  async function toggle() {
    if (!state) return
    const on = !state.enabled
    const msg = on
      ? 'From the next Submit Billing, each parent who pays gets an email with what they owe and how it’s paid (their own share only).'
        + (state.parent_page ? ' Parents also see a Billing tab on the parent page with their bills, payments and credit.' : ' The Billing tab appears on the parent page once the parent page is turned on.')
      : 'Parents stop getting bill emails and the Billing tab is hidden from the parent page. Emails already sent are not recalled.'
    if (!await showConfirm(msg, { title: on ? 'Turn on billing for families' : 'Turn off billing for families', confirmLabel: on ? 'Turn on' : 'Turn off' })) return
    setBusy(true)
    const { error } = await createClient().rpc('center_parent_billing_set', { p_center_id: centerId, p_enabled: on })
    setBusy(false)
    if (error) { showAlert(friendlyBillingError(error)); return }
    load()
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <Users className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <div>
          <p className="text-sm font-bold text-heading">
            Billing for families: <span className={state.enabled ? 'text-brand-600' : 'text-muted'}>{state.enabled ? 'On' : 'Off'}</span>
          </p>
          <p className="text-xs text-muted">
            {state.enabled
              ? <><Mail className="mr-1 inline h-3.5 w-3.5" />Parents get an email when you submit billing{state.parent_page ? ' and see their bills on the parent page.' : '. Turn on the parent page so they can also see their bills online.'}</>
              : 'Email parents their bill when you submit billing, and show their bills, payments and credit on the parent page.'}
          </p>
        </div>
      </div>
      {state.is_owner
        ? <button onClick={toggle} disabled={busy} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${state.enabled ? 'border border-border text-text-main hover:bg-surface' : 'bg-brand-600 text-white hover:bg-brand-800'}`}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{state.enabled ? 'Turn off' : 'Turn on'}
          </button>
        : <span className="text-xs text-muted">Only the owner can change this.</span>}
    </div>
  )
}
