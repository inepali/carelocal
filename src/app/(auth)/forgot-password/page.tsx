'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Mail, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react'

export default function ForgotPasswordPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const redirectTo =
      `${process.env.NEXT_PUBLIC_APP_URL || 'https://carelocal.vercel.app'}/reset-password`

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

          {sent ? (
            /* ── Success State ── */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="w-16 h-16 bg-[#edf7f3] rounded-2xl flex items-center justify-center mb-6">
                <CheckCircle2 className="w-8 h-8 text-[#157354]" />
              </div>
              <h1 className="text-3xl font-extrabold text-[#0b3828] mb-3">Check your inbox</h1>
              <p className="text-[#6b7a73] mb-2">
                We sent a password reset link to <span className="font-semibold text-[#1a2e25]">{email}</span>.
              </p>
              <p className="text-[#6b7a73] text-sm mb-8">
                The link expires in 1 hour. Check your spam folder if you don't see it.
              </p>
              <Link
                href="/login"
                className="flex items-center gap-2 text-[#157354] font-semibold hover:underline text-sm"
              >
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </Link>
            </div>
          ) : (
            /* ── Form State ── */
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-[#6b7a73] hover:text-[#157354] transition-colors mb-8"
              >
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </Link>

              <h1 className="text-3xl font-extrabold text-[#0b3828] mb-2">Forgot your password?</h1>
              <p className="text-[#6b7a73] mb-8">
                No worries — enter your email and we'll send you a reset link.
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                    {error}
                  </div>
                )}

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                    Email address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-[#a8b5ae]" />
                    </div>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@yourcenter.org"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25] placeholder:text-[#a8b5ae]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-[#157354] text-white font-semibold py-3 rounded-xl hover:bg-[#0f4a36] transition-colors disabled:opacity-60 shadow-sm"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send reset link'}
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
            Your account is secure.
          </h2>
          <p className="text-[#74c3a8] leading-relaxed">
            We'll send a one-time link to reset your password. It expires in 60 minutes and can only be used once.
          </p>
          <div className="mt-10 space-y-4">
            {[
              'Reset link sent to your email',
              'Link expires after 60 minutes',
              'Secure, encrypted password storage',
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
