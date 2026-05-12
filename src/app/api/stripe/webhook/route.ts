import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { SubscriptionTier } from '@/lib/types'

const stripeSecret = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder'
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder'

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const signature = req.headers.get('stripe-signature')

    if (!signature) {
      return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
    }

    let event: Stripe.Event

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch (err: any) {
      console.error(`Webhook signature verification failed: ${err.message}`)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        
        if (session.mode === 'subscription' && session.subscription) {
          const centerId = session.metadata?.center_id
          const tier = session.metadata?.tier as SubscriptionTier
          
          if (centerId && tier) {
            const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
            const mappedStatus = mapSubscriptionStatus(subscription.status)
            
            // Update center status
            const { error: updateCenterError } = await supabase
              .from('centers')
              .update({ 
                subscription_tier: tier,
                subscription_status: mappedStatus
              })
              .eq('id', centerId)

            if (updateCenterError) {
              console.error('Error updating center status:', updateCenterError)
            } else {
              console.log('Successfully updated center status', { centerId, tier, status: mappedStatus })
            }
          }
        }
        break;
      }
      
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        
        const mappedStatus = mapSubscriptionStatus(subscription.status)
        
        const { data: centerRecord } = await supabase
          .from('centers')
          .select('id')
          .eq('stripe_customer_id', subscription.customer as string)
          .single()
          
        if (centerRecord) {
          const { error: centerUpdateError } = await supabase
            .from('centers')
            .update({ 
              subscription_status: mappedStatus 
            })
            .eq('id', centerRecord.id)

          if (centerUpdateError) {
            console.error('Error updating center in customer.subscription.updated:', centerUpdateError)
          } else {
            console.log('Successfully updated center from customer.subscription', { centerId: centerRecord.id, status: mappedStatus })
          }
        }
        break;
      }
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
