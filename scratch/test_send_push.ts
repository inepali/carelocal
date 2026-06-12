import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import webpush from 'web-push'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:support@carelocal.co',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testPush() {
  const userId = '3c75584c-d91b-4f80-8a50-e1fc733a1376' // Staff1 Test
  console.log(`Fetching subscriptions for user: ${userId}`)
  
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId)

  if (error) {
    console.error('Error fetching subscriptions:', error)
    return
  }

  console.log(`Found ${subs?.length || 0} subscriptions:`)
  if (!subs || subs.length === 0) return

  const payload = JSON.stringify({
    title: 'CareLocal Test Alert',
    body: 'This is a test notification from the debug script.',
    url: '/mobile/shifts'
  })

  for (const sub of subs) {
    console.log(`\nSending to endpoint: ${sub.endpoint}`)
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth
      }
    }
    
    try {
      const res = await webpush.sendNotification(pushSubscription, payload)
      console.log(`Success! Response Status Code: ${res.statusCode}`)
    } catch (err: any) {
      console.error(`Failed to send push:`)
      console.error(`Status Code: ${err.statusCode}`)
      console.error(`Message: ${err.message}`)
      console.error(`Body: ${err.body}`)
    }
  }
}

testPush()
