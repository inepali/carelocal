'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { payStaffBalance } from '@/app/actions/staff-billing.actions'
import { 
  CreditCard, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  TrendingUp, 
  CheckCircle, 
  ArrowRight,
  Info
} from 'lucide-react'
import Link from 'next/link'

export default function StaffAccountPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
  
  // Payment states
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [paymentSuccessMessage, setPaymentSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('staff_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single()
      
      setProfile(data || null)
      setLoading(false)
    }

    loadData()
  }, [])

  const handlePayBalance = async () => {
    if (!profile) return
    setIsProcessingPayment(true)
    try {
      const result = await payStaffBalance(profile.id)
      if (result.error) {
        alert('Payment failed: ' + result.error)
      } else {
        setProfile((prev: any) => ({ ...prev, balance_due: 0.00 }))
        setPaymentSuccessMessage('Your balance has been successfully cleared!')
        setTimeout(() => setPaymentSuccessMessage(null), 4000)
        setIsPaymentModalOpen(false)
      }
    } catch (err: any) {
      alert('An error occurred during payment processing: ' + err.message)
    } finally {
      setIsProcessingPayment(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl animate-pulse">
        <div className="h-40 bg-white rounded-3xl border border-[#e2e8e4] mb-8"></div>
        <div className="h-64 bg-white rounded-3xl border border-[#e2e8e4]"></div>
      </div>
    )
  }

  const balance = profile?.balance_due ? parseFloat(profile.balance_due.toString()) : 0

  return (
    <div className="max-w-4xl pb-32">
      {/* Toast Success Notification */}
      {paymentSuccessMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 bg-[#157354] text-white font-bold rounded-2xl shadow-xl flex items-center gap-2 animate-bounce">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{paymentSuccessMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-2 text-[#157354] font-black tracking-[0.12em] text-[10px] uppercase mb-2">
          <TrendingUp className="w-4 h-4" /> Billing & Fees
        </div>
        <h1 className="text-4xl font-black text-[#0b3828] mb-2 tracking-tight">My Account</h1>
        <p className="text-[#6b7a73] text-lg font-medium">
          Manage your platform balance and view outstanding fees.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Left Column: Balance Card */}
        <div className="md:col-span-7 space-y-6">
          
          {/* Balance Dues Box */}
          <div className="bg-white rounded-[2rem] border-2 border-[#e6ece9] p-8 shadow-sm">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-black text-[#0b3828] mb-1">Platform Account Balance</h3>
                <p className="text-[#6b7a73] text-xs font-semibold uppercase tracking-wider">Statement Summary</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#edf7f3] flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-[#157354]" />
              </div>
            </div>

            <div className="py-6 border-y border-[#e6ece9] mb-6">
              <span className="text-[#6b7a73] text-sm font-semibold">Total Outstanding Due</span>
              <div className="text-5xl font-black text-[#0b3828] mt-1 flex items-baseline gap-1">
                <span>${balance.toFixed(2)}</span>
                <span className="text-sm text-[#6b7a73] font-medium uppercase tracking-wide">USD</span>
              </div>
            </div>

            {balance > 0 ? (
              <div>
                <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex gap-3 text-amber-800 text-xs font-medium leading-relaxed">
                  <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-amber-950 font-bold block mb-0.5">Shift Claiming Restricted</strong>
                    You have an outstanding balance due. You must clear this fee balance of ${balance.toFixed(2)} before you are allowed to claim new shifts.
                  </div>
                </div>
                
                <button
                  onClick={() => setIsPaymentModalOpen(true)}
                  className="w-full bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-md active:translate-y-px text-sm cursor-pointer"
                >
                  Pay Outstanding Balance
                </button>
              </div>
            ) : (
              <div className="p-4 bg-[#edf7f3] border border-[#d4ede4] rounded-2xl flex gap-3 text-[#157354] text-xs font-semibold leading-relaxed">
                <CheckCircle className="w-5 h-5 text-[#157354] shrink-0 mt-0.5" />
                <div>
                  <strong className="text-[#0b3828] font-bold block mb-0.5">Account in Good Standing</strong>
                  No outstanding fees. You are fully authorized to claim open shifts on the marketplace.
                </div>
              </div>
            )}
          </div>

          {/* Quick Help box */}
          <div className="bg-[#edf7f3] rounded-2xl border border-[#d4ede4] p-6">
            <div className="flex gap-4">
              <Info className="w-5 h-5 text-[#157354] shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-[#0b3828] text-sm mb-1">What is the Staff Maintenance Fee?</h4>
                <p className="text-[#3d5a4f] text-xs leading-relaxed">
                  This fee is defined per Metro Area by platform administrators. It is automatically charged to your account statement upon checking into a confirmed shift. Accumulating fees must be paid to keep claiming shifts.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Statement Details */}
        <div className="md:col-span-5 bg-white rounded-[2rem] border-2 border-[#e6ece9] p-8 shadow-sm">
          <h3 className="text-lg font-black text-[#0b3828] mb-4">Account Information</h3>
          
          <div className="space-y-4">
            <div className="pb-3 border-b border-[#e6ece9]">
              <span className="text-[#6b7a73] text-[10px] font-bold uppercase tracking-wider">Account Holder</span>
              <span className="block text-sm font-bold text-[#0b3828] mt-0.5">
                {profile ? `${profile.first_name} ${profile.last_name}` : '—'}
              </span>
            </div>

            <div className="pb-3 border-b border-[#e6ece9]">
              <span className="text-[#6b7a73] text-[10px] font-bold uppercase tracking-wider">Registered Email</span>
              <span className="block text-sm font-medium text-[#0b3828] mt-0.5 truncate">
                {profile?.email || '—'}
              </span>
            </div>

            <div className="pb-3 border-b border-[#e6ece9]">
              <span className="text-[#6b7a73] text-[10px] font-bold uppercase tracking-wider">User ID Reference</span>
              <span className="block text-[11px] font-mono text-slate-500 mt-0.5 truncate">
                {profile?.id || '—'}
              </span>
            </div>

            <div>
              <span className="text-[#6b7a73] text-[10px] font-bold uppercase tracking-wider">Platform Status</span>
              <span className="block mt-1">
                <span className="inline-block bg-[#edf7f3] border border-[#d4ede4] text-[#157354] text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
                  Verified Educator
                </span>
              </span>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-[#e6ece9]">
            <Link 
              href="/staff/shifts"
              className="text-[#157354] hover:text-[#0b3828] font-bold text-xs uppercase tracking-widest flex items-center gap-1.5 transition-colors"
            >
              Browse Open Shifts <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* ── Payment Sandbox Modal ── */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-[2rem] border-2 border-[#e6ece9] max-w-md w-full p-8 shadow-2xl relative animate-slide-up text-left">
            <button 
              onClick={() => setIsPaymentModalOpen(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-3 mb-6">
              <CreditCard className="w-6 h-6 text-[#157354]" />
              <h3 className="text-2xl font-black text-[#0b3828]">Pay Balance Due</h3>
            </div>

            <div className="bg-[#f8faf9] rounded-2xl p-4 border border-[#e6ece9] mb-6 flex justify-between items-center">
              <span className="text-[#3d5a4f] text-sm font-semibold">Amount to Pay</span>
              <span className="text-2xl font-black text-[#157354]">
                ${balance.toFixed(2)}
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#0b3828] mb-1">Cardholder Name</label>
                <input 
                  type="text" 
                  disabled={isProcessingPayment} 
                  defaultValue={profile ? `${profile.first_name} ${profile.last_name}` : ''}
                  className="w-full px-3.5 py-2.5 text-sm border border-[#e6ece9] rounded-xl bg-[#f8faf9] outline-none focus:border-[#157354]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0b3828] mb-1">Card Number (Sandbox)</label>
                <div className="relative">
                  <input 
                    type="text" 
                    disabled={isProcessingPayment} 
                    placeholder="4242 4242 4242 4242"
                    maxLength={19}
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-[#e6ece9] rounded-xl bg-[#f8faf9] outline-none focus:border-[#157354]"
                  />
                  <CreditCard className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#0b3828] mb-1">Expiration</label>
                  <input 
                    type="text" 
                    disabled={isProcessingPayment} 
                    placeholder="MM/YY"
                    maxLength={5}
                    className="w-full px-3.5 py-2.5 text-sm border border-[#e6ece9] rounded-xl bg-[#f8faf9] outline-none focus:border-[#157354]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#0b3828] mb-1">CVC</label>
                  <input 
                    type="password" 
                    disabled={isProcessingPayment} 
                    placeholder="•••"
                    maxLength={3}
                    className="w-full px-3.5 py-2.5 text-sm border border-[#e6ece9] rounded-xl bg-[#f8faf9] outline-none focus:border-[#157354]"
                  />
                </div>
              </div>

              <div className="pt-4">
                <button
                  onClick={handlePayBalance}
                  disabled={isProcessingPayment}
                  className="w-full bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-3.5 px-4 rounded-xl transition-all disabled:opacity-75 flex items-center justify-center gap-2 text-sm cursor-pointer"
                >
                  {isProcessingPayment ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing Sandbox Payment...
                    </>
                  ) : (
                    `Pay $${balance.toFixed(2)} Now`
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
