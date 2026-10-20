import type { Metadata } from 'next'
import Link from 'next/link'
import { ProductsMenu } from '@/components/marketing/ProductsMenu'
import { ComplianceSuite } from '@/components/marketing/ComplianceSuite'
import { getDomainConfig } from '@/lib/domain-config'
import { StructuredData } from '@/components/marketing/StructuredData'
import {
  CheckCircle, Zap, FileText, Users, ArrowRight,
  Star, MessageSquare, Clock, ShieldCheck, ChevronDown
} from 'lucide-react'

const seo = getDomainConfig('childcare')

export const metadata: Metadata = {
  title: { absolute: seo.title },
  description: seo.description,
  // Served at "/" of its own domain; the vertical path redirects there
  alternates: { canonical: '/' },
}

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Center subscribes',
    desc: 'Sign up in minutes. Set up your classrooms and add the NC staff file checklist in one click.',
    icon: ShieldCheck,
  },
  {
    step: '02',
    title: 'Invite your staff pool',
    desc: 'Send unique invite links to your teachers, floaters, support staff, and cooks. Their accounts are always free.',
    icon: Users,
  },
  {
    step: '03',
    title: 'Post an open shift',
    desc: 'It takes 30 seconds. Pick the date, time, classroom, and staff type needed.',
    icon: Clock,
  },
  {
    step: '04',
    title: 'Blast fill via SMS',
    desc: 'CareLocal instantly texts your eligible staff pool. The first to claim it gets the shift.',
    icon: MessageSquare,
  },
]

const FEATURES = [
  {
    icon: Zap,
    title: 'Instant SMS Blast Fill',
    desc: 'When a shift opens, your entire eligible staff pool gets a text immediately. No calls. No group chats.',
  },
  {
    icon: FileText,
    title: 'One Document Library per Teacher',
    desc: 'Staff upload CPR cards, TB results and certificates once, from their phone, and reuse them. You review and approve.',
  },
  {
    icon: Users,
    title: 'Your Staff, Your Pool',
    desc: "Not a marketplace. Your center builds its own trusted pool of regular staff and substitutes you already know.",
  },
  {
    icon: ShieldCheck,
    title: 'Always Inspection-Ready',
    desc: 'Due dates, renewals, training hours and inspection reports tracked for you. You stay in charge of every compliance call.',
  },
]

const PRICING = [
  {
    name: 'Starter',
    price: 49,
    desc: 'Perfect for a single-location center getting started.',
    features: ['1 location', 'Up to 30 staff profiles', 'Shift posting & blast fill', 'SMS + email notifications', 'Document collection & review', 'Basic reporting'],
    cta: 'Start free trial',
    href: '/register?plan=starter',
    highlight: false,
  },
  {
    name: 'Growth',
    price: 129,
    desc: 'For growing centers with multiple rooms or a second location.',
    features: ['Up to 3 locations', 'Up to 100 staff profiles', 'Everything in Starter', 'Staff preference & priority blast', 'Scheduling calendar', 'Payroll export (CSV)', 'Document expiry reminders', 'Staff reliability scores'],
    cta: 'Start free trial',
    href: '/register?plan=growth',
    highlight: true,
  },
  {
    name: 'Network',
    price: 279,
    desc: 'For multi-site operators managing a shared staff pool.',
    features: ['Up to 10 locations', 'Up to 300 staff profiles', 'Everything in Growth', 'Shared staff pool across locations', 'Mobile PWA for staff', 'QuickBooks / Gusto export', 'Priority support'],
    cta: 'Start free trial',
    href: '/register?plan=network',
    highlight: false,
  },
]

/** Shown in the FAQ section and published as FAQPage structured data */
const FAQS = [
  {
    q: "How does the SMS shift blast work?",
    a: "With CareLocal's childcare staff scheduling software, posting a shift takes under 30 seconds. The platform instantly broadcasts an SMS text notification to your pre-approved substitute pool. The first eligible teacher to claim it gets the shift. No phone tag, no manual group messages."
  },
  {
    q: "Is CareLocal a childcare staffing agency?",
    a: "No. CareLocal is a software platform and a direct alternative to expensive daycare staffing agencies. We provide the tools for childcare centers to build, organize, and dispatch their own private substitute pools, saving thousands in agency markups and placement fees."
  },
  {
    q: "How does CareLocal help with state licensing compliance?",
    a: "Start from the NC Staff and Substitute file checklists and the 11-topic Health & Safety Training record in one click, then adjust them to your center. Every item gets a due date from the employee's start date and renews on schedule — annually, every 5 years, or before a certificate expires. Directors record training dates and hours, staff sign policies online, and a compliance overview shows exactly who needs what before your licensing consultant does. You stay in charge of every compliance decision."
  },
  {
    q: "How do I collect missing documents from staff?",
    a: "Send a request to one teacher or to everyone missing an item. Staff get a text, push or email, and answer from the document library on their phone — only the document they choose is shared with your center. You accept it, or send it back with a note, and reminders follow up automatically until it's done."
  },
  {
    q: "Can I keep facility inspection records in CareLocal too?",
    a: "Yes. Track fire marshal, sanitation, playground, fire extinguisher, pest control, HVAC and any other inspection with its schedule, due date, result and full history. Attach the inspection report or certificate to each visit, and keep your service vendors and their contacts in one list."
  },
  {
    q: "How are sensitive staff documents protected?",
    a: "Documents live in private, encrypted storage — never on a public link — and open only through links that expire within minutes. Medical records such as TB results and health questionnaires are kept in a confidential file that only the owner and designated admins can open, and every view is logged. Accepted documents stay in your records even after an employee leaves."
  },
  {
    q: "Is CareLocal free for daycare teachers and substitutes?",
    a: "Yes! Teacher, floater, and substitute accounts are 100% free. Childcare staff can create profiles, upload certifications, and claim shifts from any mobile browser without paying any fees or subscriptions. While account usage has no limits, a small platform maintenance fee is applied to the staff member's balance for each assigned shift."
  },
  {
    q: "How does the 3-month free trial work?",
    a: "We want center directors to experience the benefits risk-free. You get full access to CareLocal's staff scheduling features, SMS blasting, and document management for 3 months. No credit card is required to sign up, and you can cancel anytime."
  }
]

