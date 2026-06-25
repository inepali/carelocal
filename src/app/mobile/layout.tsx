'use client'

import { useEffect, useState, createContext, useContext } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'
import { X, Smartphone, Share, CheckCircle, Bell, AlertCircle } from 'lucide-react'
import { SupabaseClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

async function subscribeUserToPush(user: { id: string }, supabase: SupabaseClient) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return
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
        return
      }
    }

    if (Notification.permission !== 'granted') return

    // If subscription doesn't exist, create it
    if (!subscription) {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!publicKey) {
        console.error('VAPID public key not found in environment.')
        return
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
      return
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
    } else {
      console.log('Push subscription successfully stored in DB.')
    }
  } catch (err) {
    console.error('Error during Web Push registration:', err)
  }
}

async function registerNativePush(user: { id: string }, supabase: SupabaseClient, showToast: any, router: any) {
  if (!Capacitor.isNativePlatform()) return

  try {
    let permStatus = await PushNotifications.checkPermissions()
    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions()
    }

    if (permStatus.receive !== 'granted') {
      console.log('Native push permission not granted.')
      return
    }

    await PushNotifications.register()
    await PushNotifications.removeAllListeners()

    await PushNotifications.addListener('registration', async (token) => {
      console.log('Native Push Registration Token:', token.value)
      const platform = Capacitor.getPlatform()
      
      const { error } = await supabase
        .from('native_push_tokens')
        .upsert({
          user_id: user.id,
          token: token.value,
          platform: platform === 'ios' ? 'ios' : 'android'
        }, { onConflict: 'token' })

      if (error) {
        console.error('Failed to store native push token:', error)
      } else {
        console.log('Native push token stored in Supabase successfully.')
      }
    })

    await PushNotifications.addListener('registrationError', (err) => {
      console.error('Native Push Registration Error:', err)
    })

    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('Native push received in foreground:', notification)
      const title = notification.title || 'CareLocal Alert'
      const body = notification.body || 'New update from CareLocal.'
      showToast(title, body, 'info')
    })

    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('Native push action performed:', action)
      const url = action.notification.data?.url || '/mobile/shifts'
      router.push(url)
    })

  } catch (err) {
    console.error('Error setting up Native Push Notifications:', err)
  }
}

export interface ToastMessage {
  id: string
  title: string
  body: string
  type?: 'success' | 'info' | 'warning' | 'error'
}

interface ToastContextType {
  showToast: (title: string, body: string, type?: 'success' | 'info' | 'warning' | 'error') => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  
  const [loading, setLoading] = useState(true)
  
