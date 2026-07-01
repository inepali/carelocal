import { headers } from 'next/headers'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Lock, FileText, Database, Eye, Users, ShieldAlert, UserCheck, Mail } from 'lucide-react'
import { getDomainConfig, getDomainKey } from '@/lib/domain-config'

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const domainKey = getDomainKey(host)
  const config = getDomainConfig(domainKey)

  return {
    title: `Privacy Policy | ${config.appName}`,
    description: `Privacy Policy for ${config.appName} staffing platform, describing how we safeguard credentials and data for centers/facilities and staff.`,
  }
}

export default async function PrivacyPage() {
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
            <span className="font-bold text-brand-900 text-lg">{config.appName}</span>
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
            <Lock className="w-16 h-16 text-brand-600 mx-auto mb-6" />
            <h1 className="text-4xl md:text-5xl font-black text-brand-900 mb-4 tracking-tight">Privacy Policy</h1>
            <p className="text-[#6b7a73] text-lg font-medium">Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>

          <div className="bg-white rounded-[2rem] border-2 border-brand-100 p-8 md:p-12 shadow-xl shadow-brand-600/5">
            
            <div className="prose prose-blue max-w-none">
              
              {/* 1. Introduction */}
              <div className="flex items-center gap-3 mb-4">
                <FileText className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">1. Introduction</h2>
              </div>
              <p className="text-brand-700 mb-10 leading-relaxed text-lg">
                Welcome to {config.appName} ("we," "our," or "us"). We are committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform, which connects {isHealthcare ? 'healthcare facilities ("Facilities")' : 'childcare centers ("Centers")'} with qualified {isHealthcare ? 'healthcare staff and professionals ("Staff")' : 'childcare professionals ("Staff")'}. By accessing or using our services, you agree to the collection and use of information in accordance with this policy.
              </p>

              {/* 2. Information We Collect */}
              <div className="flex items-center gap-3 mb-4">
                <Database className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">2. Information We Collect</h2>
              </div>
              <p className="text-brand-700 mb-4 leading-relaxed text-lg">
                We collect information that identifies, relates to, describes, or could reasonably be linked to you. This includes:
              </p>
              <ul className="list-none pl-0 space-y-4 text-brand-700 mb-10">
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center font-black text-xs">A</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">For {isHealthcare ? 'Medical & Clinical' : 'Childcare'} Staff</strong>
                    <span className="leading-relaxed">
                      {isHealthcare 
                        ? 'Profile details (name, email, phone number, address), professional qualifications, credentials (e.g., state nursing licenses, BLS certifications, background checks, immunization logs), and check verification status.'
                        : 'Profile details (name, email, phone number, address), professional qualifications, credentials (e.g., CPR certifications, teacher certs, state training logs), and background check verification status.'}
                    </span>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center font-black text-xs">B</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">For {isHealthcare ? 'Facilities' : 'Childcare Centers'}</strong>
                    <span className="leading-relaxed">
                      {isHealthcare
                        ? 'Administrator name, email, phone, clinic/facility name, address, billing details, and care area configurations.'
                        : 'Administrator name, email, phone, center name, address, billing details, and work area configurations.'}
                    </span>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center font-black text-xs">C</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Usage & Device Data</strong>
                    <span className="leading-relaxed">Logs of shift blasts, SMS notification statuses, IP address, browser type, operating system, and details about how you interact with our platform.</span>
                  </div>
                </li>
              </ul>

              {/* 3. How We Use Your Information */}
              <div className="flex items-center gap-3 mb-4">
                <Eye className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">3. How We Use Your Information</h2>
              </div>
              <p className="text-brand-700 mb-4 leading-relaxed text-lg">
                We use the collected information for various professional and operational purposes, including:
              </p>
              <ul className="list-none pl-0 space-y-4 text-brand-700 mb-10">
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-amber-50 text-amber-800 flex items-center justify-center font-black text-xs">A</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Shift Matching & Verification</strong>
                    <span className="leading-relaxed">
                      {isHealthcare
                        ? 'Allowing Facilities to review and verify Staff credentials before shifts are claimed, ensuring compliance with medical and health department licensing regulations.'
                        : 'Allowing Centers to review and verify Staff credentials before shifts are claimed, ensuring compliance with local childcare regulations.'}
                    </span>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-amber-50 text-amber-800 flex items-center justify-center font-black text-xs">B</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">SMS & Email Notifications</strong>
                    <span className="leading-relaxed">Sending instant shift alerts (SMS blasts) and administrative emails concerning account setups, schedules, and confirmations.</span>
                  </div>
                </li>
                <li className="flex gap-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-amber-50 text-amber-800 flex items-center justify-center font-black text-xs">C</span>
                  <div>
                    <strong className="text-brand-900 block mb-1">Billing & Platform Improvements</strong>
                    <span className="leading-relaxed">{isHealthcare ? 'Processing subscription payments from Facilities and monitoring platform usage metrics to debug and enhance user experience.' : 'Processing subscription payments from Centers and monitoring platform usage metrics to debug and enhance user experience.'}</span>
                  </div>
                </li>
              </ul>

              {/* 4. Information Sharing & Disclosure */}
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">4. Sharing Your Information</h2>
              </div>
              <p className="text-brand-700 mb-10 leading-relaxed text-lg">
                We do not sell, trade, or rent your personal information to third parties. We share your information only under the following circumstances:
                <br /><br />
                <strong className="text-brand-900">Between Staff and {isHealthcare ? 'Facilities' : 'Centers'}:</strong> When a Staff member joins a pool or claims an open shift, their name, contact details, and uploaded credentials (like CPR cards or professional licenses) are shared with that administrator.
                <br /><br />
                <strong className="text-brand-900">With Service Providers:</strong> We share data with third-party service providers who assist us with operations (e.g., Twilio for SMS shift alerts, Supabase for cloud database hosting, Vercel for hosting, and Stripe for payment processing). These service providers are contractually obligated to protect your data.
                <br /><br />
                <strong className="text-brand-900">Legal Requirements:</strong> We may disclose information if required to do so by law, or to protect the safety, rights, or property of our platform, our users, or the public.
              </p>

              {/* 5. Security & Data Retention */}
              <div className="flex items-center gap-3 mb-4">
                <Lock className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">5. Security & Data Retention</h2>
              </div>
              <p className="text-brand-700 mb-10 leading-relaxed text-lg">
                We implement industry-standard administrative, physical, and electronic security measures to safeguard your credentials and personal details. However, no transmission over the internet can be guaranteed 100% secure. 
                <br /><br />
                We retain your personal information and documents as long as your account remains active or as necessary to fulfill the purposes outlined in this policy, including complying with legal and regulatory record-keeping requirements for {isHealthcare ? 'clinical health services' : 'childcare operations'}.
              </p>

              {/* 6. Children's Privacy (COPPA) */}
              <div className="flex items-center gap-3 mb-4">
                <ShieldAlert className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">6. Children's Privacy</h2>
              </div>
              <p className="text-brand-700 mb-10 leading-relaxed text-lg">
                Our platform is designed exclusively for adult {isHealthcare ? 'healthcare professionals' : 'childcare professionals'} and facility administrators. We do not knowingly collect, solicit, or maintain personal information from children under the age of 13. If we learn that we have collected information from a child under 13, we will delete that information immediately.
              </p>

              {/* 7. Your Choices & Rights */}
              <div className="flex items-center gap-3 mb-4">
                <UserCheck className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">7. Your Choices & Rights</h2>
              </div>
              <p className="text-brand-700 mb-10 leading-relaxed text-lg">
                You can access, correct, or update your profile details and documents at any time by logging into your account.
                <br /><br />
                Additionally, you may opt out of receiving SMS notifications from us by following the instructions in the texts or contacting support. Please note that opting out of SMS alerts will prevent you from receiving immediate shift offers.
              </p>

              {/* 8. Contact Us */}
              <div className="flex items-center gap-3 mb-4">
                <Mail className="w-6 h-6 text-brand-600" />
                <h2 className="text-2xl font-black text-brand-900 m-0">8. Contact Us</h2>
              </div>
              <p className="text-brand-700 mb-10 leading-relaxed text-lg">
                If you have any questions, concerns, or requests regarding this Privacy Policy or your data, please contact us at:
                <br /><br />
                <strong className="text-brand-900">{config.appName} Privacy Team</strong><br />
                Email: <a href={`mailto:${config.privacyEmail}`} className="text-brand-600 hover:underline font-semibold">{config.privacyEmail}</a>
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
