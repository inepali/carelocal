import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfjpsucszngvsnacjscq.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmanBzdWNzem5ndnNuYWNqc2NxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTk2Mzk2MiwiZXhwIjoyMDkxNTM5OTYyfQ.PtBjDdpm2XFJ4wYPUQCulovvChqSkSVHud3DUs9PRfQ'

const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
  console.log('Testing update on centers table...')
  
  // Try to find a center to test with
  const { data: center, error: fetchError } = await supabase.from('centers').select('id').limit(1).single()
  
  if (fetchError) {
    console.error('Fetch error:', fetchError)
    return
  }
  
  console.log('Found center:', center.id)
  
  // Test update
  const { data, error } = await supabase
    .from('centers')
    .update({
      subscription_tier: 'starter',
      subscription_status: 'active'
    })
    .eq('id', center.id)
    .select()
    
  if (error) {
    console.error('Update error:', error)
  } else {
    console.log('Update success:', data)
  }
}

test()
