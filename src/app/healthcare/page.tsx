import type { Metadata } from 'next'
import Link from 'next/link'
import {
  CheckCircle, Zap, FileText, Users, ArrowRight,
  Star, MessageSquare, Clock, ShieldCheck, ChevronDown
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'CareLocal Health — Medical Staffing Software & Hospital Shift Scheduling',
  description: 'Post open medical shifts, SMS blast your pre-approved pool of nurses and CNAs, and manage credentials in one place. Try CareLocal Health today.',
}

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Facility subscribes',
    desc: 'Sign up in minutes. Set up your hospital or clinic profile, care areas, and credential checklist.',
    icon: ShieldCheck,
  },
  {
    step: '02',
    title: 'Invite nursing pool',
    desc: 'Send unique invite links to your RNs, LPNs, CNAs, and caregivers. Their accounts are always free.',
    icon: Users,
  },
  {
    step: '03',
    title: 'Post open shift',
    desc: 'It takes 30 seconds. Pick the date, time, Care Area (e.g. ICU, ER), and staff type needed.',
    icon: Clock,
  },
  {
    step: '04',
    title: 'Blast fill via SMS',
    desc: 'CareLocal Health instantly texts your credentialed staff pool. The first to claim gets the shift.',
    icon: MessageSquare,
  },
]

const FEATURES = [
  {
    icon: Zap,
    title: 'Instant SMS Shift Broadcast',
    desc: 'When a shift opens, your entire pre-approved pool gets a text alert. No phone tag. No agency middleman.',
  },
  {
    icon: FileText,
    title: 'Credential Verification Vault',
    desc: 'Nurses upload licenses, BLS certifications, and immunizations. You review and approve documents directly.',
  },
  {
    icon: Users,
    title: 'Your Private Network',
    desc: 'Not a third-party marketplace. Build, maintain, and dispatch your own trusted, internal healthcare pool.',
  },
  {
    icon: ShieldCheck,
    title: 'Complete Compliance Control',
    desc: 'Set your own compliance standards. Verify credentials against clinic policies, and let software track expiry dates.',
  },
]

const PRICING = [
  {
    name: 'Starter',
    price: 99,
    desc: 'Perfect for a single-location clinic or practice getting started.',
    features: ['1 clinic location', 'Up to 30 staff profiles', 'Shift posting & blast fill', 'SMS + email notifications', 'License collection & review', 'Basic reporting'],
    cta: 'Start free trial',
    href: '/register?plan=starter',
    highlight: false,
  },
  {
    name: 'Growth',
    price: 249,
    desc: 'For larger medical facilities or practices with multiple wards.',
    features: ['Up to 3 locations', 'Up to 100 staff profiles', 'Everything in Starter', 'Staff preference & priority blast', 'Scheduling calendar', 'Payroll export (CSV)', 'License expiry alerts', 'Staff reliability scores'],
    cta: 'Start free trial',
    href: '/register?plan=growth',
    highlight: true,
  },
  {
    name: 'Network',
    price: 499,
    desc: 'For healthcare networks managing a shared nurse registry.',
    features: ['Up to 10 locations', 'Up to 300 staff profiles', 'Everything in Growth', 'Shared staff pool across wards', 'Mobile PWA for staff', 'QuickBooks / Gusto export', 'Priority support'],
    cta: 'Start free trial',
    href: '/register?plan=network',
    highlight: false,
  },
]

