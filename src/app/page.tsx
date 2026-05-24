import Link from 'next/link'
import {
  CheckCircle, Zap, FileText, Users, ArrowRight,
  Star, MessageSquare, Clock, ShieldCheck
} from 'lucide-react'

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Center subscribes',
    desc: 'Sign up in minutes. Set up your center profile, classrooms, and document checklist.',
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
    title: 'Document Profiles',
    desc: 'Staff upload their CPR cards, background checks, and certs once. You review and approve them directly.',
  },
  {
    icon: Users,
    title: 'Your Staff, Your Pool',
    desc: "Not a marketplace. Your center builds its own trusted pool of people you already know.",
  },
  {
    icon: ShieldCheck,
    title: 'You Own Compliance',
    desc: 'Set your own document checklist. CareLocal organizes docs — your center makes all compliance calls.',
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

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#f8faf9]">

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 glass border-b border-[#e2e8e4]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#157354] flex items-center justify-center">
              <span className="text-white font-bold text-sm">CL</span>
            </div>
            <span className="font-bold text-[#0f4a36] text-lg">CareLocal</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[#6b7a73]">
            <Link href="#how-it-works" className="hover:text-[#157354] transition-colors">How it works</Link>
            <Link href="#features" className="hover:text-[#157354] transition-colors">Features</Link>
            <Link href="#pricing" className="hover:text-[#157354] transition-colors">Pricing</Link>
            <Link href="/contact" className="hover:text-[#157354] transition-colors">Contact</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-[#157354] hover:text-[#0f4a36] transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="text-sm font-semibold bg-[#157354] text-white px-4 py-2 rounded-lg hover:bg-[#0f4a36] transition-colors shadow-sm"
            >
              Get started free
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden pt-20 pb-28 px-6">
        {/* Background blobs */}
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-[#74c3a8] opacity-10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-[400px] h-[400px] bg-[#fbbf24] opacity-10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-[#edf7f3] border border-[#a9dac9] text-[#157354] rounded-full px-4 py-1.5 text-sm font-medium mb-8">
            <span className="w-2 h-2 rounded-full bg-[#1e8f6b] pulse-dot" />
            Now live in Charlotte, NC
          </div>

          <h1 className="text-5xl md:text-6xl font-extrabold text-[#0b3828] leading-tight tracking-tight mb-6">
            Fill childcare shifts in{' '}
            <span className="gradient-text">minutes, not hours</span>
          </h1>

          <p className="text-xl text-[#3d5a4f] max-w-2xl mx-auto mb-10 leading-relaxed">
            CareLocal is the staffing coordination platform built exclusively for childcare centers.
            Post a shift, blast your staff pool via SMS, and get confirmation — before you finish your coffee.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/register"
              className="flex items-center gap-2 bg-[#157354] text-white font-semibold px-8 py-4 rounded-xl hover:bg-[#0f4a36] transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 text-lg"
            >
              Start your free trial
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="#how-it-works"
              className="text-[#157354] font-semibold px-8 py-4 rounded-xl border border-[#a9dac9] hover:bg-[#edf7f3] transition-colors text-lg"
            >
              See how it works
            </Link>
          </div>

          <p className="mt-5 text-sm text-[#6b7a73]">
            6-month free trial · No credit card required · Staff accounts always free
          </p>
        </div>

        {/* ── Stats bar ── */}
        <div className="max-w-3xl mx-auto mt-20 grid grid-cols-3 gap-px bg-[#e2e8e4] rounded-2xl overflow-hidden shadow-sm">
          {[
            { val: '< 4 hrs', label: 'Avg. shift fill time' },
            { val: '75%+', label: 'Shift fill rate' },
            { val: '$0', label: 'Cost to staff' },
          ].map(({ val, label }) => (
            <div key={label} className="bg-white px-6 py-6 text-center">
              <div className="text-3xl font-extrabold text-[#157354]">{val}</div>
              <div className="text-sm text-[#6b7a73] mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-[#0b3828] mb-4">How CareLocal works</h2>
            <p className="text-[#6b7a73] text-lg max-w-xl mx-auto">
              From open shift to confirmed staff — in four simple steps.
            </p>
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            {HOW_IT_WORKS.map(({ step, title, desc, icon: Icon }) => (
              <div
                key={step}
                className="group bg-white rounded-2xl p-6 border border-[#e2e8e4] hover:border-[#74c3a8] hover:shadow-md transition-all"
              >
                <div className="text-xs font-bold text-[#a9dac9] tracking-widest mb-4">{step}</div>
                <div className="w-10 h-10 rounded-xl bg-[#edf7f3] flex items-center justify-center mb-4 group-hover:bg-[#d4ede4] transition-colors">
                  <Icon className="w-5 h-5 text-[#157354]" />
                </div>
                <h3 className="font-bold text-[#1a2e25] mb-2">{title}</h3>
                <p className="text-sm text-[#6b7a73] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-6 bg-[#0b3828]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-white mb-4">Everything your center needs</h2>
            <p className="text-[#74c3a8] text-lg max-w-xl mx-auto">
              Built specifically for childcare — not adapted from a generic scheduling tool.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-4 bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <div className="shrink-0 w-12 h-12 rounded-xl bg-[#157354] flex items-center justify-center">
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-white mb-1">{title}</h3>
                  <p className="text-sm text-[#74c3a8] leading-relaxed">{desc}</p>
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
                  <div className="text-xs text-[#74c3a8] mt-1">{desc}</div>
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
            <h2 className="text-4xl font-bold text-[#0b3828] mb-4">Simple, transparent pricing</h2>
            <p className="text-[#6b7a73] text-lg max-w-xl mx-auto">
              Centers pay a flat monthly subscription. Staff accounts are <strong>always free</strong>.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {PRICING.map(({ name, price, desc, features, cta, href, highlight }) => (
              <div
                key={name}
                className={`rounded-2xl p-8 border flex flex-col transition-all ${
                  highlight
                    ? 'bg-[#0b3828] border-[#157354] shadow-2xl scale-105'
                    : 'bg-white border-[#e2e8e4] hover:border-[#74c3a8] hover:shadow-md'
                }`}
              >
                {highlight && (
                  <div className="inline-block bg-[#fbbf24] text-[#0b3828] text-xs font-bold px-3 py-1 rounded-full mb-4 w-fit">
                    Most popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className={`text-xl font-bold mb-1 ${highlight ? 'text-white' : 'text-[#0b3828]'}`}>{name}</h3>
                  <p className={`text-sm mb-4 ${highlight ? 'text-[#74c3a8]' : 'text-[#6b7a73]'}`}>{desc}</p>
                  <div className="flex items-end gap-1">
                    <span className={`text-4xl font-extrabold ${highlight ? 'text-white' : 'text-[#0b3828]'}`}>${price}</span>
                    <span className={`text-sm mb-1 ${highlight ? 'text-[#74c3a8]' : 'text-[#6b7a73]'}`}>/month</span>
                  </div>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <CheckCircle className={`w-4 h-4 shrink-0 mt-0.5 ${highlight ? 'text-[#40a884]' : 'text-[#157354]'}`} />
                      <span className={`text-sm ${highlight ? 'text-[#d4ede4]' : 'text-[#3d5a4f]'}`}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={href}
                  className={`w-full text-center font-semibold py-3 rounded-xl transition-all ${
                    highlight
                      ? 'bg-[#fbbf24] text-[#0b3828] hover:bg-[#f59e0b]'
                      : 'bg-[#edf7f3] text-[#157354] border border-[#a9dac9] hover:bg-[#d4ede4]'
                  }`}
                >
                  {cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-[#6b7a73] mt-8">
            All plans include a 6-month free trial. Annual billing saves 2 months.
            <Link href="/contact" className="text-[#157354] font-medium ml-1 hover:underline">
              Need Enterprise? Contact us →
            </Link>
          </p>
        </div>
      </section>

      {/* ── Trust / disclaimer ── */}
      <section className="py-16 px-6 bg-[#f8faf9] border-t border-[#e2e8e4]">
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex justify-center mb-4">
            <Star className="w-5 h-5 text-[#fbbf24] fill-[#fbbf24]" />
            <Star className="w-5 h-5 text-[#fbbf24] fill-[#fbbf24]" />
            <Star className="w-5 h-5 text-[#fbbf24] fill-[#fbbf24]" />
            <Star className="w-5 h-5 text-[#fbbf24] fill-[#fbbf24]" />
            <Star className="w-5 h-5 text-[#fbbf24] fill-[#fbbf24]" />
          </div>
          <blockquote className="text-xl text-[#1a2e25] font-medium italic mb-4">
            "We used to spend 45 minutes calling substitutes every morning. Now I post a shift and my phone buzzes with a confirmation before I finish setting up the classroom."
          </blockquote>
          <p className="text-[#6b7a73] text-sm">— Center Director, Charlotte, NC</p>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 bg-[#157354]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-4xl font-extrabold text-white mb-4">
            Ready to never scramble for subs again?
          </h2>
          <p className="text-[#a9dac9] text-lg mb-10">
            Join Charlotte centers already using CareLocal. Your entire staff pool gets free accounts.
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 bg-white text-[#157354] font-bold px-10 py-4 rounded-xl hover:bg-[#edf7f3] transition-colors shadow-xl text-lg"
          >
            Get started — it's free
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-12 px-6 bg-[#0b3828]">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-[#74c3a8]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#157354] flex items-center justify-center">
              <span className="text-white font-bold text-xs">CL</span>
            </div>
            <span className="font-semibold text-white">CareLocal</span>
          </div>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
          </div>
          <span>© {new Date().getFullYear()} CareLocal. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}
