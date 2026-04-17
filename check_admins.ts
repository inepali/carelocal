import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function check() {
  console.log('Checking center_admins...')
  const { data: admins, error } = await supabase
    .from('center_admins')
    .select('*, centers(name)')
  
  if (error) {
    console.error('Error fetching admins:', error)
    return
  }

  console.log('Admins found:', JSON.stringify(admins, null, 2))
}

check()