export default function HealthcareHomePage() {
  return (
    <div className="min-h-screen bg-[#f4f7fc]">

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 glass border-b border-brand-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">CLH</span>
            </div>
            <span className="font-bold text-brand-900 text-lg">CareLocal Health</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-brand-700">
            <Link href="#how-it-works" className="hover:text-brand-600 transition-colors">How it works</Link>
            <Link href="#features" className="hover:text-brand-600 transition-colors">Features</Link>
            <Link href="#pricing" className="hover:text-brand-600 transition-colors">Pricing</Link>
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
              Start Free Trial
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden pt-20 pb-28 px-6">
        {/* Background blobs */}
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-brand-300 opacity-15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-[400px] h-[400px] bg-brand-200 opacity-10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-brand-50 border border-brand-200 text-brand-600 rounded-full px-4 py-1.5 text-sm font-medium mb-8">
            <span className="w-2 h-2 rounded-full bg-brand-500 pulse-dot" />
            Healthcare Staffing Platform
          </div>

          <h1 className="text-5xl md:text-6xl font-extrabold text-brand-900 leading-tight tracking-tight mb-6">
            Fill hospital & clinic shifts in{' '}
            <span className="gradient-text">minutes, not hours</span>
          </h1>

          <p className="text-xl text-brand-700 max-w-2xl mx-auto mb-10 leading-relaxed">
            CareLocal Health is the staffing coordination platform built exclusively for healthcare facilities.
            Post a shift, blast your credentialed nursing pool via SMS, and get shifts claimed instantly.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="flex items-center gap-2 bg-brand-600 text-white font-semibold px-8 py-4 rounded-xl hover:bg-brand-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 text-lg"
            >
              Start free clinic trial
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="#how-it-works"
              className="text-brand-600 font-semibold px-8 py-4 rounded-xl border border-brand-200 hover:bg-brand-50 transition-colors text-lg"
            >
              See how it works
            </Link>
          </div>

          <p className="mt-5 text-sm text-brand-500">
            6-month free trial · No setup fees · Nursing accounts always 100% free
          </p>
        </div>

        {/* ── Stats bar ── */}
        <div className="max-w-3xl mx-auto mt-20 grid grid-cols-3 gap-px bg-brand-100 rounded-2xl overflow-hidden shadow-sm">
          {[
            { val: '< 15 mins', label: 'Avg. shift fill time' },
            { val: '92%+', label: 'Shift fill rate' },
            { val: '$0', label: 'Cost to medical staff' },
          ].map(({ val, label }) => (
            <div key={label} className="bg-white px-6 py-6 text-center">
              <div className="text-3xl font-extrabold text-brand-600">{val}</div>
              <div className="text-sm text-brand-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-brand-900 mb-4">How CareLocal Health works</h2>
            <p className="text-brand-500 text-lg max-w-xl mx-auto">
              From open shift to confirmed professional — in four simple steps.
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            {HOW_IT_WORKS.map(({ step, title, desc, icon: Icon }) => (
              <div
                key={step}
                className="group bg-white rounded-2xl p-6 border border-brand-100 hover:border-brand-300 hover:shadow-md transition-all"
              >
                <div className="text-xs font-bold text-brand-300 tracking-widest mb-4">{step}</div>
                <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center mb-4 group-hover:bg-brand-100 transition-colors">
                  <Icon className="w-5 h-5 text-brand-600" />
                </div>
                <h3 className="font-bold text-brand-900 mb-2">{title}</h3>
                <p className="text-sm text-brand-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-6 bg-brand-900">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">Everything your facility needs</h2>
            <p className="text-brand-300 text-lg max-w-xl mx-auto">
              Built specifically for clinical environments — not adapted from a generic scheduling tool.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-4 bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <div className="shrink-0 w-12 h-12 rounded-xl bg-brand-600 flex items-center justify-center">
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-white mb-1">{title}</h3>
                  <p className="text-sm text-brand-300 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Staff types */}
          <div className="mt-12 bg-white/5 border border-white/10 rounded-2xl p-8">
            <h3 className="text-white font-bold text-lg mb-6 text-center">Medical staff supported</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { type: 'Nurse (RN/LPN)', emoji: '🩺', desc: 'Registered & practical clinical nurses' },
                { type: 'CNA', emoji: '🧑‍⚕️', desc: 'Certified Nursing Assistants' },
                { type: 'Caregiver', emoji: '🤝', desc: 'Personal care & assisted living aides' },
                { type: 'Therapist', emoji: '💪', desc: 'Occupational & physical therapists' },
              ].map(({ type, emoji, desc }) => (
                <div key={type} className="text-center p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-3xl mb-2">{emoji}</div>
                  <div className="font-semibold text-white text-sm">{type}</div>
                  <div className="text-xs text-brand-300 mt-1">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-brand-900 mb-4">Simple, transparent pricing</h2>
            <p className="text-brand-500 text-lg max-w-xl mx-auto">
              Facilities pay a flat monthly subscription. Medical staff accounts are <strong>always free</strong>.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {PRICING.map(({ name, price, desc, features, cta, href, highlight }) => (
              <div
                key={name}
                className={`rounded-2xl p-8 border flex flex-col transition-all ${
                  highlight
                    ? 'bg-brand-900 border-brand-600 shadow-2xl scale-105'
                    : 'bg-white border-brand-100 hover:border-brand-300 hover:shadow-md'
                }`}
              >
                {highlight && (
                  <div className="inline-block bg-amber-500 text-brand-900 text-xs font-bold px-3 py-1 rounded-full mb-4 w-fit">
                    Most popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className={`text-xl font-bold mb-1 ${highlight ? 'text-white' : 'text-brand-900'}`}>{name}</h3>
                  <p className={`text-sm mb-4 ${highlight ? 'text-brand-300' : 'text-brand-500'}`}>{desc}</p>
                  <div className="flex items-end gap-1">
                    <span className={`text-4xl font-extrabold ${highlight ? 'text-white' : 'text-brand-900'}`}>${price}</span>
                    <span className={`text-sm mb-1 ${highlight ? 'text-brand-300' : 'text-brand-500'}`}>/month</span>
                  </div>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <CheckCircle className={`w-4 h-4 shrink-0 mt-0.5 ${highlight ? 'text-brand-400' : 'text-brand-600'}`} />
                      <span className={`text-sm ${highlight ? 'text-brand-100' : 'text-brand-700'}`}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={href}
                  className={`w-full text-center font-semibold py-3 rounded-xl transition-all ${
                    highlight
                      ? 'bg-amber-500 text-brand-900 hover:bg-amber-600'
                      : 'bg-brand-50 text-brand-600 border border-brand-200 hover:bg-brand-100'
                  }`}
                >
                  {cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-brand-500 mt-8">
            All plans include a 6-month free trial. Annual billing saves 2 months.
            <Link href="/contact" className="text-brand-600 font-medium ml-1 hover:underline">
              Need Enterprise? Contact us →
            </Link>
          </p>
        </div>
      </section>

      {/* ── Trust / disclaimer ── */}
      <section className="py-16 px-6 bg-[#f8faf9] border-t border-brand-100">
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex justify-center mb-4">
            <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
            <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
            <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
            <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
            <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
          </div>
          <blockquote className="text-xl text-brand-900 font-medium italic mb-4">
            "Managing shift coverage across our clinics used to take half a day. Now we broadcast the shift and a qualified CNA claims it in minutes. Our operations are seamless."
          </blockquote>
          <p className="text-brand-500 text-sm">— Operations Director, Charlotte Health System</p>
        </div>
      </section>

      {/* ── FAQ Section ── */}
      <section id="faq" className="py-24 px-6 bg-white border-t border-brand-100">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-brand-900 mb-4">Frequently Asked Questions</h2>
            <p className="text-brand-500 text-lg max-w-xl mx-auto">
              Got questions about CareLocal Health's medical staffing software? We have answers.
            </p>
          </div>
          <div className="space-y-2 divide-y divide-brand-100">
            {[
              {
                q: "How does the SMS shift broadcast work?",
                a: "With CareLocal Health, posting a shift takes under 30 seconds. The platform instantly broadcasts an SMS text notification to your pre-approved pool of nurses and aides. The first qualified professional to claim it gets the shift. No phone tag, no manual group messages."
              },
              {
                q: "Is CareLocal Health a healthcare staffing agency?",
                a: "No. CareLocal Health is a software-as-a-service platform that helps you avoid expensive staffing agencies. We provide the tools for clinics and hospitals to build, organize, and dispatch their own private substitute and PRN pools, saving thousands in markup fees."
              },
              {
                q: "How does the platform help with medical compliance?",
                a: "We serve as a central vault for medical credentials. Staff upload state nursing licenses, BLS certifications, background checks, and health/immunization logs. Administrators can review, approve, and track expiration dates in real-time, ensuring only fully compliant staff claim open shifts."
              },
              {
                q: "Is CareLocal Health free for nurses and CNAs?",
                a: "Yes! Nurse, CNA, and caregiver accounts are 100% free. Health staff can create profiles, upload certifications, and claim shifts from any mobile browser without paying any fees or subscriptions. While account usage has no limits, a small platform maintenance fee is applied to the staff member's balance for each assigned shift."
              },
              {
                q: "How does the 6-month free trial work?",
                a: "We want healthcare administrators to experience the benefits risk-free. You get full access to CareLocal Health's staff scheduling features, SMS blasting, and compliance management for 6 months. No credit card is required to sign up, and you can cancel anytime."
              }
            ].map((faq, index) => (
              <details key={index} className="group py-6 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex items-center justify-between cursor-pointer focus:outline-none">
                  <h3 className="text-lg font-bold text-brand-900 pr-4">{faq.q}</h3>
                  <span className="shrink-0 transition duration-300 group-open:-rotate-180">
                    <ChevronDown className="w-5 h-5 text-brand-600" />
                  </span>
                </summary>
                <p className="mt-4 text-base text-brand-700 leading-relaxed">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 bg-brand-600">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-4xl font-extrabold text-white mb-4">
            Ready to never scramble for PRN coverage again?
          </h2>
          <p className="text-brand-100 text-lg mb-10">
            Join Charlotte healthcare facilities already using CareLocal Health. Your entire nurse registry gets free accounts.
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 bg-white text-brand-600 font-bold px-10 py-4 rounded-xl hover:bg-brand-50 transition-colors shadow-xl text-lg"
          >
            Get started — it's free
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-12 px-6 bg-brand-900">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-brand-300">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">CLH</span>
            </div>
            <span className="font-semibold text-white">CareLocal Health</span>
          </div>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
          </div>
          <span>© {new Date().getFullYear()} CareLocal Health. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}
