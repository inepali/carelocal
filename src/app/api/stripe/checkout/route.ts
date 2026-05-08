import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

// Default to a dummy key if not set to prevent immediate crashes, but warn
const stripeSecret = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder'
const stripe = new Stripe(stripeSecret, {
  apiVersion: '2025-02-24.acacia', // Update this based on the installed stripe-node version
})

export async function POST(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Stripe is not configured on the server. Please set STRIPE_SECRET_KEY in your environment.' },
        { status: 500 }
      )
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { tierId, priceId } = await req.json()

    if (!tierId || !priceId) {
      return NextResponse.json({ error: 'Missing tierId or priceId' }, { status: 400 })
    }

    if (priceId === 'price_starter_placeholder' || priceId.includes('placeholder')) {
      return NextResponse.json(
        { error: 'Please configure actual Stripe Price IDs in your environment (.env.local) to proceed.' },
        { status: 400 }
      )
    }

    // Get center data
    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    if (!admin) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 })
    }

    const { data: center } = await supabase
      .from('centers')
      .select('*')
      .eq('id', admin.center_id)
      .single()

    let customerId = center?.stripe_customer_id

    if (!customerId) {
      // Create Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          center_id: admin.center_id,
        },
      })
      customerId = customer.id

      // Note: Must use a service role key if RLS blocks updates from API routes without auth context, 
      // but since we are using createClient which uses the user's cookies, RLS should allow this update.
      await supabase
        .from('centers')
        .update({ stripe_customer_id: customerId })
        .eq('id', admin.center_id)
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/center/settings?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/center/settings/billing`,
      metadata: {
        center_id: admin.center_id,
        tier: tierId,
      },
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (error: any) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
