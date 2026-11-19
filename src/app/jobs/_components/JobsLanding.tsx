import Link from 'next/link'
import {
  ArrowRight, BellRing, Briefcase, CalendarCheck, CheckCircle2, FileCheck2, HandCoins, MapPin, MessageSquareText,
  Search, ShieldCheck, Smartphone, UserRound,
} from 'lucide-react'
import type { DomainKey } from '@/lib/domain-config'
import type { PublicJob } from '@/lib/server/public-jobs'
import { PublicJobCard } from './JobsShell'
import { ShareJobsButton } from './ShareJobsButton'

/**
 * The /jobs landing page for people looking for work: the page ads and shared links point to. Open jobs stay
 * right under the hero (most visitors from an ad want to see them first), then why CareLocal, how it works, the
 * two ways to work (a steady job or substitute shifts), questions, and a last call to join.
 * Every number shown comes from the live listings; nothing is made up.
 */

type Copy = {
  people: string          // who this is for
  headlineA: string
  headlineB: string       // the highlighted part
  sub: string
  docs: string            // the documents people usually need
  subWord: string         // "substitute" / "per diem" / "fill-in"
  subPitch: string
}

export const JOBS_COPY: Record<DomainKey, Copy> = {
  childcare: {
    people: 'teachers',
    headlineA: 'Find a child care job that',
    headlineB: 'fits your life',
    sub: 'Full-time, part-time and substitute work at local child care centers. One free profile, one tap to apply, and no fees, ever.',
    docs: 'CPR, background check and training certificates',
    subWord: 'substitute',
    subPitch: 'Pick the days you work. Join substitute pools at centers near you and get shift offers by text.',
  },
  healthcare: {
    people: 'nurses and aides',
    headlineA: 'Find a healthcare job that',
    headlineB: 'fits your life',
    sub: 'Full-time, part-time and per diem work at local care facilities. One free profile, one tap to apply, and no fees, ever.',
    docs: 'licenses, CPR, TB results and competencies',
    subWord: 'per diem',
    subPitch: 'Pick the shifts you work. Join per diem pools at facilities near you and get shift offers by text.',
  },
  senior: {
    people: 'caregivers',
    headlineA: 'Find a caregiving job that',
    headlineB: 'fits your life',
    sub: 'Full-time, part-time and fill-in work at local senior care communities. One free profile, one tap to apply, and no fees, ever.',
    docs: 'CPR, background check and training certificates',
    subWord: 'fill-in',
    subPitch: 'Pick the shifts you work. Join fill-in pools at communities near you and get shift offers by text.',
  },
}

export function jobsFaq(domain: DomainKey) {
  const c = JOBS_COPY[domain]
  return [
    {
      q: `Is CareLocal really free for ${c.people}?`,
      a: `Yes. Creating a profile, applying to jobs and picking up ${c.subWord} shifts is free: no subscription and no per-shift fees. Centers pay for CareLocal, not you.`,
    },
    {
      q: 'What do I need to apply?',
      a: `A free profile and your resume. Many centers also ask for documents like ${c.docs}. Each job lists what it needs and when, and you upload each document once and reuse it for every application.`,
    },
    {
      q: `Can I pick up ${c.subWord} shifts and still look for a steady job?`,
      a: `Yes. It is the same profile. Apply to open jobs and join ${c.subWord} pools at as many centers as you like.`,
    },
    {
      q: 'How do I hear about new jobs?',
      a: 'Turn on job alerts in your profile. When a center near you posts a job that matches, you get a notification.',
    },
    {
      q: 'Who can see my documents?',
      a: 'Only the centers you apply to or work with, and only what you share. Documents are kept in private, encrypted storage and never sit on a public link.',
    },
  ]
}

