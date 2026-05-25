import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfjpsucszngvsnacjscq.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmanBzdWNzem5ndnNuYWNqc2NxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTk2Mzk2MiwiZXhwIjoyMDkxNTM5OTYyfQ.PtBjDdpm2XFJ4wYPUQCulovvChqSkSVHud3DUs9PRfQ'

const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  console.log('Querying all shifts...')
  const { data: shifts, error } = await supabase
    .from('shifts')
    .select(`
        *,
        centers (name, metro_area_id)
    `)
    .neq('is_archived', true)
  
  if (error) {
    console.error('Error:', error)
    return
  }
  
  console.log('Shifts found:', JSON.stringify(shifts, null, 2))
}

main()
