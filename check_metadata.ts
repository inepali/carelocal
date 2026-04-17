import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function check() {
  const email = 'sanjayaghimire@gmail.com'
  const { data: { users } } = await supabase.auth.admin.listUsers()
  const user = users.find(u => u.email === email)
  
  if (user) {
    console.log(`User: ${user.email}`)
    console.log('App Metadata:', JSON.stringify(user.app_metadata, null, 2))
    console.log('User Metadata:', JSON.stringify(user.user_metadata, null, 2))
  } else {
    console.log('User not found.')
  }
}

check()
