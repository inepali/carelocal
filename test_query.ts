import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testQuery() {
  console.log('Testing complex query...')
  
  const { data, error } = await supabase
    .from('shifts')
    .select(`
        *,
        classrooms (name, age_group),
        shift_claims (
            id,
            status,
            staff_profiles (first_name, last_name, avatar_url)
        )
    `)
    .limit(1)
  
  if (error) {
    console.error('QUERY FAILED:', error)
  } else {
    console.log('QUERY SUCCESS')
    console.log('Result:', JSON.stringify(data?.[0], null, 2))
  }
}

testQuery()
