import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { SubscriptionTier } from '@/lib/types'

const stripeSecret = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder'
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder'

const stripe = new Stripe(stripeSecret, {
  apiVersion: '2025-02-24.acacia',
})

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
            
            // Upsert subscription record
            // Using a service key approach or trusting RLS if webhooks have bypassing roles
            await supabase
              .from('subscriptions')
              .upsert({
                center_id: centerId,
                stripe_subscription_id: subscription.id,
                status: subscription.status,
                tier: tier,
                current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                cancel_at_period_end: subscription.cancel_at_period_end,
                updated_at: new Date().toISOString()
              }, { onConflict: 'center_id' })
              
            // Update center status
            await supabase
              .from('centers')
              .update({ 
                subscription_tier: tier,
                subscription_status: subscription.status
              })
              .eq('id', centerId)
          }
        }
        break;
      }
      
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        
        const { data: centerRecord } = await supabase
          .from('centers')
          .select('id')
          .eq('stripe_customer_id', subscription.customer as string)
          .single()
          
        if (centerRecord) {
          await supabase
            .from('subscriptions')
            .update({
              status: subscription.status,
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              cancel_at_period_end: subscription.cancel_at_period_end,
              updated_at: new Date().toISOString()
            })
            .eq('center_id', centerRecord.id)
            
          await supabase
            .from('centers')
            .update({ 
              subscription_status: subscription.status 
            })
            .eq('id', centerRecord.id)
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
