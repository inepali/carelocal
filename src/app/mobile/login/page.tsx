'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Loader2, Lock, Mail } from 'lucide-react'

export default function MobileLoginPage() {
  const supabase = createClient()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
    } else {
      router.replace('/mobile/shifts')
    }
  }

  return (
    <div className="flex-1 flex flex-col justify-center px-8 py-12">
      {/* Brand logo & title */}
      <div className="text-center mb-10">
        <div className="w-14 h-14 rounded-2xl bg-[#157354] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#157354]/20 animate-pulse">
          <span className="text-white font-black text-xl">CL</span>
        </div>
        <h1 className="text-3xl font-black text-[#0b3828] tracking-tight">CareLocal</h1>
        <p className="text-[#6b7a73] text-sm mt-1.5 font-medium">Mobile Educator Portal</p>
      </div>

      <div className="bg-white border border-[#e2e8e4] rounded-3xl p-6 shadow-sm">
        <form onSubmit={handleLogin} className="space-y-5">
          {error && (
            <div className="bg-red-50 text-red-700 text-xs p-3.5 rounded-2xl border border-red-200 leading-relaxed font-semibold">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#0b3828] mb-1.5 uppercase tracking-wider">Email Address</label>
            <div className="relative">
              <input 
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="w-full pl-10 pr-4 py-3 rounded-2xl border border-[#e2e8e4] text-[#1a2e25] placeholder:text-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-sm font-medium"
              />
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#0b3828] mb-1.5 uppercase tracking-wider">Password</label>
            <div className="relative">
              <input 
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 rounded-2xl border border-[#e2e8e4] text-[#1a2e25] placeholder:text-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-sm font-medium"
              />
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-3.5 px-4 rounded-2xl transition-all shadow-md active:translate-y-px text-sm disabled:opacity-75 flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Authenticating...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </div>
        </form>
      </div>

      <div className="text-center mt-8 text-xs text-[#6b7a73] font-medium leading-relaxed">
        Don&apos;t have an educator account?<br />
        Contact your childcare center administrator to get an invite link.
      </div>
    </div>
  )
}
