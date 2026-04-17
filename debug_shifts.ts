import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function debug() {
  console.log('--- DEBUG DATA ---')
  
  // 1. Current user
  const email = 'sanjayaghimire@gmail.com'
  const { data: { users } } = await supabase.auth.admin.listUsers()
  const user = users.find(u => u.email === email)
  console.log(`User: ${email} -> ID: ${user?.id}`)

  if (!user) return

  // 2. Admin record
  const { data: adminData } = await supabase
    .from('center_admins')
    .select('*, centers(name)')
    .eq('user_id', user.id)
    .single()
  
  console.log('Admin Record:', JSON.stringify(adminData, null, 2))

  if (!adminData) return

  // 3. Shifts
  const { data: shifts, error: shiftsError } = await supabase
    .from('shifts')
    .select('*, classrooms(name)')
    .eq('center_id', adminData.center_id)
  
  console.log(`Shifts found for center ${adminData.center_id}: ${shifts?.length || 0}`)
  if (shiftsError) console.error('Shifts Error:', shiftsError)
  console.log('Shifts Data:', JSON.stringify(shifts, null, 2))
}

debug()
