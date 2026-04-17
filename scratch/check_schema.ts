
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing env vars')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkSchema() {
  const { data, error } = await supabase
    .from('staff_profiles')
    .select('*')
    .limit(1)

  if (error) {
    console.error('Error fetching staff_profiles:', error)
  } else {
    console.log('Successfully fetched staff_profiles. Columns available:', Object.keys(data[0] || {}))
  }
}

checkSchema()
