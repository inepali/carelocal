'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createLinkVerificationClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, Lock } from 'lucide-react'
import { getDomainConfig, getDomainKey, type DomainKey } from '@/lib/domain-config'

function ResetPasswordForm() {
  const router = useRouter()
  // detectSessionInUrl is off: this page exchanges the link's token itself (see verify below)
  const [supabase] = useState(() => createLinkVerificationClient())

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(true)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // Resolve domain vertical configuration dynamically
  const [domainKey, setDomainKey] = useState<DomainKey>('childcare')
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDomainKey(getDomainKey(window.location.host))
    }
  }, [])

  const config = getDomainConfig(domainKey)
  const isHealthcare = domainKey === 'healthcare'
  const domainLabel = domainKey === 'healthcare' ? 'carelocal.net' : domainKey === 'senior' ? 'carelocalsenior.com' : 'carelocal.co'

  // Verify the reset link ourselves instead of waiting for the client to do it silently.
  // Links arrive in one of three shapes: ?code= (PKCE), ?token_hash= (email template), or a
  // #access_token hash (implicit). Anything else falls back to an existing session.
  // A link's token works once, so this must run exactly once (React dev mode runs effects twice).
  const verifyStarted = useRef(false)

  useEffect(() => {
    if (verifyStarted.current) return
    verifyStarted.current = true

    const EXPIRED = 'This reset link is invalid or has expired. Please request a new one.'
    const fail = (message: string, detail?: unknown) => {
      if (detail) console.error('[reset-password]', detail)
      setError(message)
      setVerifying(false)
    }

    // Never leave the visitor on an endless spinner
    const timeout = setTimeout(() => fail('Verifying your link is taking too long. Please request a new one.'), 15000)

    async function verify() {
      const query = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

      // Supabase reports a bad or already-used link in the query or in the hash fragment
      const linkError = query.get('error_code') || hash.get('error_code') || query.get('error') || hash.get('error')
      if (linkError) {
        const description = query.get('error_description') || hash.get('error_description')
        fail(description ? description.replace(/\+/g, ' ') : EXPIRED)
        return
      }

      const code = query.get('code')
      const tokenHash = query.get('token_hash')
      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            fail('This link has expired, was already used, or was opened in a different browser than the one you requested it from. Please request a new link and open it in the same browser.', exchangeError)
            return
          }
        } else if (tokenHash) {
          const { error: otpError } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
          if (otpError) { fail(EXPIRED, otpError); return }
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          if (sessionError) { fail(EXPIRED, sessionError); return }
        } else {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) { fail(EXPIRED); return }
        }
        // Remove the one-time token from the address bar
        window.history.replaceState(null, '', window.location.pathname)
        setVerifying(false)
      } catch (err) {
        fail('We could not verify this link. Please request a new one.', err)
      } finally {
        clearTimeout(timeout)
      }
    }

    verify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const strengthColor = ['', 'bg-red-400', 'bg-amber-400', 'bg-blue-400', 'bg-brand-600']

  return (
    <div className="min-h-screen bg-surface flex">
      {/* ── Left: Form ── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 mb-10">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">{config.logoShort}</span>
            </div>
            <span className="font-bold text-brand-800 text-lg">{config.appName}</span>
          </Link>

          {verifying && !error ? (
            /* ── Verifying token ── */
            <div className="flex flex-col items-center py-16 animate-in fade-in duration-500">
              <Loader2 className="w-10 h-10 text-brand-600 animate-spin mb-4" />
              <p className="text-brand-700 font-medium">Verifying your reset link…</p>
            </div>
          ) : done ? (
            /* ── Success ── */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mb-6">
                <CheckCircle2 className="w-8 h-8 text-brand-600" />
              </div>
              <h1 className="text-3xl font-extrabold text-brand-900 mb-3">Password updated!</h1>
              <p className="text-brand-700 mb-8">
                Your password has been changed successfully. Redirecting you to sign in…
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 bg-brand-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-brand-800 transition-colors shadow-sm"
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
              <h1 className="text-3xl font-extrabold text-brand-900 mb-3">Link expired</h1>
              <p className="text-brand-700 mb-6">{error}</p>
              <Link
                href="/forgot-password"
                className="inline-flex items-center gap-2 bg-brand-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-brand-800 transition-colors shadow-sm"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            /* ── Set new password form ── */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="w-14 h-14 bg-brand-50 rounded-2xl flex items-center justify-center mb-6">
                <Lock className="w-7 h-7 text-brand-600" />
              </div>
              <h1 className="text-3xl font-extrabold text-brand-900 mb-2">Set new password</h1>
              <p className="text-brand-700 mb-8">Choose a strong password for your account.</p>

              <form onSubmit={handleReset} className="space-y-5">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                    {error}
                  </div>
                )}

                {/* New password */}
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-brand-900 mb-1.5">
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
                      className="w-full px-4 py-3 pr-12 rounded-xl border border-brand-100 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition text-brand-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-700 hover:text-brand-600 transition-colors"
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
                              i <= strength ? strengthColor[strength] : 'bg-border'
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-brand-700">
                        Strength: <span className="font-semibold">{strengthLabel[strength]}</span>
                      </p>
                    </div>
                  )}
                </div>

                {/* Confirm password */}
                <div>
                  <label htmlFor="confirm" className="block text-sm font-medium text-brand-900 mb-1.5">
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
                      className={`w-full px-4 py-3 pr-12 rounded-xl border bg-white focus:outline-none focus:ring-2 transition text-brand-900 ${
                        confirm && confirm !== password
                          ? 'border-red-300 focus:ring-red-200 focus:border-red-400'
                          : 'border-brand-100 focus:ring-brand-600/30 focus:border-brand-600'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-700 hover:text-brand-600 transition-colors"
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
                  className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold py-3 rounded-xl hover:bg-brand-800 transition-colors disabled:opacity-60 shadow-sm"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Update password'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Brand panel ── */}
      <div className="hidden lg:flex w-[480px] bg-brand-900 flex-col justify-between p-12">
        <div />
        <div>
          <div className="text-5xl mb-6">🔐</div>
          <h2 className="text-3xl font-extrabold text-white mb-4 leading-snug">
            Create a strong password.
          </h2>
          <p className="text-brand-300 leading-relaxed">
            Use at least 8 characters, mix uppercase letters and numbers for the best protection.
          </p>
          <div className="mt-10 space-y-4">
            {[
              'At least 8 characters',
              'Mix of uppercase and numbers',
              'Never shared with third parties',
            ].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center shrink-0">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <span className="text-brand-100 text-sm">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-brand-400 text-sm">© {new Date().getFullYear()} {config.appName} · {domainLabel}</p>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}
