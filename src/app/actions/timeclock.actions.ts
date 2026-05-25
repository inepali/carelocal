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

  // Apply Metro-Specific Staff Maintenance Fee
  try {
    const { data: shift } = await supabase
      .from('shifts')
      .select('center_id')
      .eq('id', shiftId)
      .single()

    if (shift?.center_id) {
      const { data: center } = await supabase
        .from('centers')
        .select('metro_area_id')
        .eq('id', shift.center_id)
        .single()

      if (center?.metro_area_id) {
        const { data: metro } = await supabase
          .from('metro_areas')
          .select('staff_maintenance_fee')
          .eq('id', center.metro_area_id)
          .single()

        const fee = metro?.staff_maintenance_fee ? parseFloat(metro.staff_maintenance_fee.toString()) : 0

        if (fee > 0) {
          const { data: staff } = await supabase
            .from('staff_profiles')
            .select('balance_due')
            .eq('id', staffId)
            .single()

          const currentBalance = staff?.balance_due ? parseFloat(staff.balance_due.toString()) : 0
          const newBalance = currentBalance + fee

          await supabase
            .from('staff_profiles')
            .update({ balance_due: newBalance })
            .eq('id', staffId)
        }
      }
    }
  } catch (err) {
    console.error('Failed to apply staff maintenance fee:', err)
  }

  revalidatePath('/center/shifts')
  revalidatePath('/staff/my-shifts')
  return { success: true }
}
