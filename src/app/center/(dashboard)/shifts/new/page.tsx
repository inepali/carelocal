'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { WorkArea } from '@/lib/types'
import { useLookups } from '@/hooks/use-lookups'
import { Calendar, Clock, Loader2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useCenterContext } from '../../context'

export default function PostShiftPage() {
  const { staffTerm, workAreaTerm } = useCenterContext()
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [workAreas, setWorkAreas] = useState<WorkArea[]>([])
  const [centerId, setCenterId] = useState<string | null>(null)
  const { data: staffRoles } = useLookups('Role')
  const { data: paymentMethodsRaw } = useLookups('Payment Method')
  
  const paymentMethods = paymentMethodsRaw.filter(p => p.is_active !== false)
  const DEFAULT_PAYMENT_METHODS = [
    { value: 'payroll', label: 'Corporate Payroll' },
    { value: 'venmo', label: 'Venmo' },
    { value: 'cash', label: 'Cash' },
    { value: 'check', label: 'Check' },
    { value: 'zelle', label: 'Zelle' }
  ]

  // Form State
  const [shiftDate, setShiftDate] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('16:00')
  const [staffType, setStaffType] = useState<string>('any')
  const [workAreaId, setWorkAreaId] = useState('any')
  const [notes, setNotes] = useState('')
  const [hourlyRate, setHourlyRate] = useState('20.00')
  const [paymentMode, setPaymentMode] = useState('payroll')

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: adminData } = await supabase
        .from('center_admins')
        .select('center_id')
        .eq('user_id', user.id)
        .single()

      if (adminData) {
        setCenterId(adminData.center_id)
        const { data: rooms } = await supabase
          .from('work_areas')
          .select('*')
          .eq('center_id', adminData.center_id)
        
        if (rooms) setWorkAreas(rooms)
      }
    }
    loadData()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        setError("You must be logged in.")
        setLoading(false)
        return
    }

    const { data: adminData } = await supabase
        .from('center_admins')
        .select('center_id')
        .eq('user_id', user.id)
        .single()

    if (!adminData) {
        setError("You don't have permission to post shifts.")
        setLoading(false)
        return
    }

    // Build the payload
    const payload: any = {
        center_id: adminData.center_id,
        shift_date: shiftDate,
        start_time: startTime + ':00', // ensure valid time format
        end_time: endTime + ':00',
        staff_type_needed: staffType === 'any' ? null : staffType,
        work_area_id: workAreaId === 'any' ? null : workAreaId,
        notes: notes || null,
        hourly_rate: parseFloat(hourlyRate) || 0,
        payment_mode: paymentMode,
        status: 'open',
        created_by: user.id
    }

    const { data: insertedShift, error: insertError } = await supabase
        .from('shifts')
        .insert(payload)
        .select('id')
        .single()

    if (insertError) {
        console.error(insertError)
        setError('Failed to post the shift. Please try again.')
        setLoading(false)
        return
    }

    // Trigger Notifications in the background
    fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'shift_posted',
            shiftId: insertedShift.id,
            centerId: adminData.center_id,
            staffTypeNeeded: payload.staff_type_needed,
            shiftDate: payload.shift_date,
            startTime: payload.start_time,
            endTime: payload.end_time
        })
    }).catch(err => console.error('Failed to trigger notifications', err))

    // Redirect back to shifts list
    router.push('/center/shifts')
  }

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <div className="mb-6">
        <Link 
            href="/center/shifts" 
            className="inline-flex items-center gap-2 text-sm text-[#6b7a73] hover:text-[#157354] transition-colors mb-4"
        >
            <ArrowLeft className="w-4 h-4" /> Back to Shifts
        </Link>
        <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Post a New Shift</h1>
        <p className="text-[#6b7a73]">Create a shift to instantly notify your eligible staff pool.</p>
      </div>

      <div className="bg-white border border-[#e2e8e4] rounded-2xl shadow-sm overflow-hidden">
        <form onSubmit={handleSubmit} className="p-8 space-y-8">
            {error && (
                <div className="bg-red-50 text-red-700 p-4 rounded-xl text-sm border border-red-200">
                    {error}
                </div>
            )}

            {/* Date & Time */}
            <div className="space-y-4">
                <h2 className="text-lg font-bold text-[#1a2e25] flex items-center gap-2 border-b border-[#e2e8e4] pb-2">
                    <Calendar className="w-5 h-5 text-[#157354]" /> When is the shift?
                </h2>
                
                <div>
                    <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Date</label>
                    <input 
                        type="date" 
                        required
                        value={shiftDate}
                        onChange={(e) => setShiftDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]} // Can't be in the past
                        className="w-full sm:w-1/2 px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                    />
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Start Time</label>
                        <input 
                            type="time" 
                            required
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">End Time</label>
                        <input 
                            type="time" 
                            required
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                        />
                    </div>
                </div>
            </div>

            {/* Details */}
            <div className="space-y-4">
                <h2 className="text-lg font-bold text-[#1a2e25] flex items-center gap-2 border-b border-[#e2e8e4] pb-2">
                    <Clock className="w-5 h-5 text-[#157354]" /> Assignment Details
                </h2>

                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Role Needed</label>
                        <select
                            value={staffType}
                            onChange={(e) => setStaffType(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                        >
                            <option value="any">Any Role</option>
                            {staffRoles.filter(r => r.is_active !== false).map(role => (
                                <option key={role.value} value={role.value}>{role.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex-1">
                        <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">{workAreaTerm} (Optional)</label>
                        <select
                            value={workAreaId}
                            onChange={(e) => setWorkAreaId(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                        >
                            <option value="any">Float / No specific area</option>
                            {workAreas.map((room) => (
                                <option key={room.id} value={room.id}>{room.name} ({room.age_group})</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Notes for {staffTerm} (Optional)</label>
                    <textarea 
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="E.g., Park in the back lot, arrive 10 mins early for a quick rundown."
                        rows={3}
                        className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25] resize-none"
                    />
                </div>
            </div>

            {/* Compensation */}
            <div className="space-y-4 pt-4">
                <h2 className="text-lg font-bold text-[#1a2e25] flex items-center gap-2 border-b border-[#e2e8e4] pb-2">
                    <span className="text-xl">💰</span> Pay & Payment
                </h2>
                
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Hourly Rate ($)</label>
                        <div className="relative">
                            <span className="absolute left-4 top-3.5 text-[#6b7a73] font-bold">$</span>
                            <input 
                                type="number" 
                                step="0.50"
                                required
                                value={hourlyRate}
                                onChange={(e) => setHourlyRate(e.target.value)}
                                className="w-full pl-8 pr-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25] font-bold"
                            />
                        </div>
                    </div>
                    
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Payment Method</label>
                        <select
                            value={paymentMode}
                            onChange={(e) => setPaymentMode(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25] font-semibold"
                        >
                            {(paymentMethods.length > 0 ? paymentMethods : DEFAULT_PAYMENT_METHODS).map(p => (
                                <option key={p.value} value={p.value}>{p.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <p className="text-[11px] text-[#6b7a73] italic">
                    Transparency on pay and payment methods helps attract the best {staffTerm.toLowerCase()} to your center.
                </p>
            </div>

            {/* Actions */}
            <div className="pt-6 border-t border-[#e2e8e4] flex items-center justify-end gap-3">
                <button
                    type="button"
                    onClick={() => router.back()}
                    className="px-6 py-3 rounded-xl border border-[#e2e8e4] text-[#6b7a73] font-semibold hover:bg-[#f8faf9] transition-colors"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={loading || !shiftDate || !startTime || !endTime}
                    className="flex items-center justify-center gap-2 bg-[#157354] text-white font-semibold px-8 py-3 rounded-xl hover:bg-[#0f4a36] transition-colors disabled:opacity-60 shadow-sm"
                >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : `Post & Notify ${staffTerm}`}
                </button>
            </div>
        </form>
      </div>
    </div>
  )
}
