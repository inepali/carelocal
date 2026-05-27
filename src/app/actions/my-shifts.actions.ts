'use server'

import { createClient } from '@supabase/supabase-js'

/**
 * Fetches all shifts a staff member has claimed, bypassing RLS.
 * This guarantees they can see their filled/assigned shifts without triggering
 * database-level recursive loop locks.
 */
export async function getMyShiftsBypassingRLS(staffId: string) {
  // Use service role key to securely bypass RLS rules without exposing it to the client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  
  const { data: claims, error: claimsErr } = await supabase
    .from('shift_claims')
    .select('shift_id, status, check_in_time, check_out_time')
    .eq('staff_id', staffId)
    .not('status', 'eq', 'cancelled')

  if (claimsErr || !claims || claims.length === 0) return { shifts: [], claims: [], reviews: [] }
  
  const shiftIds = claims.map(c => c.shift_id)
  
  const { data: shifts, error: shiftsErr } = await supabase
    .from('shifts')
    .select('*, centers(id, name, address, city, state, zip, slug, metro_area_id), classrooms(name, age_group)')
    .in('id', shiftIds)
    .order('shift_date', { ascending: true })
    
  if (shiftsErr) {
     console.error("Failed to fetch my shifts by service role:", shiftsErr)
     return { shifts: [], claims: claims, reviews: [] }
  }
  
  // Filter shifts to match visibility: 
  // 1. Assigned (confirmed) to the logged staff
  // 2. OR open shifts (not assigned to anyone) in the future (shift_date >= today)
  const todayStr = new Date().toISOString().split('T')[0]
  const allowedShifts = (shifts || []).filter(s => {
    const claim = claims.find(c => c.shift_id === s.id)
    if (!claim) return false
    if (claim.status === 'confirmed') return true
    return s.status === 'open' && s.shift_date >= todayStr
  })

  const allowedShiftIds = new Set(allowedShifts.map(s => s.id))
  const allowedClaims = claims.filter(c => allowedShiftIds.has(c.shift_id))

  const centerIds = Array.from(new Set((allowedShifts || []).map(s => s.center_id)))
  const { data: reviews } = await supabase
    .from('shift_reviews')
    .select('reviewee_id')
    .in('reviewee_id', centerIds)
    .eq('reviewer_id', staffId)
    .eq('reviewer_type', 'staff')
  
  return { shifts: allowedShifts, claims: allowedClaims, reviews: reviews || [] }
}