export default function ChildcareHomePage() {
  return (
    <div className="min-h-screen bg-surface">

      <StructuredData vertical="childcare" faqs={FAQS} plans={PRICING} />
      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 glass border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="CareLocal" width={64} height={64} className="h-16 w-16 rounded-xl object-contain" />
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted">
            <ProductsMenu />
            <Link href="#how-it-works" className="hover:text-brand-600 transition-colors">How it works</Link>
            <Link href="#features" className="hover:text-brand-600 transition-colors">Features</Link>
            <Link href="#compliance" className="hover:text-brand-600 transition-colors">Compliance</Link>
            <Link href="#pricing" className="hover:text-brand-600 transition-colors">Pricing</Link>
            <Link href="/jobs" className="hover:text-brand-600 transition-colors">Jobs</Link>
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

      {/* ── Hero ── */}
      <section className="relative overflow-hidden pt-20 pb-28 px-6">
        {/* Background blobs */}
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-brand-300 opacity-10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-[400px] h-[400px] bg-amber-400 opacity-10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-brand-50 border border-brand-200 text-brand-600 rounded-full px-4 py-1.5 text-sm font-medium mb-8">
            <span className="w-2 h-2 rounded-full bg-[#1e8f6b] pulse-dot" />
            Now live in Charlotte, NC
          </div>

          <h1 className="text-5xl md:text-6xl font-extrabold text-heading leading-tight tracking-tight mb-6">
            The all-in-one platform for{' '}
            <span className="gradient-text">childcare staffing and compliance</span>
          </h1>

          <p className="text-xl text-text-muted max-w-2xl mx-auto mb-10 leading-relaxed">
            Shifts, staff documents, trainings, inspections and vendors — one login for your whole center.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="flex items-center gap-2 bg-brand-600 text-white font-semibold px-8 py-4 rounded-xl hover:bg-brand-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 text-lg"
            >
              Start your free trial
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="#how-it-works"
              className="text-brand-600 font-semibold px-8 py-4 rounded-xl border border-brand-200 hover:bg-brand-50 transition-colors text-lg"
            >
              See how it works
            </Link>
          </div>

          <p className="mt-5 text-sm text-muted">
            3-month free trial · No credit card required · Staff accounts always free
          </p>
        </div>

        {/* ── Stats bar ── */}
        <div className="max-w-3xl mx-auto mt-20 grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden shadow-sm">
          {[
            { val: '< 4 hrs', label: 'Avg. shift fill time' },
            { val: '75%+', label: 'Shift fill rate' },
            { val: '$0', label: 'Cost to staff' },
          ].map(({ val, label }) => (
            <div key={label} className="bg-white px-6 py-6 text-center">
              <div className="text-3xl font-extrabold text-brand-600">{val}</div>
              <div className="text-sm text-muted mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-heading mb-4">How CareLocal works</h2>
            <p className="text-muted text-lg max-w-xl mx-auto">
              From open shift to confirmed staff — in four simple steps.
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            {HOW_IT_WORKS.map(({ step, title, desc, icon: Icon }) => (
              <div
                key={step}
                className="group bg-white rounded-2xl p-6 border border-border hover:border-brand-300 hover:shadow-md transition-all"
              >
                <div className="text-xs font-bold text-brand-200 tracking-widest mb-4">{step}</div>
                <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center mb-4 group-hover:bg-brand-100 transition-colors">
                  <Icon className="w-5 h-5 text-brand-600" />
                </div>
                <h3 className="font-bold text-text-main mb-2">{title}</h3>
                <p className="text-sm text-muted leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-6 bg-brand-900">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">Everything your center needs</h2>
            <p className="text-brand-300 text-lg max-w-xl mx-auto">
              Built specifically for childcare — not adapted from a generic scheduling tool.
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
            <h3 className="text-white font-bold text-lg mb-6 text-center">Staff types supported</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { type: 'Teacher', emoji: '📚', desc: 'Lead & assistant classroom teachers' },
                { type: 'Floater', emoji: '🔄', desc: 'Multi-room flexible coverage' },
                { type: 'Support', emoji: '🤝', desc: 'Admin, aides & non-classroom roles' },
                { type: 'Cook', emoji: '🍽️', desc: 'Kitchen & meal prep staff' },
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

      {/* ── Compliance & operations ── */}
      <ComplianceSuite vertical="childcare" />

      {/* ── Pricing ── */}
      <section id="pricing" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-heading mb-4">Simple, transparent pricing</h2>
            <p className="text-muted text-lg max-w-xl mx-auto">
              Centers pay a flat monthly subscription. Staff accounts are <strong>always free</strong>.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {PRICING.map(({ name, price, desc, features, cta, href, highlight }) => (
              <div
                key={name}
                className={`rounded-2xl p-8 border flex flex-col transition-all ${
                  highlight
                    ? 'bg-brand-900 border-brand-600 shadow-2xl scale-105'
                    : 'bg-white border-border hover:border-brand-300 hover:shadow-md'
                }`}
              >
                {highlight && (
                  <div className="inline-block bg-amber-400 text-heading text-xs font-bold px-3 py-1 rounded-full mb-4 w-fit">
                    Most popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className={`text-xl font-bold mb-1 ${highlight ? 'text-white' : 'text-heading'}`}>{name}</h3>
                  <p className={`text-sm mb-4 ${highlight ? 'text-brand-300' : 'text-muted'}`}>{desc}</p>
                  <div className="flex items-end gap-1">
                    <span className={`text-4xl font-extrabold ${highlight ? 'text-white' : 'text-heading'}`}>${price}</span>
                    <span className={`text-sm mb-1 ${highlight ? 'text-brand-300' : 'text-muted'}`}>/month</span>
                  </div>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <CheckCircle className={`w-4 h-4 shrink-0 mt-0.5 ${highlight ? 'text-brand-400' : 'text-brand-600'}`} />
                      <span className={`text-sm ${highlight ? 'text-brand-100' : 'text-text-muted'}`}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={href}
                  className={`w-full text-center font-semibold py-3 rounded-xl transition-all ${
                    highlight
                      ? 'bg-amber-400 text-heading hover:bg-amber-500'
                      : 'bg-brand-50 text-brand-600 border border-brand-200 hover:bg-brand-100'
                  }`}
                >
                  {cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted mt-8">
            All plans include a 3-month free trial and the full compliance toolkit — staff file checklists, policy sign-off, document requests, inspections and vendors. Annual billing saves 2 months.
            <Link href="/contact" className="text-brand-600 font-medium ml-1 hover:underline">
              Need Enterprise? Contact us →
            </Link>
          </p>
        </div>
      </section>

      {/* ── Trust / disclaimer ── */}
      <section className="py-16 px-6 bg-surface border-t border-border">
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex justify-center mb-4">
            <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
            <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
            <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
            <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
            <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
          </div>
          <blockquote className="text-xl text-text-main font-medium italic mb-4">
            "We used to spend 45 minutes calling substitutes every morning. Now I post a shift and my phone buzzes with a confirmation before I finish setting up the classroom."
          </blockquote>
          <p className="text-muted text-sm">— Center Director, Charlotte, NC</p>
        </div>
      </section>

      {/* ── FAQ Section ── */}
      <section id="faq" className="py-24 px-6 bg-white border-t border-border">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-heading mb-4">Frequently Asked Questions</h2>
            <p className="text-muted text-lg max-w-xl mx-auto">
              Got questions about CareLocal's childcare scheduling software? We have answers.
            </p>
          </div>
          <div className="space-y-2 divide-y divide-border">
            {FAQS.map((faq, index) => (
              <details key={index} className="group py-6 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex items-center justify-between cursor-pointer focus:outline-none">
                  <h3 className="text-lg font-bold text-heading pr-4">{faq.q}</h3>
                  <span className="shrink-0 transition duration-300 group-open:-rotate-180">
                    <ChevronDown className="w-5 h-5 text-brand-600" />
                  </span>
                </summary>
                <p className="mt-4 text-base text-text-muted leading-relaxed">
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
            Ready to never scramble for subs — or binders — again?
          </h2>
          <p className="text-brand-200 text-lg mb-10">
            Join Charlotte centers already using CareLocal to fill shifts and stay inspection-ready. Your entire staff pool gets free accounts.
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
              <span className="text-white font-bold text-xs">CL</span>
            </div>
            <span className="font-semibold text-white">CareLocal</span>
          </div>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link href="/jobs" className="hover:text-white transition-colors">Jobs</Link>
            <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
          </div>
          <span>© {new Date().getFullYear()} CareLocal. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}