  // PWA smart banner and prompt state
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstallable, setIsInstallable] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [showBanner, setShowBanner] = useState(false)
  const [showInfoModal, setShowInfoModal] = useState(false)
  const [showPushPrompt, setShowPushPrompt] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const showToast = (title: string, body: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts((prev) => [...prev, { id, title, body, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4000)
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      const handleServiceWorkerMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'PUSH_RECEIVED') {
          showToast(event.data.title, event.data.body, 'info')
        }
      }
      navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage)
      return () => {
        navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage)
      }
    }
  }, [])

  useEffect(() => {
    // Check if running as standalone PWA
    if (typeof window !== 'undefined') {
      const standalone = window.matchMedia('(display-mode: standalone)').matches || 
                         ('standalone' in window.navigator && (window.navigator as unknown as { standalone: boolean }).standalone === true)

      // Detect iOS platform
      const userAgent = window.navigator.userAgent.toLowerCase()
      const ios = /iphone|ipad|ipod/.test(userAgent)

      // Check if previously dismissed
      const dismissed = localStorage.getItem('carelocal_pwa_banner_dismissed')

      // Defer state updates to avoid synchronous setState inside useEffect warning
      setTimeout(() => {
        setIsIOS(ios)
        if (!standalone && !dismissed) {
          setShowBanner(true)
        }
      }, 0)

      const handleBeforeInstallPrompt = (e: Event) => {
        e.preventDefault()
        setTimeout(() => {
          setDeferredPrompt(e as BeforeInstallPromptEvent)
          setIsInstallable(true)
        }, 0)
      }

      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      }
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      const isLoginRoute = pathname === '/mobile/login'

      if (!user) {
        if (!isLoginRoute) {
          router.replace('/mobile/login')
        }
      } else {
        if (isLoginRoute) {
          router.replace('/mobile/shifts')
        }
        
        // Register Native Push if running in native app, otherwise standard web push
        if (Capacitor.isNativePlatform()) {
          await registerNativePush(user, supabase, showToast, router)
        } else {
          // Auto subscribe if already granted
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            await subscribeUserToPush(user, supabase)
          } else if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            // Check if push is supported by this browser
            if ('PushManager' in window && 'serviceWorker' in navigator) {
              const dismissed = localStorage.getItem('carelocal_push_prompt_dismissed')
              if (!dismissed) {
                setShowPushPrompt(true)
              }
            }
          }
        }
      }
      setLoading(false)
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => console.log('Service Worker registered scope:', reg.scope))
        .catch((err) => console.error('Service Worker registration error:', err))
    }

    checkAuth()
  }, [pathname, router])

  const handleDismissBanner = () => {
    localStorage.setItem('carelocal_pwa_banner_dismissed', 'true')
    setShowBanner(false)
  }

  const handleLaunchOrInstall = () => {
    setShowInfoModal(true)
  }

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      console.log(`User response to install: ${outcome}`)
      setDeferredPrompt(null)
      setIsInstallable(false)
      setShowInfoModal(false)
      setShowBanner(false)
    }
  }

  const handleEnablePush = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await subscribeUserToPush(user, supabase)
    }
    setShowPushPrompt(false)
  }

  const handleDismissPushPrompt = () => {
    localStorage.setItem('carelocal_push_prompt_dismissed', 'true')
    setShowPushPrompt(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f8faf9]">
        <div className="w-8 h-8 rounded-full border-4 border-[#157354]/30 border-t-[#157354] animate-spin" />
      </div>
    )
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      <div className="flex justify-center min-h-screen bg-[#f1f5f3]">
        <div className="w-full max-w-md bg-[#f8faf9] min-h-screen flex flex-col relative shadow-2xl border-x border-slate-100 pb-safe">
          {/* Toast Container */}
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4 space-y-2 pointer-events-none">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={`pointer-events-auto p-4 rounded-2xl shadow-xl border flex items-start gap-3 transition-all duration-300 transform translate-y-0 scale-100 animate-in slide-in-from-top-4 duration-300 ${
                  toast.type === 'success' ? 'bg-[#edf7f3] border-[#d4ede4] text-[#157354]' :
                  toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
                  toast.type === 'warning' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' :
                  'bg-slate-900 border-slate-800 text-white'
                }`}
              >
                {toast.type === 'success' ? (
                  <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
                ) : toast.type === 'error' || toast.type === 'warning' ? (
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                ) : (
                  <Bell className="w-5 h-5 shrink-0 mt-0.5" />
                )}
                <div className="flex-grow min-w-0 text-left">
                  <p className="text-xs font-black leading-tight font-sans">{toast.title}</p>
                  <p className="text-[10px] opacity-90 mt-0.5 font-medium leading-relaxed">{toast.body}</p>
                </div>
                <button
                  onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                  className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {showBanner && (
          <div className="bg-gradient-to-r from-[#0b3828] to-[#157354] text-white p-3 px-4 flex items-center justify-between shadow-md relative z-50 animate-in slide-in-from-top-4 duration-300">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                <span className="text-white font-black text-xs">CL</span>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-black leading-tight">CareLocal Mobile App</p>
                <p className="text-[9px] text-[#edf7f3] font-medium truncate">Offline scheduling & push notifications</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button 
                onClick={handleLaunchOrInstall}
                className="bg-white text-[#0b3828] font-bold text-[9px] uppercase tracking-wider px-3 py-1.5 rounded-lg active:scale-95 transition-all cursor-pointer"
              >
                Open / Install
              </button>
              <button 
                onClick={handleDismissBanner}
                className="p-1 text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        
        {showPushPrompt && (
          <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white p-3 px-4 flex items-center justify-between shadow-md relative z-50 animate-in slide-in-from-top-4 duration-300">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                <Bell className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0 text-left">
                <p className="text-[11px] font-black leading-tight font-sans">Enable Push Alerts</p>
                <p className="text-[9px] text-[#fef3c7] font-medium truncate">Get notified instantly about new open shifts</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button 
                onClick={handleEnablePush}
                className="bg-white text-amber-700 font-bold text-[9px] uppercase tracking-wider px-3 py-1.5 rounded-lg active:scale-95 transition-all cursor-pointer"
              >
                Enable
              </button>
              <button 
                onClick={handleDismissPushPrompt}
                className="p-1 text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        
        <div className="flex-grow flex flex-col relative">
          {children}
        </div>

        {/* PWA App info launch drawer/modal */}
        {showInfoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-white rounded-3xl border border-[#e6ece9] max-w-sm w-full p-5 shadow-2xl relative text-left">
              <button 
                onClick={() => setShowInfoModal(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-[#edf7f3] flex items-center justify-center">
                  <Smartphone className="w-4 h-4 text-[#157354]" />
                </div>
                <h3 className="text-base font-black text-[#0b3828]">Launch PWA App</h3>
              </div>
              
              <div className="text-xs text-[#3d5a4f] space-y-3 leading-relaxed mb-6">
                <p>
                  To open CareLocal in full-screen app mode, please select the option below or open it from your device home screen:
                </p>
                {isInstallable ? (
                  <div className="p-3 bg-[#edf7f3] border border-[#d4ede4] rounded-xl flex gap-2">
                    <CheckCircle className="w-4 h-4 text-[#157354] shrink-0 mt-0.5" />
                    <p className="text-[11px] text-emerald-800">
                      Your browser supports direct installation. Tap <strong>Install App</strong> below to add it to your home screen now.
                    </p>
                  </div>
                ) : isIOS ? (
                  <div className="p-3 bg-yellow-50/70 border border-yellow-200 rounded-xl space-y-1.5">
                    <p className="font-bold text-yellow-900 flex items-center gap-1">
                      <Share className="w-3.5 h-3.5 text-yellow-800" /> iPhone/iPad Safari Link
                    </p>
                    <p className="text-[11px] text-yellow-800">
                      Tap the <strong>Share</strong> button in Safari and choose <strong>Add to Home Screen</strong>.
                    </p>
                  </div>
                ) : (
                  <p>
                    Once installed, CareLocal operates as a standalone mobile app with offline recovery and push alerts support.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {isInstallable && (
                  <button
                    onClick={handleInstallApp}
                    className="w-full bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider cursor-pointer"
                  >
                    Install App
                  </button>
                )}
                <button
                  onClick={() => setShowInfoModal(false)}
                  className="w-full bg-slate-100 hover:bg-slate-200 text-[#6b7a73] font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider cursor-pointer text-center"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  </ToastContext.Provider>
  )
}
