import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { ArrowLeft, CalendarDays, Clock, MapPin } from 'lucide-react'
import { getDomainKey, getDomainConfig } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'
import { getPublicJob, publicRoleLabels, citySlug, type PublicJob } from '@/lib/server/public-jobs'
import { EMPLOYMENT_TYPE_LABELS, benefitLabel, formatPay } from '@/lib/jobs'
import { JobsShell, jobPath } from '../../_components/JobsShell'

type Props = { params: Promise<{ centerSlug: string; jobSlug: string }> }

async function siteDomain() {
  return getDomainKey((await headers()).get('host') || '')
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { centerSlug, jobSlug } = await params
  const domain = await siteDomain()
  const job = await getPublicJob(domain, centerSlug, jobSlug)
  if (!job) return { title: 'Job not found', robots: { index: false } }
  const place = [job.center.city, job.center.state].filter(Boolean).join(', ')
  return {
    title: `${job.title} at ${job.center.name}${place ? ` · ${place}` : ''}`,
    description: `${EMPLOYMENT_TYPE_LABELS[job.employment_type]} · ${formatPay(job)}. ${job.description.slice(0, 140)}`,
    alternates: { canonical: jobPath(job) },
    openGraph: { title: `${job.title} at ${job.center.name}`, type: 'website' },
  }
}

/** Google for Jobs structured data (https://developers.google.com/search/docs/appearance/structured-data/job-posting) */
function jobPostingJsonLd(job: PublicJob, baseUrl: string) {
  const unit = job.pay_unit === 'year' ? 'YEAR' : 'HOUR'
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description.split(/\n{2,}/).map(p => `<p>${p.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!)).replace(/\n/g, '<br>')}</p>`).join(''),
    datePosted: job.published_at ?? job.updated_at,
    employmentType: job.employment_type === 'full_time' ? 'FULL_TIME' : 'PART_TIME',
    hiringOrganization: {
      '@type': 'Organization',
      name: job.center.name,
      ...(job.center.logo_url ? { logo: job.center.logo_url } : {}),
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        ...(job.center.address ? { streetAddress: job.center.address } : {}),
        ...(job.center.city ? { addressLocality: job.center.city } : {}),
        ...(job.center.state ? { addressRegion: job.center.state } : {}),
        ...(job.center.zip ? { postalCode: job.center.zip } : {}),
        addressCountry: 'US',
      },
    },
    identifier: { '@type': 'PropertyValue', name: job.center.name, value: job.id },
    directApply: false,
    url: `${baseUrl}${jobPath(job)}`,
  }
  if (job.closes_at) data.validThrough = job.closes_at
  if (job.start_date) data.jobStartDate = job.start_date
  if (job.pay_min != null) {
    data.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: job.pay_max != null && Number(job.pay_max) !== Number(job.pay_min)
        ? { '@type': 'QuantitativeValue', minValue: Number(job.pay_min), maxValue: Number(job.pay_max), unitText: unit }
        : { '@type': 'QuantitativeValue', value: Number(job.pay_min), unitText: unit },
    }
  }
  return data
}

/** Public: one job, with JobPosting JSON-LD. Apply leads to sign-in / registration, then the apply sheet. */
export default async function PublicJobPage({ params }: Props) {
  const { centerSlug, jobSlug } = await params
  const domain = await siteDomain()
  const job = await getPublicJob(domain, centerSlug, jobSlug)
  if (!job) notFound()

  const roles = await publicRoleLabels(domain)
  const config = getDomainConfig(domain)
  const applyPath = `/staff/jobs/${job.id}?apply=1`
  const place = [job.center.city, job.center.state].filter(Boolean).join(', ')
  const jsonLd = JSON.stringify(jobPostingJsonLd(job, siteUrl(domain))).replace(/</g, '\\u003c')

  return (
    <JobsShell domain={domain}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <section className="mx-auto max-w-4xl px-6 py-12">
        <Link href={place ? `/jobs/in/${citySlug(job.center.city, job.center.state)}` : '/jobs'} className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-brand-600">
          <ArrowLeft className="h-4 w-4" /> {place ? `Jobs in ${place}` : 'All jobs'}
        </Link>

        <div className="mb-8 rounded-[2rem] border-2 border-border bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-black tracking-tight text-heading">{job.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-muted">
            <span className="font-bold text-text-main">{job.center.name}</span>
            {place && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{place}</span>}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full border border-brand-100 bg-brand-50 px-3 py-1 font-bold text-brand-600">{formatPay(job)}</span>
            <span className="rounded-full border border-border px-3 py-1 text-text-muted">{EMPLOYMENT_TYPE_LABELS[job.employment_type]}</span>
            {job.role_value && roles[job.role_value] && <span className="rounded-full border border-border px-3 py-1 text-text-muted">{roles[job.role_value]}</span>}
          </div>
          <div className="mt-4 flex flex-wrap gap-5 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />Starts {job.start_date ? new Date(`${job.start_date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'as soon as possible'}</span>
            {(job.schedule_summary || job.hours_per_week) && <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" />{[job.schedule_summary, job.hours_per_week ? `${job.hours_per_week} hrs/week` : null].filter(Boolean).join(' · ')}</span>}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href={`/login?redirect=${encodeURIComponent(applyPath)}`} className="rounded-xl bg-brand-600 px-8 py-3 text-sm font-black text-white shadow-lg shadow-brand-600/20 hover:bg-brand-800">Apply</Link>
            <span className="text-sm text-muted">New to {config.appName}? <Link href={`/register?type=staff&redirect=${encodeURIComponent(applyPath)}`} className="font-semibold text-brand-600 hover:underline">Create a free account</Link></span>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-white p-8 shadow-sm">
          <h2 className="mb-3 text-lg font-bold text-text-main">About the job</h2>
          <p className="whitespace-pre-line leading-relaxed text-text-muted">{job.description}</p>
          {job.benefits.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-sm font-bold uppercase tracking-widest text-muted">Benefits</h3>
              <div className="flex flex-wrap gap-1.5">
                {job.benefits.map(b => <span key={b} className="rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-xs text-brand-600">{benefitLabel(b)}</span>)}
              </div>
            </>
          )}
        </div>
      </section>
    </JobsShell>
  )
}
