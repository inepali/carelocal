import Link from 'next/link'
import {
  ArrowRight, BellRing, Briefcase, CalendarCheck, CalendarClock, CheckCircle2, FileCheck2, Globe, HeartHandshake,
  LayoutGrid, MapPin, MessageSquareText, Search, Settings2, Store, Users,
} from 'lucide-react'
import type { DomainKey } from '@/lib/domain-config'
import type { PublicCenterSummary } from '@/lib/server/public-center'
import { CenterCard } from './CenterCard'

/**
 * The /centers landing page. Two kinds of visitor arrive here: owners and directors (from ads and shared links),
 * and families or job seekers looking at local centers. The hero speaks to centers, the listed centers sit right
 * under it (as open jobs do on /jobs), then what a center gets, how to start, questions, and a last call.
 * Public center pages come with paid plans, so the copy never promises one during the trial.
 * Every number shown comes from the live data; nothing is made up.
 */

type Copy = {
  noun: string            // "child care"
  place: string           // what a provider is called: "center", "facility", "community"
  people: string          // who works there
  families: string        // who looks for care
  subWord: string         // "substitute" / "per diem" / "fill-in"
  files: string           // staff file wording
  classroom: { title: string; desc: string }
  family: { title: string; desc: string }
}

export const CENTERS_COPY: Record<DomainKey, Copy> = {
  childcare: {
    noun: 'child care',
    place: 'center',
    people: 'teachers',
    families: 'families',
    subWord: 'substitute',
    files: 'NC staff file checklists, training hours and policy sign-off',
    classroom: { title: 'Live ratios and a daily schedule', desc: 'See every room and its teacher-to-child ratio as children check in, and build each day’s room assignments on one board, breaks and call-outs included.' },
    family: { title: 'Parents kept in the loop', desc: 'Daily reports, approved photos, menus, announcements and teacher messages on a private parent page. No app for parents to install.' },
  },
  healthcare: {
    noun: 'healthcare',
    place: 'facility',
    people: 'nurses and aides',
    families: 'patients and families',
    subWord: 'per diem',
    files: 'licenses, competencies and annual training',
    classroom: { title: 'Scheduling in one place', desc: 'See open shifts, who is confirmed and who is due for renewal before you post.' },
    family: { title: 'Inspection-ready records', desc: 'Inspections, vendors and expenses tracked with their reports and due dates.' },
  },
  senior: {
    noun: 'senior care',
    place: 'community',
    people: 'caregivers',
    families: 'families',
    subWord: 'fill-in',
    files: 'caregiver files, training and policy sign-off',
    classroom: { title: 'Scheduling in one place', desc: 'See open shifts, who is confirmed and who is due for renewal before you post.' },
    family: { title: 'Inspection-ready records', desc: 'Inspections, vendors and expenses tracked with their reports and due dates.' },
  },
}

export function centersFaq(domain: DomainKey, starterPrice: number) {
  const c = CENTERS_COPY[domain]
  return [
    {
      q: `How do I get my ${c.place} listed here?`,
      a: `Your public page comes with any paid plan. Start the free trial, then choose a plan, add your description, programs and team, and turn the page on. It shows up here and on Google once it has something to read.`,
    },
    {
      q: 'What does CareLocal cost?',
      a: `Every ${c.place} starts with a 3-month free trial with full access and no credit card. Paid plans start at $${starterPrice} a month for one location. ${c.people[0].toUpperCase()}${c.people.slice(1)} always join free.`,
    },
    {
      q: 'What is on a public page?',
      a: `Your name, city, description, programs, team and open jobs, plus a button for ${c.families} to request a tour. You choose whether to show your phone, email, license number, capacity and rating, and you can turn the page off any time.`,
    },
    {
      q: 'How do tour requests work?',
      a: `A visitor picks a time or tells you when they are free. The request lands in your CareLocal account with their contact details, they get a confirmation email, and you follow up. CareLocal never sells or shares tour requests.`,
    },
    {
      q: 'Is CareLocal a staffing agency?',
      a: `No. It is software for your own team. You build your own ${c.subWord} pool from people you know and trust, post your own jobs, and keep your own records. There are no placement fees or markups.`,
    },
    {
      q: `Is it free for ${c.people}?`,
      a: `Yes. ${c.people[0].toUpperCase()}${c.people.slice(1)} create a profile, upload documents, apply to jobs and pick up ${c.subWord} shifts for free, with no per-shift fees.`,
    },
  ]
}

