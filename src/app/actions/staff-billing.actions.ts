'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Resets a staff member's outstanding balance_due to 0.00.
 * In a real application, this is called after a successful Stripe payment session.
 */
export async function payStaffBalance(staffId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('staff_profiles')
    .update({ balance_due: 0.00 })
    .eq('id', staffId)

  if (error) {
    console.error('Failed to clear staff balance:', error)
    return { error: error.message }
  }

  revalidatePath('/staff/shifts')
  return { success: true }
}
