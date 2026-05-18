import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { SubscriptionTier } from '@/lib/types'

const stripeSecret = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder'

const stripe = new Stripe(stripeSecret, {
  apiVersion: '2026-04-22.dahlia',
})

// Helper to map Stripe status to DB Enum
function mapSubscriptionStatus(status: string): string {
  if (['active', 'trialing', 'past_due', 'canceled', 'paused'].includes(status)) {
    return status;
  }
  if (status === 'incomplete' || status === 'incomplete_expired' || status === 'unpaid') {
    return 'past_due';
  }
  return 'past_due'; // fallback
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams
    const sessionId = searchParams.get('session_id')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId)
    
    if (session.payment_status === 'paid' || session.status === 'complete') {
      const centerId = session.metadata?.center_id
      const tier = session.metadata?.tier as SubscriptionTier

      if (centerId && tier && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
        const mappedStatus = mapSubscriptionStatus(subscription.status)
        
        const supabase = await createClient()
        
        // Update center status
        const { error: updateCenterError } = await supabase
          .from('centers')
          .update({ 
            subscription_tier: tier,
            subscription_status: mappedStatus
          })
          .eq('id', centerId)

        if (updateCenterError) {
          console.error('Error updating center status in verify:', updateCenterError)
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Verify error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
