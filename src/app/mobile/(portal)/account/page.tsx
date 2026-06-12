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
  Info,
  Download,
  Share,
  Bell,
  BellOff
} from 'lucide-react'
import { SupabaseClient } from '@supabase/supabase-js'

async function subscribeUserToPush(user: { id: string }, supabase: SupabaseClient) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false
  }

  try {
    const reg = await navigator.serviceWorker.ready
    
    // Check if subscription already exists
    let subscription = await reg.pushManager.getSubscription()
    
    // Request permission if default
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        console.log('Notification permission not granted.')
        return false
      }
    }

    if (Notification.permission !== 'granted') return false

    // If subscription doesn't exist, create it
    if (!subscription) {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!publicKey) {
        console.error('VAPID public key not found in environment.')
        return false
      }

      // Convert VAPID public key to Uint8Array
      const padding = '='.repeat((4 - (publicKey.length % 4)) % 4)
      const base64 = (publicKey + padding).replace(/\-/g, '+').replace(/_/g, '/')
      const rawData = window.atob(base64)
      const outputArray = new Uint8Array(rawData.length)
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i)
      }

      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: outputArray,
      })
    }

    const subscriptionJson = subscription.toJSON()
    if (!subscriptionJson.endpoint || !subscriptionJson.keys?.p256dh || !subscriptionJson.keys?.auth) {
      console.error('Invalid push subscription structure.')
      return false
    }

    // Upsert subscription
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: user.id,
        endpoint: subscriptionJson.endpoint,
        p256dh: subscriptionJson.keys.p256dh,
        auth: subscriptionJson.keys.auth,
      }, { onConflict: 'endpoint' })

    if (error) {
      console.error('Failed to save push subscription:', error)
      return false
    } else {
      console.log('Push subscription successfully stored in DB.')
      return true
    }
  } catch (err) {
    console.error('Error during Web Push registration:', err)
    return false
  }
}

interface StaffProfile {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  balance_due: number | null
  staff_type: string
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
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

  // PWA Install State
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstallable, setIsInstallable] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  // Push notification states
  const [pushStatus, setPushStatus] = useState<'granted' | 'default' | 'denied' | 'unsupported'>('default')
  const [isSubscribing, setIsSubscribing] = useState(false)

  useEffect(() => {
    // Check if running as standalone
    if (typeof window !== 'undefined') {
      const standalone = window.matchMedia('(display-mode: standalone)').matches || 
                         ('standalone' in window.navigator && (window.navigator as unknown as { standalone: boolean }).standalone === true)
      setIsStandalone(standalone)

      // Detect iOS
      const userAgent = window.navigator.userAgent.toLowerCase()
      const ios = /iphone|ipad|ipod/.test(userAgent)
      setIsIOS(ios)

      // Check push support and permissions
      if (!('PushManager' in window) || !('serviceWorker' in navigator)) {
        setPushStatus('unsupported')
      } else {
        setPushStatus(Notification.permission)
      }

      const handleBeforeInstallPrompt = (e: Event) => {
        e.preventDefault()
        setDeferredPrompt(e as BeforeInstallPromptEvent)
        setIsInstallable(true)
      }

      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      }
    }
  }, [])

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      console.log(`User response to install: ${outcome}`)
      setDeferredPrompt(null)
      setIsInstallable(false)
    }
  }

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

  const handleTogglePush = async () => {
    setIsSubscribing(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const success = await subscribeUserToPush(user, supabase)
      if (success) {
        setPushStatus('granted')
      } else {
        setPushStatus(Notification.permission)
      }
    }
    setIsSubscribing(false)
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

      {/* Push Notification Preferences Box */}
      <div className="bg-white rounded-2xl border border-[#e6ece9] p-5 shadow-sm space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-xs font-black text-[#0b3828] uppercase tracking-wider">Push Notifications</h3>
            <p className="text-[10px] text-[#6b7a73] font-semibold uppercase tracking-wider mt-0.5">Status & Preferences</p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-[#edf7f3] flex items-center justify-center">
            {pushStatus === 'granted' ? (
              <Bell className="w-4 h-4 text-[#157354]" />
            ) : (
              <BellOff className="w-4 h-4 text-slate-400" />
            )}
          </div>
        </div>

        <div className="text-xs text-[#3d5a4f] leading-relaxed">
          {pushStatus === 'granted' ? (
            <div className="p-3.5 bg-[#edf7f3] border border-[#d4ede4] rounded-xl flex gap-2.5 text-[#157354]">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong className="text-[#0b3828] font-bold block mb-0.5">Notifications Enabled</strong>
                You are registered to receive real-time push alerts on this device when new shifts are posted.
              </div>
            </div>
          ) : pushStatus === 'denied' ? (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex gap-2.5 text-red-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong className="text-red-950 font-bold block mb-0.5">Notifications Blocked</strong>
                Permissions are blocked. Please enable notifications for Safari/Chrome in your iOS/Android system settings to get shift updates.
              </div>
            </div>
          ) : pushStatus === 'unsupported' ? (
            <p className="text-slate-500">
              Push notifications are not supported on this browser or device. On iOS, you must first add CareLocal to your home screen (install PWA) to enable push alerts.
            </p>
          ) : (
            <div className="space-y-3">
              <p>
                Enable push notifications to receive real-time updates when center admins post new available shifts.
              </p>
              <button
                disabled={isSubscribing}
                onClick={handleTogglePush}
                className="w-full bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-3 px-4 rounded-xl shadow-sm text-xs uppercase tracking-wider transition-all cursor-pointer text-center flex items-center justify-center gap-1.5"
              >
                {isSubscribing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Bell className="w-4 h-4" />
                )}
                Enable Push Alerts
              </button>
            </div>
          )}
        </div>
      </div>

      {/* PWA Download & Install Box */}
      {!isStandalone && (
        <div className="bg-white rounded-2xl border border-[#e6ece9] p-5 shadow-sm space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-xs font-black text-[#0b3828] uppercase tracking-wider">Install App</h3>
              <p className="text-[10px] text-[#6b7a73] font-semibold uppercase tracking-wider mt-0.5">Offline Access & Alerts</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-[#edf7f3] flex items-center justify-center">
              <Download className="w-4 h-4 text-[#157354]" />
            </div>
          </div>

          <div className="text-xs text-[#3d5a4f] leading-relaxed">
            {isInstallable ? (
              <p>
                Add CareLocal to your mobile home screen to get instant notifications and access open shifts instantly.
              </p>
            ) : isIOS ? (
              <div className="space-y-2">
                <p>
                  To install CareLocal on your iPhone/iPad:
                </p>
                <ol className="list-decimal pl-4 space-y-1 text-slate-500">
                  <li>Tap the <strong>Share</strong> button <Share className="w-3 h-3 inline align-middle mx-1 text-[#157354]" /> in Safari.</li>
                  <li>Scroll down and select <strong>Add to Home Screen</strong>.</li>
                </ol>
              </div>
            ) : (
              <p>
                To install CareLocal as a mobile app, open this page in Chrome or Safari on your phone, then click &quot;Add to Home screen&quot; or use the browser menu.
              </p>
            )}
          </div>

          {isInstallable && (
            <button
              onClick={handleInstallApp}
              className="w-full bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-3 px-4 rounded-xl shadow-sm text-xs uppercase tracking-wider transition-all cursor-pointer text-center"
            >
              Install CareLocal App
            </button>
          )}
        </div>
      )}

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
