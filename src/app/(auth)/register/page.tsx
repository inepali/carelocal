'use client'

import { useState, Suspense, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, ArrowRight, Loader2, Building2, User } from 'lucide-react'
import { getDomainConfig } from '@/lib/domain-config'

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteSlug = searchParams.get('invite')
  const isStaffInvite = !!inviteSlug

  const supabase = createClient()
  
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

  // New State
  const [accountType, setAccountType] = useState<'center' | 'staff' | null>(isStaffInvite ? 'staff' : null)
  const [step, setStep] = useState(isStaffInvite ? 2 : 0) // Step 0 is selection
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
  const [city, setCity] = useState('')
  const [zip, setZip] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showTermsModal, setShowTermsModal] = useState(false)

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

    if (accountType === 'staff') {
      // ── STAFF REGISTRATION ──
      const { error: profileError } = await supabase
        .from('staff_profiles')
        .insert({
          user_id: authData.user.id,
          first_name: firstName,
          last_name: lastName,
          email,
          city,
          zip,
          staff_type: config.onboarding.defaultStaffRole, // Default based on active vertical config!
          is_active: true,
          domain_key: domainKey
        })

      if (profileError) {
        setError('Failed to create staff profile.')
        setLoading(false)
        return
      }

      // Link to center pool ONLY if an invite was used
      if (inviteSlug) {
        const { linkStaffToCenter } = await import('@/lib/api/invites')
        const { error: linkError } = await linkStaffToCenter(authData.user.id, inviteSlug!)
        
        if (linkError) {
          setError(linkError)
          setLoading(false)
          return
        }
      }

      router.push('/staff/shifts')

    } else {
      // ── CENTER REGISTRATION ──
      const centerId = crypto.randomUUID()
      const slug = centerName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.floor(Math.random() * 1000)
      
      const { error: centerError } = await supabase
        .from('centers')
        .insert({
          id: centerId,
          name: centerName,
          slug,
          email,
          phone,
          director_name: directorName,
          domain_key: domainKey,
          staff_term: domainKey === 'healthcare' ? 'Medical Staff' : 'Staff',
          work_area_term: domainKey === 'healthcare' ? 'Care Areas' : 'Classrooms'
        })

      if (centerError) {
        setError('Failed to create center profile.')
        setLoading(false)
        return
      }

      const { error: adminError } = await supabase
        .from('center_admins')
        .insert({
          center_id: centerId,
          user_id: authData.user.id,
          role: 'owner',
        })

      if (adminError) {
        setError('Failed to set up admin rights.')
        setLoading(false)
        return
      }

      await supabase.from('subscriptions').insert({
        center_id: centerId,
        tier: 'starter',
        status: 'trialing',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      })

      router.push('/center/dashboard')
    }
  }

  return (
    <>
    <div className="min-h-screen bg-[#f8faf9] flex flex-col md:flex-row">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
           <Link href="/" className="flex items-center gap-2 mb-10">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">{config.logoShort}</span>
            </div>
            <span className="font-bold text-brand-900 text-lg">{config.appName}</span>
          </Link>

          <h1 className="text-3xl font-extrabold text-brand-900 mb-2">
            {isStaffInvite ? 'Join your center pool' : config.onboarding.roleHeading}
          </h1>
          <p className="text-[#6b7a73] mb-8">
            {isStaffInvite 
              ? 'Complete your profile to start claiming shifts. Staff accounts are always free.' 
              : config.onboarding.roleSubtitle}
          </p>

          <form onSubmit={(e) => {
            e.preventDefault()
            if (step === 0) setStep(accountType === 'center' ? 1 : 2)
            else if (step === 1) setStep(2)
            else handleRegister(e)
          }} className="space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {step === 0 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <button
                  type="button"
                  onClick={() => setAccountType('center')}
                  className={`w-full p-6 rounded-2xl border-2 text-left transition-all ${
                    accountType === 'center' 
                      ? 'border-brand-600 bg-brand-50' 
                      : 'border-[#e2e8e4] bg-white hover:border-brand-600/50'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${accountType === 'center' ? 'bg-brand-600 text-white' : 'bg-[#f8faf9] text-[#6b7a73]'}`}>
                      <Building2 className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="font-bold text-[#1a2e25]">{config.onboarding.centerSelectorLabel}</div>
                      <div className="text-sm text-[#6b7a73]">{config.onboarding.centerSelectorDesc}</div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setAccountType('staff')}
                  className={`w-full p-6 rounded-2xl border-2 text-left transition-all ${
                    accountType === 'staff' 
                      ? 'border-brand-600 bg-brand-50' 
                      : 'border-[#e2e8e4] bg-white hover:border-brand-600/50'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${accountType === 'staff' ? 'bg-brand-600 text-white' : 'bg-[#f8faf9] text-[#6b7a73]'}`}>
                      <User className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="font-bold text-[#1a2e25]">{config.onboarding.staffSelectorLabel}</div>
                      <div className="text-sm text-[#6b7a73]">{config.onboarding.staffSelectorDesc}</div>
                    </div>
                  </div>
                </button>

                <button
                  type="submit"
                  disabled={!accountType}
                  className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold py-4 rounded-xl hover:bg-brand-800 transition-colors shadow-sm disabled:opacity-50"
                >
                  Next <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <label htmlFor="centerName" className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                    {config.onboarding.centerNameLabel}
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
                      placeholder={config.onboarding.centerNamePlaceholder}
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition text-[#1a2e25]"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="directorName" className="block text-sm font-medium text-[#1a2e25] mb-1.5">
                    {config.onboarding.directorNameLabel}
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
                      placeholder={config.onboarding.directorNamePlaceholder}
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition text-[#1a2e25]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold py-3 rounded-xl hover:bg-brand-800 transition-colors shadow-sm"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-8 duration-500">
                {accountType === 'staff' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="firstName" className="block text-sm font-medium text-[#1a2e25] mb-1.5">First Name</label>
                        <input 
                          id="firstName" type="text" required value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="Jane"
                          className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition text-[#1a2e25]"
                        />
                      </div>
                      <div>
                        <label htmlFor="lastName" className="block text-sm font-medium text-[#1a2e25] mb-1.5">Last Name</label>
                        <input 
                          id="lastName" type="text" required value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Doe"
                          className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition text-[#1a2e25]"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="city" className="block text-sm font-medium text-[#1a2e25] mb-1.5">City</label>
                        <input 
                          id="city" type="text" required value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="Charlotte"
                          className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition text-[#1a2e25]"
                        />
                      </div>
                      <div>
                        <label htmlFor="zip" className="block text-sm font-medium text-[#1a2e25] mb-1.5">Zip Code</label>
                        <input 
                          id="zip" type="text" required value={zip}
                          onChange={(e) => setZip(e.target.value)}
                          placeholder="28202"
                          className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition text-[#1a2e25]"
                        />
                      </div>
                    </div>
                  </>
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
                    placeholder={config.onboarding.emailPlaceholder}
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition text-[#1a2e25]"
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
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition text-[#1a2e25]"
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
                      className="w-full px-4 py-3 pr-12 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 transition text-[#1a2e25]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7a73] hover:text-brand-600 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="text-xs text-[#6b7a73] mt-2">Must be at least 8 characters.</p>
                </div>

                <div className="flex items-start gap-3 mt-4">
                  <div className="flex items-center h-5">
                    <input
                      id="terms"
                      type="checkbox"
                      required
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      className="w-4 h-4 border border-[#e2e8e4] rounded bg-white focus:ring-3 focus:ring-brand-600/30 accent-brand-600"
                    />
                  </div>
                  <label htmlFor="terms" className="text-sm font-medium text-[#6b7a73]">
                    I agree to the{' '}
                    <button
                      type="button"
                      onClick={() => setShowTermsModal(true)}
                      className="text-brand-600 hover:underline"
                    >
                      Terms & Conditions
                    </button>
                  </label>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (step === 2 && accountType === 'center') setStep(1)
                      else setStep(0)
                    }}
                    className="px-4 py-3 rounded-xl border border-[#e2e8e4] text-[#6b7a73] font-medium hover:bg-white transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold py-3 rounded-xl hover:bg-brand-800 transition-colors disabled:opacity-60 shadow-sm"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create Account'}
                  </button>
                </div>
              </div>
            )}
          </form>

          <p className="text-center text-sm text-[#6b7a73] mt-8">
            Already have an account?{' '}
            <Link href="/login" className="text-brand-600 font-semibold hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
      
      <div className="hidden lg:block flex-1 bg-brand-100 relative overflow-hidden">
         {/* Decorative elements or images could go here */}
         <div className="absolute inset-0 flex items-center justify-center p-12">
            <div className="bg-white/60 backdrop-blur-md border border-white/40 p-8 rounded-3xl shadow-xl max-w-md text-center">
                <div className="w-16 h-16 bg-brand-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                    <ShieldCheck className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-brand-900 mb-3">{config.onboarding.complianceInfoTitle}</h3>
                <p className="text-brand-700 leading-relaxed mb-6">
                    {config.onboarding.complianceInfoDesc}
                </p>
            </div>
         </div>
      </div>
    </div>
    
    {showTermsModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[#e6ece9] flex justify-between items-center bg-[#f8faf9]">
            <h2 className="text-xl font-bold text-brand-900">Terms & Conditions</h2>
            <button 
              onClick={() => setShowTermsModal(false)}
              className="text-[#6b7a73] hover:text-[#1a2e25] w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#e6ece9] transition-colors"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-auto bg-white p-0">
            <iframe src="/terms" className="w-full h-full min-h-[60vh] border-0" />
          </div>
          <div className="p-4 border-t border-[#e6ece9] bg-[#f8faf9] flex justify-end gap-3">
            <button
              onClick={() => setShowTermsModal(false)}
              className="px-6 py-2.5 border border-[#e2e8e4] text-[#6b7a73] font-bold rounded-xl hover:bg-white transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => {
                setTermsAccepted(true);
                setShowTermsModal(false);
              }}
              className="px-6 py-2.5 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-800 transition-colors"
            >
              Accept & Close
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#f8faf9] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    }>
      <RegisterForm />
    </Suspense>
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
