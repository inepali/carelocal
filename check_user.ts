import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function check() {
  const email = 'sanjayaghimire@gmail.com'
  console.log(`Checking user: ${email}`)
  
  const { data: { users }, error } = await supabase.auth.admin.listUsers()
  
  if (error) {
    console.error('Error listing users:', error)
    return
  }

  const user = users.find(u => u.email === email)
  if (user) {
    console.log(`User found: ${user.email} (${user.id})`)
    console.log('Metadata:', user.user_metadata)
  } else {
    console.log('User not found.')
  }
}

check()
