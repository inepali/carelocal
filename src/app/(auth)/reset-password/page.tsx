'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, Lock } from 'lucide-react'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(true)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // Supabase sends the token as a hash fragment which it auto-exchanges.
  // We just need to wait for the session to settle then allow the update.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setVerifying(false)
      }
    })

    // Also handle the case where the user lands and the session is already set
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setVerifying(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Check for error in URL (e.g. expired link)
  useEffect(() => {
    const errorCode = searchParams.get('error_code')
    const errorDesc = searchParams.get('error_description')
    if (errorCode) {
      setError(errorDesc?.replace(/\+/g, ' ') || 'This reset link is invalid or has expired.')
      setVerifying(false)
    }
  }, [searchParams])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
    } else {
      setDone(true)
      setTimeout(() => router.push('/login'), 3000)
    }
    setLoading(false)
  }

  const strength = password.length === 0 ? 0
    : password.length < 6 ? 1
    : password.length < 10 ? 2
    : /[A-Z]/.test(password) && /[0-9]/.test(password) ? 4
    : 3

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong']
  const strengthColor = ['', 'bg-red-400', 'bg-amber-400', 'bg-blue-400', 'bg-[#157354]']

  return (
    <div className="min-h-screen bg-[#f8faf9] flex">
      {/* ── Left: Form ── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 mb-10">
            <div className="w-8 h-8 rounded-lg bg-[#157354] flex items-center justify-center">
              <span className="text-white font-bold text-sm">CL</span>
            </div>
            <span className="font-bold text-[#0f4a36] text-lg">CareLocal</span>
          </Link>

          {verifying && !error ? (
            /* ── Verifying token ── */
            <div className="flex flex-col items-center py-16 animate-in fade-in duration-500">
              <Loader2 className="w-10 h-10 text-[#157354] animate-spin mb-4" />
              <p className="text-[#6b7a73] font-medium">Verifying your reset link…</p>
            </div>
          ) : done ? (
            /* ── Success ── */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="w-16 h-16 bg-[#edf7f3] rounded-2xl flex items-center justify-center mb-6">
                <CheckCircle2 className="w-8 h-8 text-[#157354]" />
              </div>
              <h1 className="text-3xl font-extrabold text-[#0b3828] mb-3">Password updated!</h1>
              <p className="text-[#6b7a73] mb-8">
                Your password has been changed successfully. Redirecting you to sign in…
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 bg-[#157354] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#0f4a36] transition-colors shadow-sm"
              >
                Sign in now
              </Link>
            </div>
          ) : error && !password ? (
            /* ── Invalid/expired link ── */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-6">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <h1 className="text-3xl font-extrabold text-[#0b3828] mb-3">Link expired</h1>
              <p className="text-[#6b7a73] mb-6">{error}</p>
              <Link
                href="/forgot-password"
                className="inline-flex items-center gap-2 bg-[#157354] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#0f4a36] transition-colors shadow-sm"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            /* ── Set new password form ── */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="w-14 h-14 bg-[#edf7f3] rounded-2xl flex items-center justify-center mb-6">
                <Lock className="w-7 h-7 text-[#157354]" />
              </div>
              <h1 className="text-3xl font-extrabold text-[#0b3828] mb-2">Set new password</h1>
              <p className="text-[#6b7a73] mb-8">Choose a strong password for your account.</p>

              <form onSubmit={handleReset} className="space-y-5">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                    {error}
                  </div>
                )}

                {/* New password */}
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                    New password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
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

                  {/* Strength meter */}
                  {password.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                              i <= strength ? strengthColor[strength] : 'bg-[#e2e8e4]'
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-[#6b7a73]">
                        Strength: <span className="font-semibold">{strengthLabel[strength]}</span>
                      </p>
                    </div>
                  )}
                </div>

                {/* Confirm password */}
                <div>
                  <label htmlFor="confirm" className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                    Confirm new password
                  </label>
                  <div className="relative">
                    <input
                      id="confirm"
                      type={showConfirm ? 'text' : 'password'}
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      className={`w-full px-4 py-3 pr-12 rounded-xl border bg-white focus:outline-none focus:ring-2 transition text-[#1a2e25] ${
                        confirm && confirm !== password
                          ? 'border-red-300 focus:ring-red-200 focus:border-red-400'
                          : 'border-[#e2e8e4] focus:ring-[#157354]/30 focus:border-[#157354]'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7a73] hover:text-[#157354] transition-colors"
                    >
                      {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {confirm && confirm !== password && (
                    <p className="text-xs text-red-500 mt-1">Passwords don't match</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !password || !confirm}
                  className="w-full flex items-center justify-center gap-2 bg-[#157354] text-white font-semibold py-3 rounded-xl hover:bg-[#0f4a36] transition-colors disabled:opacity-60 shadow-sm"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Update password'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Brand panel ── */}
      <div className="hidden lg:flex w-[480px] bg-[#0b3828] flex-col justify-between p-12">
        <div />
        <div>
          <div className="text-5xl mb-6">🔐</div>
          <h2 className="text-3xl font-extrabold text-white mb-4 leading-snug">
            Create a strong password.
          </h2>
          <p className="text-[#74c3a8] leading-relaxed">
            Use at least 8 characters, mix uppercase letters and numbers for the best protection.
          </p>
          <div className="mt-10 space-y-4">
            {[
              'At least 8 characters',
              'Mix of uppercase and numbers',
              'Never shared with third parties',
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#f8faf9] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#157354]" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}
