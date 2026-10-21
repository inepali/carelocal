import Link from 'next/link'
import type { DomainKey } from '@/lib/domain-config'
import { getDomainConfig } from '@/lib/domain-config'
import { formatPay, EMPLOYMENT_TYPE_LABELS } from '@/lib/jobs'
import type { PublicJob } from '@/lib/server/public-jobs'
import { MapPin, Briefcase, ChevronRight } from 'lucide-react'

/** Header + footer for the public job pages */
export function JobsShell({ domain, children }: { domain: DomainKey; children: React.ReactNode }) {
  const config = getDomainConfig(domain)
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <nav className="glass border-b border-border">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2" aria-label={config.appName}>
            {domain === 'childcare' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/logo.png" alt={config.appName} width={64} height={64} className="h-16 w-16 rounded-xl object-contain" />
            ) : (
              <>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">{config.logoShort}</span>
                <span className="text-lg font-bold text-brand-800">{config.appName}</span>
              </>
            )}
          </Link>
          <div className="flex items-center gap-5 text-sm font-medium">
            <Link href="/jobs" className="text-muted hover:text-brand-600">Jobs</Link>
            <Link href="/login" className="text-brand-600 hover:text-brand-800">Log in</Link>
            <Link href="/register?type=staff" className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white shadow-sm hover:bg-brand-800">Join free</Link>
          </div>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm text-muted">
          <span>© {new Date().getFullYear()} {config.appName}</span>
          <div className="flex gap-4">
            <Link href="/jobs" className="hover:text-brand-600">All jobs</Link>
            <Link href="/contact" className="hover:text-brand-600">Contact</Link>
            <Link href="/privacy" className="hover:text-brand-600">Privacy</Link>
            <Link href="/terms" className="hover:text-brand-600">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

/** The public URL of a job */
export const jobPath = (job: Pick<PublicJob, 'slug' | 'center'>) => `/jobs/${job.center.slug}/${job.slug}`

/** "child care", "healthcare", "senior care" */
export function verticalNoun(domain: DomainKey) {
  return domain === 'healthcare' ? 'healthcare' : domain === 'senior' ? 'senior care' : 'child care'
}

/** A job in a public list */
export function PublicJobCard({ job, roleLabel }: { job: PublicJob; roleLabel?: string }) {
  return (
    <Link href={jobPath(job)} className="flex items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Briefcase className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-bold text-heading">{job.title}</h3>
        <p className="text-sm text-muted">
          {job.center.name}
          {job.center.city && <span className="ml-2 inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{job.center.city}{job.center.state ? `, ${job.center.state}` : ''}</span>}
        </p>
        <p className="mt-1 text-sm text-text-muted">
          {[EMPLOYMENT_TYPE_LABELS[job.employment_type], roleLabel, formatPay(job)].filter(Boolean).join(' · ')}
        </p>
      </div>
      <ChevronRight className="h-5 w-5 text-subtle" />
    </Link>
  )
}
