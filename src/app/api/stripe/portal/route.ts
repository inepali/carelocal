import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/server/stripe'
import { createClient } from '@/lib/supabase/server'


export async function POST(req: NextRequest) {
  try {
    const stripe = getStripe()
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    if (!admin) return NextResponse.json({ error: 'Not an admin' }, { status: 403 })

    const { data: center } = await supabase
      .from('centers')
      .select('stripe_customer_id')
      .eq('id', admin.center_id)
      .single()

    if (!center?.stripe_customer_id) {
       return NextResponse.json({ error: 'No subscription found' }, { status: 400 })
    }

    const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: center.stripe_customer_id,
        return_url: `${origin}/center/about#subscription`,
      })
      return NextResponse.json({ url: portalSession.url })
    } catch (err: any) {
      // The saved customer is not in this Stripe account (e.g. created in test mode before switching to live keys,
      // or deleted in the dashboard). Forget it, the same way checkout does, so the next upgrade creates a fresh one.
      if (err?.code !== 'resource_missing') throw err
      console.warn('[stripe] portal: stale customer cleared', admin.center_id, center.stripe_customer_id)
      await supabase.from('centers').update({ stripe_customer_id: null }).eq('id', admin.center_id)
      return NextResponse.json({ error: 'No subscription found for this center. Please choose a plan to subscribe.' }, { status: 400 })
    }
  } catch (error: any) {
    console.error('Portal error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