/** Hero: who this is for, the live numbers, and the two calls to action */
export function JobsHero({ domain, stats, topCity, joinHref }: {
  domain: DomainKey
  stats: { jobs: number; centers: number; cities: number }
  topCity: string | null
  joinHref: string
}) {
  const c = JOBS_COPY[domain]
  return (
    <section className="relative overflow-hidden px-6 pb-16 pt-14 md:pb-20 md:pt-20">
      <div className="pointer-events-none absolute -right-40 -top-40 h-[560px] w-[560px] rounded-full bg-brand-300 opacity-10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-[380px] w-[380px] rounded-full bg-amber-400 opacity-10 blur-3xl" />

      <div className="relative mx-auto max-w-4xl text-center">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-sm font-medium text-brand-600">
          <span className="pulse-dot h-2 w-2 rounded-full bg-[#1e8f6b]" />
          {stats.jobs > 0 && topCity ? `Now hiring in ${topCity}` : `Jobs for ${c.people}`}
        </div>

        <h1 className="mb-6 text-4xl font-extrabold leading-tight tracking-tight text-heading sm:text-5xl md:text-6xl">
          {c.headlineA} <span className="gradient-text">{c.headlineB}</span>
        </h1>
        <p className="mx-auto mb-9 max-w-2xl text-lg leading-relaxed text-text-muted md:text-xl">{c.sub}</p>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="#open-jobs"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-7 py-4 text-lg font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-800 hover:shadow-xl sm:w-auto">
            <Search className="h-5 w-5" /> {stats.jobs > 0 ? `See ${stats.jobs} open job${stats.jobs === 1 ? '' : 's'}` : 'See open jobs'}
          </Link>
          <Link href={joinHref}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-200 bg-white px-7 py-4 text-lg font-semibold text-brand-600 transition-colors hover:bg-brand-50 sm:w-auto">
            Create your free profile <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
        <p className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-brand-600" /> Free for {c.people}</span>
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-brand-600" /> No fees, ever</span>
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-brand-600" /> Works on your phone</span>
        </p>
      </div>

      {stats.jobs > 0 && (
        <div className="relative mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-2xl bg-border shadow-sm">
          {[
            { val: stats.jobs, label: stats.jobs === 1 ? 'Open job' : 'Open jobs' },
            { val: stats.centers, label: stats.centers === 1 ? 'Center hiring' : 'Centers hiring' },
            { val: stats.cities, label: stats.cities === 1 ? 'City' : 'Cities' },
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

/** The open jobs, as before: cities to browse, then every posting */
export function OpenJobs({ jobs, cities, roles, joinHref, sharePath }: {
  jobs: PublicJob[]
  cities: { slug: string; city: string; state: string | null; count: number }[]
  roles: Record<string, string>
  joinHref: string
  sharePath: string
}) {
  return (
    <section id="open-jobs" className="scroll-mt-24 border-t border-border bg-white px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-heading">Open jobs</h2>
            <p className="mt-1 text-muted">Regular full-time and part-time positions at local centers.</p>
          </div>
          <ShareJobsButton path={sharePath} />
        </div>

        {cities.length > 0 && (
          <div className="mb-8">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted">Browse by city</h3>
            <div className="flex flex-wrap gap-2">
              {cities.map(c => (
                <Link key={c.slug} href={`/jobs/in/${c.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-50">
                  <MapPin className="h-4 w-4" /> {c.city}{c.state ? `, ${c.state}` : ''} <span className="text-muted">({c.count})</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {jobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center text-muted">
            No open jobs right now. <Link href={joinHref} className="font-semibold text-brand-600 hover:underline">Create a free profile</Link> and turn on job alerts to hear about new ones first.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {jobs.map(job => <PublicJobCard key={job.id} job={job} roleLabel={job.role_value ? roles[job.role_value] : undefined} />)}
          </div>
        )}
      </div>
    </section>
  )
}

/** Why people use CareLocal to find work */
export function WhyCareLocal({ domain }: { domain: DomainKey }) {
  const c = JOBS_COPY[domain]
  const reasons = [
    { icon: UserRound, title: 'One profile, every center', desc: 'Your resume, certifications and references live in one place. No more filling out the same forms for each center.' },
    { icon: Briefcase, title: 'Apply in one tap', desc: 'Your profile and documents go with each application, and you can track every application in one place.' },
    { icon: CalendarCheck, title: `Pick your ${c.subWord} days`, desc: c.subPitch },
    { icon: FileCheck2, title: 'Documents ready to go', desc: `Upload ${c.docs} once from your phone and see what is about to expire before it holds you up.` },
    { icon: BellRing, title: 'Hear about jobs first', desc: 'Turn on job alerts for your city and role, and get a notification when a match is posted.' },
    { icon: HandCoins, title: 'Free, for real', desc: `No subscription and no per-shift fees for ${c.people}. Centers pay for CareLocal, not you.` },
  ]
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold text-heading md:text-4xl">Why {c.people} use CareLocal</h2>
          <p className="mx-auto max-w-2xl text-lg text-muted">Less paperwork, more choice, and no middleman taking a cut.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {reasons.map(r => (
            <div key={r.title} className="rounded-2xl border border-border bg-white p-6 shadow-sm">
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><r.icon className="h-5 w-5" /></span>
              <h3 className="mb-1.5 text-lg font-bold text-heading">{r.title}</h3>
              <p className="text-[15px] leading-relaxed text-text-muted">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Three steps, then the two ways to work */
export function HowItWorks({ domain, joinHref }: { domain: DomainKey; joinHref: string }) {
  const c = JOBS_COPY[domain]
  const steps = [
    { icon: Smartphone, title: 'Create your free profile', desc: 'Sign up on your phone with your experience and the roles you want.' },
    { icon: FileCheck2, title: 'Add your documents once', desc: `Snap ${c.docs}. They are ready for every center.` },
    { icon: MessageSquareText, title: 'Apply or pick up shifts', desc: `Apply to open jobs in one tap, or claim ${c.subWord} shifts that come by text.` },
  ]
  return (
    <section className="bg-brand-900 px-6 py-20 text-white">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-12 text-center text-3xl font-bold md:text-4xl">How it works</h2>
        <ol className="grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400 text-base font-extrabold text-heading">{i + 1}</span>
                <s.icon className="h-5 w-5 text-brand-200" />
              </div>
              <h3 className="mb-1.5 text-lg font-bold">{s.title}</h3>
              <p className="text-[15px] leading-relaxed text-white/75">{s.desc}</p>
            </li>
          ))}
        </ol>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-7 text-heading">
            <Briefcase className="mb-3 h-7 w-7 text-brand-600" />
            <h3 className="mb-2 text-xl font-bold">Looking for a steady job?</h3>
            <p className="mb-5 text-text-muted">Browse full-time and part-time openings, apply in one tap, and set job alerts so you never miss a new one.</p>
            <Link href="#open-jobs" className="inline-flex items-center gap-2 font-semibold text-brand-600 hover:text-brand-800">See open jobs <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <div className="rounded-2xl bg-white p-7 text-heading">
            <CalendarCheck className="mb-3 h-7 w-7 text-brand-600" />
            <h3 className="mb-2 text-xl font-bold">Want flexible {c.subWord} work?</h3>
            <p className="mb-5 text-text-muted">{c.subPitch} Work at more than one center, on your schedule.</p>
            <Link href={joinHref} className="inline-flex items-center gap-2 font-semibold text-brand-600 hover:text-brand-800">Join as a {c.subWord} <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </div>
      </div>
    </section>
  )
}

export function JobsFaq({ domain }: { domain: DomainKey }) {
  return (
    <section className="border-t border-border bg-white px-6 py-20">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-10 text-center text-3xl font-bold text-heading md:text-4xl">Questions</h2>
        <div className="divide-y divide-border rounded-2xl border border-border">
          {jobsFaq(domain).map(f => (
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

/** Centers that land here from a shared link: one line to the center side */
export function HiringStrip() {
  return (
    <section className="border-t border-border bg-surface px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
        <div className="flex items-center gap-3">
          <ShieldCheck className="hidden h-8 w-8 shrink-0 text-brand-600 sm:block" />
          <div>
            <p className="text-lg font-bold text-heading">Hiring at your center?</p>
            <p className="text-muted">Post openings, review applicants with their documents, and fill shifts by text.</p>
          </div>
        </div>
        <Link href="/centers" className="shrink-0 rounded-xl border border-brand-200 bg-white px-5 py-3 font-semibold text-brand-600 hover:bg-brand-50">For centers</Link>
      </div>
    </section>
  )
}

export function FinalCta({ joinHref }: { joinHref: string }) {
  return (
    <section className="bg-brand-600 px-6 py-20 text-center">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-4 text-3xl font-extrabold text-white md:text-4xl">Your next job is a profile away</h2>
        <p className="mb-8 text-lg text-white/85">Join free, add your documents once, and apply to jobs near you from your phone.</p>
        <Link href={joinHref} className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-lg font-semibold text-brand-700 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl">
          Create your free profile <ArrowRight className="h-5 w-5" />
        </Link>
      </div>
    </section>
  )
}
