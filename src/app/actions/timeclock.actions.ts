'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function checkInStaff(shiftId: string, staffId: string) {
  const supabase = await createClient()

  const { error: claimError } = await supabase
    .from('shift_claims')
    .update({ check_in_time: new Date().toISOString() })
    .eq('shift_id', shiftId)
    .eq('staff_id', staffId)
    .eq('status', 'confirmed') // Ensure they are the confirmed staff

  if (claimError) return { error: claimError.message }

  revalidatePath('/center/shifts')
  return { success: true }
}

export async function checkOutStaff(shiftId: string, staffId: string) {
  const supabase = await createClient()

  const { error: claimError } = await supabase
    .from('shift_claims')
    .update({ check_out_time: new Date().toISOString() })
    .eq('shift_id', shiftId)
    .eq('staff_id', staffId)
    .eq('status', 'confirmed')

  if (claimError) return { error: claimError.message }

  // Update shift status to completed
  const { error: shiftError } = await supabase
    .from('shifts')
    .update({ status: 'completed' })
    .eq('id', shiftId)

  if (shiftError) return { error: shiftError.message }

  revalidatePath('/center/shifts')
  revalidatePath('/staff/my-shifts')
  return { success: true }
}
