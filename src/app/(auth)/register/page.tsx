'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, ArrowRight, Loader2, Building2, User } from 'lucide-react'

export default function RegisterPage() {
  const router = useRouter()
  // useSearchParams is used here
  const searchParams = useSearchParams()
  const inviteSlug = searchParams.get('invite')
  const isStaffInvite = !!inviteSlug

  const supabase = createClient()
  
  const [step, setStep] = isStaffInvite ? useState(2) : useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  
  // Center details
  const [centerName, setCenterName] = useState('')
  const [directorName, setDirectorName] = useState('')
  const [phone, setPhone] = useState('')

  // Staff profile details
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    // 1. Create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    if (!authData.user) {
      setError('Check your email for a confirmation link.')
      setLoading(false)
      return
    }

    if (isStaffInvite) {
      // ── STAFF REGISTRATION ──
      const { error: profileError } = await supabase
        .from('staff_profiles')
        .insert({
          user_id: authData.user.id,
          first_name: firstName,
          last_name: lastName,
          email,
          staff_type: 'floater', // Default
          is_active: true
        })

      if (profileError) {
        setError('Failed to create staff profile.')
        setLoading(false)
        return
      }

      // Link to center pool
      const { linkStaffToCenter } = await import('@/lib/api/invites')
      const { error: linkError } = await linkStaffToCenter(authData.user.id, inviteSlug!)
      
      if (linkError) {
        setError(linkError)
        setLoading(false)
        return
      }

      router.push('/staff/shifts')

    } else {
      // ── CENTER REGISTRATION ──
      const slug = centerName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.floor(Math.random() * 1000)
      
      const { data: centerData, error: centerError } = await supabase
        .from('centers')
        .insert({
          name: centerName,
          slug,
          email,
          phone,
          director_name: directorName,
        })
        .select('id')
        .single()

      if (centerError || !centerData) {
        setError('Failed to create center profile.')
        setLoading(false)
        return
      }

      const { error: adminError } = await supabase
        .from('center_admins')
        .insert({
          center_id: centerData.id,
          user_id: authData.user.id,
          role: 'owner',
        })

      if (adminError) {
        setError('Failed to set up admin rights.')
        setLoading(false)
        return
      }

      await supabase.from('subscriptions').insert({
        center_id: centerData.id,
        tier: 'starter',
        status: 'trialing',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      })

      router.push('/center/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-[#f8faf9] flex flex-col md:flex-row">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
           <Link href="/" className="flex items-center gap-2 mb-10">
            <div className="w-8 h-8 rounded-lg bg-[#157354] flex items-center justify-center">
              <span className="text-white font-bold text-sm">CL</span>
            </div>
            <span className="font-bold text-[#0f4a36] text-lg">CareLocal</span>
          </Link>

          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-2">
            {isStaffInvite ? 'Join your center pool' : 'Create your account'}
          </h1>
          <p className="text-[#6b7a73] mb-8">
            {isStaffInvite 
              ? 'Complete your profile to start claiming shifts. Staff accounts are always free.' 
              : 'Start your 60-day free trial. No credit card required.'}
          </p>

          <form onSubmit={step === 1 ? (e) => { e.preventDefault(); setStep(2) } : handleRegister} className="space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <label htmlFor="centerName" className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                    Center Name
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Building2 className="h-5 w-5 text-[#a8b5ae]" />
                    </div>
                    <input
                      id="centerName"
                      type="text"
                      required
                      value={centerName}
                      onChange={(e) => setCenterName(e.target.value)}
                      placeholder="Sunshine Early Learning"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="directorName" className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                    Your Name (Director/Admin)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User className="h-5 w-5 text-[#a8b5ae]" />
                    </div>
                    <input
                      id="directorName"
                      type="text"
                      required
                      value={directorName}
                      onChange={(e) => setDirectorName(e.target.value)}
                      placeholder="Jane Doe"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 bg-[#157354] text-white font-semibold py-3 rounded-xl hover:bg-[#0f4a36] transition-colors shadow-sm"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-8 duration-500">
                {isStaffInvite && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="firstName" className="block text-sm font-medium text-[#1a2e25] mb-1.5">First Name</label>
                      <input 
                        id="firstName" type="text" required value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="Jane"
                        className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                      />
                    </div>
                    <div>
                      <label htmlFor="lastName" className="block text-sm font-medium text-[#1a2e25] mb-1.5">Last Name</label>
                      <input 
                        id="lastName" type="text" required value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Doe"
                        className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                      />
                    </div>
                  </div>
                )}
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="director@sunshine.org"
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                  />
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                    Phone Number
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(704) 555-0123"
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                    Create Password
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
                  <p className="text-xs text-[#6b7a73] mt-2">Must be at least 8 characters.</p>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="px-4 py-3 rounded-xl border border-[#e2e8e4] text-[#6b7a73] font-medium hover:bg-white transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 bg-[#157354] text-white font-semibold py-3 rounded-xl hover:bg-[#0f4a36] transition-colors disabled:opacity-60 shadow-sm"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create Account'}
                  </button>
                </div>
              </div>
            )}
          </form>

          <p className="text-center text-sm text-[#6b7a73] mt-8">
            Already have an account?{' '}
            <Link href="/login" className="text-[#157354] font-semibold hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
      
      <div className="hidden lg:block flex-1 bg-[#d4ede4] relative overflow-hidden">
         {/* Decorative elements or images could go here */}
         <div className="absolute inset-0 flex items-center justify-center p-12">
            <div className="bg-white/60 backdrop-blur-md border border-white/40 p-8 rounded-3xl shadow-xl max-w-md text-center">
                <div className="w-16 h-16 bg-[#157354] rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                    <ShieldCheck className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-[#0b3828] mb-3">You own your compliance.</h3>
                <p className="text-[#3d5a4f] leading-relaxed mb-6">
                    CareLocal gives you the tools to collect, review, and organize staff documents in one secure place.
                    Set your own requirements and manage your pool with confidence.
                </p>
            </div>
         </div>
      </div>
    </div>
  )
}

function ShieldCheck(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}
