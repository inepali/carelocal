'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    // 1. Check if user is a Super Admin (via metadata)
    const isSuperAdmin = data.user?.app_metadata?.is_super_admin === true
    if (isSuperAdmin) {
      router.push('/admin/dashboard')
      return
    }

    // 2. Check if user is a center admin
    const { data: centerAdmin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', data.user.id)
      .single()

    if (centerAdmin) {
      router.push('/center/dashboard')
    } else {
      router.push('/staff/shifts')
    }
  }

  return (
    <div className="min-h-screen bg-[#f8faf9] flex">
      {/* ── Left: Form ── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <Link href="/" className="flex items-center gap-2 mb-10">
            <div className="w-8 h-8 rounded-lg bg-[#157354] flex items-center justify-center">
              <span className="text-white font-bold text-sm">CL</span>
            </div>
            <span className="font-bold text-[#0f4a36] text-lg">CareLocal</span>
          </Link>

          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-2">Welcome back</h1>
          <p className="text-[#6b7a73] mb-8">Sign in to your CareLocal account</p>

          <form onSubmit={handleLogin} className="space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourcenter.org"
                className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25] placeholder:text-[#a8b5ae]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-sm font-medium text-[#1a2e25]">
                  Password
                </label>
                <Link href="/forgot-password" className="text-xs text-[#157354] hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7a73] hover:text-[#157354] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              id="login-submit"
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-[#157354] text-white font-semibold py-3 rounded-xl hover:bg-[#0f4a36] transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>Sign in <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </form>

          <p className="text-center text-sm text-[#6b7a73] mt-8">
            Don't have an account?{' '}
            <Link href="/register" className="text-[#157354] font-semibold hover:underline">
              Get started free
            </Link>
          </p>
          <p className="text-center text-sm text-[#6b7a73] mt-2">
            Are you a staff member with an invite?{' '}
            <Link href="/staff/join" className="text-[#157354] font-semibold hover:underline">
              Join here →
            </Link>
          </p>
        </div>
      </div>

      {/* ── Right: Brand panel ── */}
      <div className="hidden lg:flex w-[480px] bg-[#0b3828] flex-col justify-between p-12">
        <div />
        <div>
          <div className="text-5xl mb-6">⚡</div>
          <h2 className="text-3xl font-extrabold text-white mb-4 leading-snug">
            Fill an open shift in under 4 hours.
          </h2>
          <p className="text-[#74c3a8] leading-relaxed">
            Post a shift, blast your staff pool by SMS, and get confirmation — all without picking up the phone.
          </p>
          <div className="mt-10 space-y-4">
            {[
              'Instant SMS blast to your entire staff pool',
              'Staff documents organized in one place',
              'Your center, your compliance decisions',
            ].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-[#157354] flex items-center justify-center shrink-0">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <span className="text-[#d4ede4] text-sm">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[#40a884] text-sm">© {new Date().getFullYear()} CareLocal · carelocal.io</p>
      </div>
    </div>
  )
}
