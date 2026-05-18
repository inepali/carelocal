import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

const stripeSecret = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder'
const stripe = new Stripe(stripeSecret, {
  apiVersion: '2026-04-22.dahlia',
})

export async function POST(req: NextRequest) {
  try {
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
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: center.stripe_customer_id,
      return_url: `${origin}/center/subscription`,
    })

    return NextResponse.json({ url: portalSession.url })
  } catch (error: any) {
    console.error('Portal error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
