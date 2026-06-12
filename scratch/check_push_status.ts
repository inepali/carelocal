import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function inspect() {
  console.log('--- DB INSPECTION FOR PUSH NOTIFICATIONS ---')

  // 1. Check all users in auth.users
  const { data: { users }, error: usersErr } = await supabase.auth.admin.listUsers()
  if (usersErr) {
    console.error('Error listing auth users:', usersErr)
  } else {
    console.log(`\nAuth Users (Count: ${users?.length || 0}):`)
    users?.forEach(u => console.log(` - ID: ${u.id}, Email: ${u.email}`))
  }

  // 2. Check staff_profiles
  const { data: profiles, error: profsErr } = await supabase.from('staff_profiles').select('*')
  if (profsErr) {
    console.error('Error fetching staff_profiles:', profsErr)
  } else {
    console.log(`\nStaff Profiles (Count: ${profiles?.length || 0}):`)
    profiles?.forEach(p => console.log(` - ID: ${p.id}, UserID: ${p.user_id}, Name: ${p.first_name} ${p.last_name}, Email: ${p.email}`))
  }

  // 3. Check push_subscriptions
  const { data: subs, error: subsErr } = await supabase.from('push_subscriptions').select('*')
  if (subsErr) {
    console.error('Error fetching push_subscriptions:', subsErr)
  } else {
    console.log(`\nPush Subscriptions (Count: ${subs?.length || 0}):`)
    subs?.forEach(s => console.log(` - User ID: ${s.user_id}, Endpoint: ${s.endpoint.substring(0, 50)}...`))
  }

  // 4. Check center_staff
  const { data: cs, error: csErr } = await supabase.from('center_staff').select('*, staff_profiles(*)')
  if (csErr) {
    console.error('Error fetching center_staff:', csErr)
  } else {
    console.log(`\nCenter Staff Connections (Count: ${cs?.length || 0}):`)
    cs?.forEach(c => console.log(` - Center ID: ${c.center_id}, Staff ID (profile id): ${c.staff_id}, Status: ${c.status}, Profile user_id: ${c.staff_profiles?.user_id}`))
  }
}

inspect()
