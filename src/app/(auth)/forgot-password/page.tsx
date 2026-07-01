'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Mail, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react'
import { getDomainConfig } from '@/lib/domain-config'

export default function ForgotPasswordPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  // Resolve domain vertical configuration dynamically
  const [domainKey, setDomainKey] = useState<'childcare' | 'healthcare'>('childcare')
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const host = window.location.host
      if (host.includes('carelocal.net') || host.includes('carelocalhealth.com') || host.includes('3001')) {
        setDomainKey('healthcare')
      }
    }
  }, [])

  const config = getDomainConfig(domainKey)
  const isHealthcare = domainKey === 'healthcare'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const redirectTo =
      `${process.env.NEXT_PUBLIC_APP_URL || (isHealthcare ? 'http://localhost:3001' : 'http://localhost:3000')}/reset-password`

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    })

    if (resetError) {
      setError(resetError.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

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

          {sent ? (
            /* ── Success State ── */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mb-6">
                <CheckCircle2 className="w-8 h-8 text-brand-600" />
              </div>
              <h1 className="text-3xl font-extrabold text-brand-900 mb-3">Check your inbox</h1>
              <p className="text-brand-700 mb-2">
                We sent a password reset link to <span className="font-semibold text-brand-900">{email}</span>.
              </p>
              <p className="text-brand-700 text-sm mb-8">
                The link expires in 1 hour. Check your spam folder if you don't see it.
              </p>
              <Link
                href="/login"
                className="flex items-center gap-2 text-brand-600 font-semibold hover:underline text-sm"
              >
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </Link>
            </div>
          ) : (
            /* ── Form State ── */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-600 transition-colors mb-8"
              >
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </Link>

              <h1 className="text-3xl font-extrabold text-brand-900 mb-2">Forgot your password?</h1>
              <p className="text-brand-700 mb-8">
                No worries — enter your email and we'll send you a reset link.
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                    {error}
                  </div>
                )}

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-brand-900 mb-1.5">
                    Email address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={config.onboarding.emailPlaceholder}
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-brand-100 bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition text-brand-900 placeholder:text-slate-400"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold py-3 rounded-xl hover:bg-brand-800 transition-colors disabled:opacity-60 shadow-sm"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send reset link'}
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
            Your account is secure.
          </h2>
          <p className="text-brand-300 leading-relaxed">
            We'll send a one-time link to reset your password. It expires in 60 minutes and can only be used once.
          </p>
          <div className="mt-10 space-y-4">
            {[
              'Reset link sent to your email',
              'Link expires after 60 minutes',
              'Secure, encrypted password storage',
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
        <p className="text-brand-400 text-sm">© {new Date().getFullYear()} {config.appName} · {isHealthcare ? 'carelocal.net' : 'carelocal.co'}</p>
      </div>
    </div>
  )
}
