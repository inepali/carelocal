import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfjpsucszngvsnacjscq.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmanBzdWNzem5ndnNuYWNqc2NxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTk2Mzk2MiwiZXhwIjoyMDkxNTM5OTYyfQ.PtBjDdpm2XFJ4wYPUQCulovvChqSkSVHud3DUs9PRfQ'

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkShifts() {
  console.log('Querying shift stats...')
  
  const { data: allShifts, error: error1 } = await supabase.from('shifts').select('id, is_archived')
  if (error1) {
    console.error('Error fetching all shifts:', error1)
    return
  }
  
  const counts = { true: 0, false: 0, null: 0 }
  for (const s of allShifts) {
    if (s.is_archived === true) counts.true++
    else if (s.is_archived === false) counts.false++
    else counts.null++
  }
  console.log('is_archived counts:', counts)

  const { data: filteredShifts, error: error2 } = await supabase.from('shifts').select('id').neq('is_archived', true)
  if (error2) {
    console.error('Error fetching filtered shifts:', error2)
  } else {
    console.log('Filtered count (neq true):', filteredShifts.length)
  }
}

checkShifts()
