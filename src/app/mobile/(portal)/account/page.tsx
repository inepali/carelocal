'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { payStaffBalance } from '@/app/actions/staff-billing.actions'
import { useRouter } from 'next/navigation'
import { 
  CreditCard, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  User, 
  Mail, 
  ShieldCheck, 
  LogOut,
  Info
} from 'lucide-react'

interface StaffProfile {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  balance_due: number | null
  staff_type: string
}

export default function MobileAccountPage() {
  const supabase = createClient()
  const router = useRouter()
  
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<StaffProfile | null>(null)
  
  // Payment states
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [paymentSuccessMessage, setPaymentSuccessMessage] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data } = await supabase
          .from('staff_profiles')
          .select('*')
          .eq('user_id', user.id)
          .single()
        
        setProfile(data || null)
      } catch (err: unknown) {
        console.error('Error loading profile:', err)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [supabase])

  const handlePayBalance = async () => {
    if (!profile) return
    setIsProcessingPayment(true)
    setErrorMsg(null)
    
    try {
      const result = await payStaffBalance(profile.id)
      if (result.error) {
        setErrorMsg(result.error)
      } else {
        setProfile((prev) => prev ? ({ ...prev, balance_due: 0.00 }) : null)
        setPaymentSuccessMessage('Your balance has been successfully cleared!')
        setTimeout(() => setPaymentSuccessMessage(null), 4000)
        setIsPaymentModalOpen(false)
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment processing failed')
    } finally {
      setIsProcessingPayment(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/mobile/login')
  }

  if (loading) {
    return (
      <div className="space-y-4 py-4 animate-pulse">
        <div className="h-6 w-1/2 bg-slate-200 rounded-xl mb-6"></div>
        <div className="h-32 bg-white rounded-2xl border border-slate-100 mb-4"></div>
        <div className="h-44 bg-white rounded-2xl border border-slate-100"></div>
      </div>
    )
  }

  const balance = profile?.balance_due ? parseFloat(profile.balance_due.toString()) : 0

  return (
    <div className="py-2 space-y-6">
      {/* Toast Success Notification */}
      {paymentSuccessMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 p-4 bg-[#157354] text-white font-bold rounded-2xl shadow-xl flex items-center gap-2 text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{paymentSuccessMessage}</span>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-[#0b3828] tracking-tight">My Account</h1>
        <p className="text-xs text-[#6b7a73] font-medium mt-1">Manage payments, invoices, and profile configurations.</p>
      </div>

      {/* Platform Balance Box */}
      <div className="bg-white rounded-2xl border border-[#e6ece9] p-5 shadow-sm space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-xs font-black text-[#0b3828] uppercase tracking-wider">Account Balance</h3>
            <p className="text-[10px] text-[#6b7a73] font-semibold uppercase tracking-wider mt-0.5">Fees & Statements</p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-[#edf7f3] flex items-center justify-center">
            <CreditCard className="w-4 h-4 text-[#157354]" />
          </div>
        </div>

        <div className="py-3 border-y border-[#e6ece9]">
          <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Total Outstanding Due</span>
          <div className="text-3xl font-black text-[#0b3828] mt-1 flex items-baseline gap-1">
            <span>${balance.toFixed(2)}</span>
            <span className="text-xs text-[#6b7a73] font-bold uppercase tracking-wider">USD</span>
          </div>
        </div>

        {balance > 0 ? (
          <div className="space-y-3">
            <div className="p-3.5 bg-yellow-50 border border-yellow-200 rounded-xl flex gap-2.5 text-yellow-900 text-xs leading-relaxed">
              <AlertCircle className="w-4 h-4 text-yellow-800 shrink-0 mt-0.5" />
              <div>
                <strong className="text-[#0b3828] font-bold block mb-0.5">Shift Claiming Locked</strong>
                You have outstanding maintenance fees. Clear your balance to unlock marketplace shifts.
              </div>
            </div>
            
            <button
              onClick={() => setIsPaymentModalOpen(true)}
              className="w-full bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-3 px-4 rounded-xl shadow-sm text-xs uppercase tracking-wider transition-all cursor-pointer text-center"
            >
              Pay Outstanding Balance
            </button>
          </div>
        ) : (
          <div className="p-3.5 bg-[#edf7f3] border border-[#d4ede4] rounded-xl flex gap-2.5 text-[#157354] text-xs leading-relaxed">
            <CheckCircle2 className="w-4 h-4 text-[#157354] shrink-0 mt-0.5" />
            <div>
              <strong className="text-[#0b3828] font-bold block mb-0.5">Account Active</strong>
              No outstanding fees. You are fully authorized to claim open shifts.
            </div>
          </div>
        )}
      </div>

      {/* Account Info Details */}
      <div className="bg-white rounded-2xl border border-[#e6ece9] p-5 shadow-sm space-y-4">
        <h3 className="text-xs font-black text-[#0b3828] uppercase tracking-wider border-b border-[#f0f4f2] pb-2">
          Profile Details
        </h3>
        
        <div className="space-y-3 text-xs">
          <div className="flex justify-between items-center py-1 border-b border-[#f8faf9]">
            <span className="text-slate-400 font-medium flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" /> Name:
            </span>
            <span className="font-bold text-[#0b3828]">
              {profile ? `${profile.first_name} ${profile.last_name}` : '—'}
            </span>
          </div>

          <div className="flex justify-between items-center py-1 border-b border-[#f8faf9]">
            <span className="text-slate-400 font-medium flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-400" /> Email:
            </span>
            <span className="font-bold text-[#0b3828] truncate max-w-[180px]">
              {profile?.email || '—'}
            </span>
          </div>

          <div className="flex justify-between items-center py-1">
            <span className="text-slate-400 font-medium flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400" /> Status:
            </span>
            <span className="inline-block bg-[#edf7f3] border border-[#d4ede4] text-[#157354] text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full">
              Verified Educator
            </span>
          </div>
        </div>
      </div>

      {/* Info maintenance fee explanation */}
      <div className="bg-[#edf7f3] border border-[#d4ede4] rounded-2xl p-4 flex gap-3 text-xs">
        <Info className="w-4.5 h-4.5 text-[#157354] shrink-0 mt-0.5" />
        <div>
          <h4 className="font-bold text-[#0b3828] text-xs">Staff Maintenance Fee</h4>
          <p className="text-[#3d5a4f] text-[11px] leading-relaxed mt-1">
            CareLocal applies a standard maintenance fee per metro area when checking into shifts. Clear this fee from this tab to keep your account open.
          </p>
        </div>
      </div>

      {/* Logout Action */}
      <div className="pt-2">
        <button
          onClick={handleLogout}
          className="w-full border border-rose-200 hover:bg-rose-50 text-rose-600 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wider cursor-pointer shadow-sm"
        >
          <LogOut className="w-4 h-4" /> Sign Out of CareLocal
        </button>
      </div>

      {/* ── Payment Sandbox Modal ── */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-3xl border border-[#e6ece9] max-w-sm w-full p-5 shadow-2xl relative text-left">
            <button 
              onClick={() => setIsPaymentModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            
            <div className="flex items-center gap-2 mb-4">
              <CreditCard className="w-5 h-5 text-[#157354]" />
              <h3 className="text-base font-black text-[#0b3828]">Sandbox Payment</h3>
            </div>

            {errorMsg && (
              <div className="mb-4 p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-[11px] flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="bg-[#f8faf9] rounded-xl p-3 border border-[#e6ece9] mb-4 flex justify-between items-center text-xs">
              <span className="text-[#3d5a4f] font-semibold">Total Amount Due</span>
              <span className="text-lg font-black text-[#157354]">
                ${balance.toFixed(2)}
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-black text-[#0b3828] mb-1 uppercase tracking-wider">Cardholder Name</label>
                <input 
                  type="text" 
                  disabled={isProcessingPayment} 
                  defaultValue={profile ? `${profile.first_name} ${profile.last_name}` : ''}
                  className="w-full px-3 py-2 border border-[#e6ece9] rounded-xl bg-[#f8faf9] focus:outline-none focus:border-[#157354]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-[#0b3828] mb-1 uppercase tracking-wider">Card Number (Sandbox)</label>
                <div className="relative">
                  <input 
                    type="text" 
                    disabled={isProcessingPayment} 
                    placeholder="4242 4242 4242 4242"
                    className="w-full pl-8 pr-3 py-2 border border-[#e6ece9] rounded-xl bg-[#f8faf9] focus:outline-none focus:border-[#157354]"
                  />
                  <CreditCard className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-[#0b3828] mb-1 uppercase tracking-wider">Expiration</label>
                  <input 
                    type="text" 
                    disabled={isProcessingPayment} 
                    placeholder="MM/YY"
                    className="w-full px-3 py-2 border border-[#e6ece9] rounded-xl bg-[#f8faf9] focus:outline-none focus:border-[#157354]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-[#0b3828] mb-1 uppercase tracking-wider">CVC</label>
                  <input 
                    type="password" 
                    disabled={isProcessingPayment} 
                    placeholder="•••"
                    className="w-full px-3 py-2 border border-[#e6ece9] rounded-xl bg-[#f8faf9] focus:outline-none focus:border-[#157354]"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handlePayBalance}
                  disabled={isProcessingPayment}
                  className="w-full bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-3 rounded-xl transition-all disabled:opacity-75 flex items-center justify-center gap-2 text-xs uppercase tracking-wider cursor-pointer"
                >
                  {isProcessingPayment ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing Sandbox...
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
