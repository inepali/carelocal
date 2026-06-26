import { headers } from 'next/headers'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldCheck, Scale, Users, HeartHandshake, AlertTriangle, FileText } from 'lucide-react'
import { getDomainConfig, getDomainKey } from '@/lib/domain-config'

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const domainKey = getDomainKey(host)
  const config = getDomainConfig(domainKey)

  return {
    title: `Terms & Conditions | ${config.appName}`,
    description: `Terms and Conditions governing the use of ${config.appName}, the substitute placement and staff coordination platform.`,
  }
}

export default async function TermsPage() {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const domainKey = getDomainKey(host)
  const config = getDomainConfig(domainKey)
  const isHealthcare = domainKey === 'healthcare'

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-between">
      
      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 glass border-b border-brand-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">{config.logoShort}</span>
            </div>
            <span className="font-bold text-brand-800 text-lg">{config.appName}</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-brand-700">
            <Link href="/#how-it-works" className="hover:text-brand-600 transition-colors">How it works</Link>
            <Link href="/#features" className="hover:text-brand-600 transition-colors">Features</Link>
            <Link href="/#pricing" className="hover:text-brand-600 transition-colors">Pricing</Link>
            <Link href="/contact" className="hover:text-brand-600 transition-colors">Contact</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-brand-600 hover:text-brand-800 transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="text-sm font-semibold bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-800 transition-colors shadow-sm"
            >
              Get started free
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Main Content Area ── */}
      <main className="flex-grow py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12 text-center">
            <ShieldCheck className="w-16 h-16 text-brand-600 mx-auto mb-6" />
            <h1 className="text-4xl md:text-5xl font-black text-brand-900 mb-4 tracking-tight">Terms & Conditions</h1>
            <p className="text-brand-700 text-lg font-medium">Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>

          <div className="bg-white rounded-[2rem] border-2 border-brand-100 p-8 md:p-12 shadow-xl shadow-brand-600/5">
            
            <div className="prose prose-green max-w-none">
              <div className="flex items-center gap-3 mb-4">
                <FileText className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">1. Introduction</h2>
              </div>
              <p className="text-brand-700 mb-10 leading-relaxed text-lg">
                Welcome to {config.appName}. These Terms & Conditions govern your use of our platform, which serves as a marketplace connecting {isHealthcare ? 'healthcare facilities ("Facilities")' : 'childcare centers ("Centers")'} with qualified {isHealthcare ? 'healthcare professionals ("Staff")' : 'childcare professionals ("Staff")'}. By accessing or using our platform, you agree to be bound by these terms.
              </p>

              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">2. For {isHealthcare ? 'Healthcare Facilities' : 'Childcare Centers'}</h2>
              </div>
              <ul className="list-none pl-0 space-y-4 text-brand-700 mb-10">
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center font-black text-xs">A</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Accuracy of Listings</strong>
                    <span className="leading-relaxed">{isHealthcare ? 'Facilities' : 'Centers'} must provide accurate and complete information regarding available shifts, including requirements, location, hourly rates, and necessary staff qualifications.</span>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center font-black text-xs">B</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Compliance</strong>
                    <span className="leading-relaxed">{isHealthcare ? 'Facilities' : 'Centers'} are fully responsible for ensuring that they operate in compliance with all local, state, and federal {isHealthcare ? 'healthcare and licensing' : 'childcare'} regulations, including {isHealthcare ? 'credential' : 'staff-to-child ratio'} requirements, background check mandates, and safety standards.</span>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center font-black text-xs">C</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Payment Obligations</strong>
                    <span className="leading-relaxed">{isHealthcare ? 'Facilities' : 'Centers'} agree to compensate Staff for completed shifts in a timely manner according to the terms and payment method agreed upon during the shift booking process.</span>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center font-black text-xs">D</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Work Environment</strong>
                    <span className="leading-relaxed">{isHealthcare ? 'Facilities' : 'Centers'} must provide a safe, respectful, and legally compliant working environment for all {config.appName} Staff.</span>
                  </div>
                </li>
              </ul>

              <div className="flex items-center gap-3 mb-4">
                <HeartHandshake className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">3. For {isHealthcare ? 'Healthcare Professionals' : 'Childcare Staff'}</h2>
              </div>
              <ul className="list-none pl-0 space-y-4 text-brand-700 mb-10">
                 <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-amber-50 text-amber-800 flex items-center justify-center font-black text-xs">A</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Credentials & Qualifications</strong>
                    <span className="leading-relaxed">Staff must provide accurate information regarding their experience, certifications, and background checks. You are responsible for maintaining valid credentials required for the shifts you claim.</span>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-amber-50 text-amber-800 flex items-center justify-center font-black text-xs">B</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Commitment & Punctuality</strong>
                    <span className="leading-relaxed">By claiming and being confirmed for a shift, Staff commits to arriving on time and completing the full duration of the agreed-upon shift.</span>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-amber-50 text-amber-800 flex items-center justify-center font-black text-xs">C</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Professional Conduct</strong>
                    <span className="leading-relaxed">Staff must adhere to the policies and procedures of the {isHealthcare ? 'Facilities' : 'Centers'} they work at and maintain a high standard of professional behavior.</span>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-amber-50 text-amber-800 flex items-center justify-center font-black text-xs">D</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Cancellations</strong>
                    <span className="leading-relaxed">Staff must provide reasonable notice if unable to attend a confirmed shift. Frequent or sudden cancellations severely impact {isHealthcare ? 'facility' : 'center'} operations and may result in account suspension.</span>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-amber-50 text-amber-800 flex items-center justify-center font-black text-xs">E</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Platform Maintenance Fee</strong>
                    <span className="leading-relaxed">A platform maintenance fee is charged to the Staff member's account balance for each approved and assigned shift. This fee is determined by the {isHealthcare ? 'facility' : 'center'}'s Metro Area settings and is applied automatically upon assignment. Once a shift is assigned, this maintenance fee remains outstanding and due, regardless of whether the shift is completed, cancelled, or missed after assignment.</span>
                  </div>
                </li>
              </ul>

              <div className="flex items-center gap-3 mb-4">
                <Scale className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">4. Platform Role & Limitations</h2>
              </div>
              <p className="text-brand-700 mb-10 leading-relaxed">
                {config.appName} acts solely as a technology marketplace to facilitate connections between {isHealthcare ? 'Facilities' : 'Centers'} and Staff. We do not directly employ the Staff, nor do we manage the daily operations of the facilities. We are not responsible for the actions, omissions, or conduct of any User, whether online or offline. Both parties are independent entities using the platform.
              </p>

              <div className="flex items-center gap-3 mb-4">
                <AlertTriangle className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">5. Account Termination</h2>
              </div>
              <p className="text-brand-700 mb-10 leading-relaxed">
                We reserve the right to suspend or terminate accounts that violate these Terms, provide false documentation, repeatedly cancel shifts without notice, or engage in behavior detrimental to the {config.appName} community.
              </p>

              <h2 className="text-2xl font-black text-brand-900 mb-4">6. Liability</h2>
              <p className="text-brand-700 mb-10 leading-relaxed">
                To the maximum extent permitted by law, {config.appName} shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the platform, the relationships formed through it, or any services provided.
              </p>
            </div>
            
            <div className="mt-12 pt-8 border-t border-brand-100 flex justify-center">
              <Link 
                href="/"
                className="px-8 py-4 bg-surface text-brand-600 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-brand-50 transition-all border border-brand-100 flex items-center gap-2"
              >
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="py-12 px-6 bg-brand-900">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-brand-300">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">{config.logoShort}</span>
            </div>
            <span className="font-semibold text-white">{config.appName}</span>
          </div>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
          </div>
          <span>© {new Date().getFullYear()} {config.appName}. All rights reserved.</span>
        </div>
      </footer>

    </div>
  )
}
