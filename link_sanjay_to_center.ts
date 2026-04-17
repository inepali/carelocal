import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function linkAdmin() {
  const userId = '53efb824-ac27-4455-b5f8-c135e45a9803' // Sanjay
  const centerId = 'aee153bd-9d4e-4855-a497-c6c3a86bbc14' // Smart Kids

  console.log(`Linking user ${userId} to center ${centerId}...`)
  
  const { error } = await supabase
    .from('center_admins')
    .insert({
      center_id: centerId,
      user_id: userId,
      role: 'owner'
    })
  
  if (error) {
    if (error.code === '23505') {
       console.log('User already linked as admin.')
    } else {
       console.error('Error linking admin:', error)
    }
    return
  }

  console.log('Successfully linked Sanjay as an admin for Smart Kids.')
}

linkAdmin()