const pill = 'inline-flex items-center gap-1.5'

/** Hero: who this is for, the live numbers, and the two calls to action */
export function CentersHero({ domain, stats, joinHref }: {
  domain: DomainKey
  stats: { centers: number; cities: number; jobs: number }
  joinHref: string
}) {
  const c = CENTERS_COPY[domain]
  return (
    <section className="relative overflow-hidden px-6 pb-16 pt-14 md:pb-20 md:pt-20">
      <div className="pointer-events-none absolute -right-40 -top-40 h-[560px] w-[560px] rounded-full bg-brand-300 opacity-10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-[380px] w-[380px] rounded-full bg-amber-400 opacity-10 blur-3xl" />

      <div className="relative mx-auto max-w-4xl text-center">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-sm font-medium text-brand-600">
          <Store className="h-4 w-4" aria-hidden /> For {c.noun} owners and directors
        </div>

        <h1 className="mb-6 text-4xl font-extrabold leading-tight tracking-tight text-heading sm:text-5xl md:text-6xl">
          Run your {c.place}. <span className="gradient-text">Get found by {c.families} and {c.people}.</span>
        </h1>
        <p className="mx-auto mb-9 max-w-2xl text-lg leading-relaxed text-text-muted md:text-xl">
          Fill shifts by text, keep staff files inspection-ready and hire from one place. Paid plans add a public {c.place} page
          with your programs, team, open jobs and online tour requests.
        </p>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href={joinHref}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-7 py-4 text-lg font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-800 hover:shadow-xl sm:w-auto">
            Start your free trial <ArrowRight className="h-5 w-5" />
          </Link>
          <Link href="#centers"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-200 bg-white px-7 py-4 text-lg font-semibold text-brand-600 transition-colors hover:bg-brand-50 sm:w-auto">
            <Search className="h-5 w-5" /> {stats.centers > 0 ? `Browse ${stats.centers} center${stats.centers === 1 ? '' : 's'}` : 'Browse centers'}
          </Link>
        </div>
        <p className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted">
          <span className={pill}><CheckCircle2 className="h-4 w-4 text-brand-600" /> 3 months free</span>
          <span className={pill}><CheckCircle2 className="h-4 w-4 text-brand-600" /> No credit card</span>
          <span className={pill}><CheckCircle2 className="h-4 w-4 text-brand-600" /> {c.people[0].toUpperCase()}{c.people.slice(1)} join free</span>
        </p>
      </div>

      {stats.centers > 0 && (
        <div className="relative mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-2xl bg-border shadow-sm">
          {[
            { val: stats.centers, label: stats.centers === 1 ? 'Center listed' : 'Centers listed' },
            { val: stats.cities, label: stats.cities === 1 ? 'City' : 'Cities' },
            { val: stats.jobs, label: stats.jobs === 1 ? 'Open job' : 'Open jobs' },
          ].map(s => (
            <div key={s.label} className="bg-white px-4 py-5 text-center">
              <div className="text-3xl font-extrabold text-brand-600">{s.val}</div>
              <div className="mt-1 text-sm text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** The listed centers, as before: cities to browse, then every center */
export function CenterList({ domain, centers, cities, joinHref }: {
  domain: DomainKey
  centers: PublicCenterSummary[]
  cities: { slug: string; city: string; state: string | null; count: number }[]
  joinHref: string
}) {
  const c = CENTERS_COPY[domain]
  return (
    <section id="centers" className="scroll-mt-24 border-t border-border bg-white px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-heading">{c.noun[0].toUpperCase()}{c.noun.slice(1)} centers on CareLocal</h2>
          <p className="mt-1 text-muted">Programs, team, who is hiring, and how to ask for a tour.</p>
        </div>

        {cities.length > 0 && (
          <div className="mb-8">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted">Browse by city</h3>
            <div className="flex flex-wrap gap-2">
              {cities.map(city => (
                <Link key={city.slug} href={`/centers/in/${city.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-50">
                  <MapPin className="h-4 w-4" aria-hidden /> {city.city}{city.state ? `, ${city.state}` : ''} <span className="text-muted">({city.count})</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {centers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center text-muted">
            No {c.place}s are listed yet. <Link href={joinHref} className="font-semibold text-brand-600 hover:underline">Start a free trial</Link> and be the first in your city,
            or <Link href="/jobs" className="font-semibold text-brand-600 hover:underline">browse open jobs</Link>.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {centers.map(center => <CenterCard key={center.handle} center={center} />)}
          </div>
        )}
      </div>
    </section>
  )
}

/** What a public page does for a center */
export function PublicPagePitch({ domain }: { domain: DomainKey }) {
  const c = CENTERS_COPY[domain]
  const items = [
    { icon: Globe, title: 'Found on Google', desc: `Your page is built for search, with your city, programs and open jobs, and a share image for Facebook and texts.` },
    { icon: CalendarCheck, title: 'Tour requests, online', desc: `${c.families[0].toUpperCase()}${c.families.slice(1)} pick a time from your page. The request comes straight to your account with their details.` },
    { icon: Briefcase, title: 'Jobs that apply in one tap', desc: `Open jobs show on your page and on Google for Jobs. ${c.people[0].toUpperCase()}${c.people.slice(1)} apply with their profile and documents already attached.` },
    { icon: Users, title: 'Your programs and team', desc: 'Show what makes you different: programs with ages and schedules, your team and their bios, and anything else you want people to know.' },
  ]
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold text-heading md:text-4xl">A {c.place} page that works for you</h2>
          <p className="mx-auto max-w-2xl text-lg text-muted">Included with every paid plan. You choose what to show, and you can turn it off any time.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(i => (
            <div key={i.title} className="rounded-2xl border border-border bg-white p-6 shadow-sm">
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><i.icon className="h-5 w-5" /></span>
              <h3 className="mb-1.5 text-lg font-bold text-heading">{i.title}</h3>
              <p className="text-[15px] leading-relaxed text-text-muted">{i.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Everything else a center gets, then three steps to start */
export function CenterTools({ domain }: { domain: DomainKey }) {
  const c = CENTERS_COPY[domain]
  const tools = [
    { icon: MessageSquareText, title: 'Fill shifts by text', desc: `Post an open shift in 30 seconds. Your own ${c.subWord} pool gets a text, and the first eligible person claims it.` },
    { icon: FileCheck2, title: 'Staff files, always current', desc: `Start from ${c.files}. Due dates, renewals and reminders are tracked for you.` },
    { icon: Briefcase, title: 'Hiring in one place', desc: 'Post jobs, review applicants with their documents, schedule interviews and send offers.' },
    { icon: domain === 'childcare' ? LayoutGrid : CalendarClock, title: c.classroom.title, desc: c.classroom.desc },
    { icon: domain === 'childcare' ? HeartHandshake : BellRing, title: c.family.title, desc: c.family.desc },
    { icon: Settings2, title: 'Inspections and vendors', desc: 'Fire, sanitation, playground and every other inspection, with reports, due dates, vendors and expenses.' },
  ]
  const steps = [
    { title: 'Start your free trial', desc: 'Three months with full access. No credit card.' },
    { title: 'Invite your team', desc: `Send invite links to your ${c.people} and ${c.subWord}s. Their accounts are free.` },
    { title: 'Go public', desc: `Choose a plan, fill in your ${c.place} page and share the link.` },
  ]
  return (
    <section className="bg-brand-900 px-6 py-20 text-white">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-3 text-center text-3xl font-bold md:text-4xl">Everything else, in the same login</h2>
        <p className="mx-auto mb-12 max-w-2xl text-center text-lg text-white/75">
          {domain === 'childcare' ? 'Built and tested inside a working child care center in Charlotte, NC.' : `One platform for your ${c.people}, your records and your ${c.place} page.`}
        </p>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map(t => (
            <div key={t.title} className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
              <t.icon className="mb-3 h-6 w-6 text-amber-400" />
              <h3 className="mb-1.5 text-lg font-bold">{t.title}</h3>
              <p className="text-[15px] leading-relaxed text-white/75">{t.desc}</p>
            </div>
          ))}
        </div>

        <h3 className="mb-6 mt-16 text-center text-2xl font-bold">Start in three steps</h3>
        <ol className="grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-2xl bg-white p-6 text-heading">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-400 text-base font-extrabold">{i + 1}</span>
              <h4 className="mb-1 text-lg font-bold">{s.title}</h4>
              <p className="text-[15px] text-text-muted">{s.desc}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 text-center">
          <Link href="/#features" className="inline-flex items-center gap-2 font-semibold text-amber-300 hover:text-amber-200">See every feature and plan <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>
    </section>
  )
}

export function CentersFaq({ faqs }: { faqs: { q: string; a: string }[] }) {
  return (
    <section className="border-t border-border bg-white px-6 py-20">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-10 text-center text-3xl font-bold text-heading md:text-4xl">Questions</h2>
        <div className="divide-y divide-border rounded-2xl border border-border">
          {faqs.map(f => (
            <details key={f.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold text-heading">
                {f.q}
                <span aria-hidden="true" className="text-2xl font-light text-brand-600 transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 leading-relaxed text-text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Families and job seekers who land here: one line each to what they came for */
export function VisitorStrip({ domain }: { domain: DomainKey }) {
  const c = CENTERS_COPY[domain]
  return (
    <section className="border-t border-border bg-surface px-6 py-10">
      <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2">
        <Link href="#centers" className="flex items-center gap-3 rounded-2xl border border-border bg-white p-5 hover:shadow-md">
          <HeartHandshake className="h-8 w-8 shrink-0 text-brand-600" />
          <div>
            <p className="font-bold text-heading">Looking for {c.noun}?</p>
            <p className="text-sm text-muted">Browse local {c.place}s and request a tour online.</p>
          </div>
        </Link>
        <Link href="/jobs" className="flex items-center gap-3 rounded-2xl border border-border bg-white p-5 hover:shadow-md">
          <Briefcase className="h-8 w-8 shrink-0 text-brand-600" />
          <div>
            <p className="font-bold text-heading">Looking for work?</p>
            <p className="text-sm text-muted">See open jobs and join {c.subWord} pools for free.</p>
          </div>
        </Link>
      </div>
    </section>
  )
}

export function CentersFinalCta({ domain, joinHref }: { domain: DomainKey; joinHref: string }) {
  const c = CENTERS_COPY[domain]
  return (
    <section className="bg-brand-600 px-6 py-20 text-center">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-4 text-3xl font-extrabold text-white md:text-4xl">Spend your morning on care, not the phone</h2>
        <p className="mb-8 text-lg text-white/85">Three months free. Your {c.people} join free. Your {c.place} page goes live when you choose a plan.</p>
        <Link href={joinHref} className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-lg font-semibold text-brand-700 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl">
          Start your free trial <ArrowRight className="h-5 w-5" />
        </Link>
      </div>
    </section>
  )
}
