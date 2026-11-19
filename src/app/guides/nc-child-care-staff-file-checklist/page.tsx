import type { Metadata, ResolvingMetadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { ArrowRight, CheckCircle2, ExternalLink } from 'lucide-react'
import { getDomainKey } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'
import { registerHref } from '@/lib/attribution'
import { breadcrumbJsonLd, jsonLdString } from '@/lib/center-seo'
import { shareTags } from '@/lib/jobs-seo'
import { JobsShell } from '@/app/jobs/_components/JobsShell'

/**
 * Public guide (childcare site only): the North Carolina staff file training items, written from the rule text
 * and linked to the official sources. Ranks for "NC child care staff file checklist" and leads into the trial.
 * Keep every claim tied to a source in SOURCES, and update REVIEWED when the rules are checked again
 * (the Child Care Commission was amending .1101 and .1102 in 2025–26).
 */
const PATH = '/guides/nc-child-care-staff-file-checklist'
const REVIEWED = 'November 12, 2026'
const TITLE = 'NC child care staff file checklist: required training and deadlines'
const DESCRIPTION = 'What North Carolina child care centers keep in each staff file: the 11 health and safety topics, CPR and First Aid, ITS-SIDS, playground safety and maltreatment training, with deadlines.'

const SOURCES = [
  { name: '10A NCAC 09 .1102 Health and Safety Training Requirements (Cornell LII)', url: 'https://www.law.cornell.edu/regulations/north-carolina/10A-N-C-Admin-Code-09-1102' },
  { name: 'NC DCDEE: Are you up-to-date on required Health and Safety Training?', url: 'https://ncchildcare.ncdhhs.gov/Whats-New/are-you-up-to-date-on-required-health-and-safety-training' },
  { name: 'NC DCDEE: Orientation, pre-service requirements and professional development planning', url: 'https://ncchildcare.ncdhhs.gov/Provider/Training-and-Professional-Development/Orientation-Pre-Service-Requirements-Professional-Development-Planning' },
  { name: 'NC DCDEE Child Care Center Handbook, Chapter 2: Staff (includes the Staff File Checklist reference)', url: 'https://ncchildcare.ncdhhs.gov/pdf_forms/center_chp2.pdf' },
  { name: 'NC OSBM: proposed amendments to .1101 and .1102 (volunteers and all substitutes)', url: 'https://www.osbm.nc.gov/documents/files/DHHS_2025-04-23/open' },
]

const TOPICS = [
  'Prevention and control of infectious diseases, including immunization',
  'Administration of medication, with standards for parental consent',
  'Prevention of and response to emergencies due to food and allergic reactions',
  'Building and physical premises safety (electrical hazards, bodies of water, vehicle traffic)',
  'Emergency preparedness and response planning for natural or man-caused events',
  'Handling and storage of hazardous materials and disposal of biocontaminants',
  'Precautions in transporting children, if applicable',
  'Prevention of shaken baby syndrome, abusive head trauma and child maltreatment',
  'CPR and First Aid',
  'Recognizing and reporting child abuse, neglect and maltreatment',
  'Prevention of sudden infant death syndrome and safe sleep practices',
]

const ITEMS = [
  { item: 'Health and safety training (the 11 topics above)', who: 'Administrators and staff with caregiving duties, including substitutes who work 10 or more days in 12 months', when: 'Within 1 year of employment (unless completed in the year before), then all topics again every 5 years through on-going training' },
  { item: 'CPR certification, age-appropriate', who: 'Staff who give direct care or go with children off premises', when: 'Within 90 days of employment; renew on or before it expires. No online-only courses' },
  { item: 'First Aid certification, age-appropriate', who: 'Staff who give direct care or go with children off premises', when: 'Within 90 days of employment; renew on or before it expires. No online-only courses' },
  { item: 'Recognizing and Responding to Suspicions of Child Maltreatment', who: 'The administrator and all staff', when: 'Within 90 days of employment' },
  { item: 'ITS-SIDS (infant/toddler safe sleep)', who: 'Anyone scheduled in the infant room, and the administrator in centers licensed for infants', when: 'Infant room staff within 2 months of starting there; administrators within 90 days of employment; every 3 years' },
  { item: 'Playground safety', who: 'At least one staff member', when: 'Within 6 months of employment or of the position becoming vacant. No online-only courses' },
  { item: 'Orientation and a professional development plan', who: 'Each new staff member', when: 'Completed with the administrator and kept in the personnel file' },
]

async function siteDomain() {
  return getDomainKey((await headers()).get('host') || '')
}

export async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const domain = await siteDomain()
  if (domain !== 'childcare') return { title: 'Not found', robots: { index: false, follow: false } }
  return {
    title: { absolute: `${TITLE} | CareLocal` },
    description: DESCRIPTION,
    alternates: { canonical: PATH },
    ...(await shareTags(parent, domain, { title: TITLE, description: DESCRIPTION, path: PATH })),
  }
}

export default async function NcStaffFileGuide({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const domain = await siteDomain()
  if (domain !== 'childcare') notFound()
  const joinHref = registerHref('center', await searchParams)
  const base = siteUrl(domain)
  const crumbs = [{ name: 'CareLocal', path: '/' }, { name: 'NC staff file checklist', path: PATH }]
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': `${base}${PATH}#article`,
        headline: TITLE,
        description: DESCRIPTION,
        url: `${base}${PATH}`,
        inLanguage: 'en-US',
        dateModified: new Date(REVIEWED).toISOString().slice(0, 10),
        publisher: { '@id': `${base}/#organization` },
        citation: SOURCES.map(s => s.url),
      },
      breadcrumbJsonLd(crumbs, domain, `${base}${PATH}#breadcrumb`),
    ],
  }

  return (
    <JobsShell domain={domain}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <article className="mx-auto max-w-3xl px-6 py-14">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
          <ol className="flex items-center gap-2">
            <li><Link href="/" className="hover:text-brand-600 hover:underline">CareLocal</Link></li>
            <li aria-hidden>›</li>
            <li aria-current="page" className="font-semibold text-text-main">NC staff file checklist</li>
          </ol>
        </nav>

        <p className="mb-3 text-sm font-bold uppercase tracking-widest text-brand-600">Guide for NC directors</p>
        <h1 className="mb-4 text-4xl font-extrabold leading-tight tracking-tight text-heading">{TITLE}</h1>
        <p className="mb-2 text-lg leading-relaxed text-text-muted">
          North Carolina&apos;s child care rules (10A NCAC 09) say which trainings each staff member needs, by when, and that proof
          goes in their staff file at the center. Here is the training side of the file in one place, with the rule it comes from.
        </p>
        <p className="mb-10 text-sm text-muted">Last reviewed {REVIEWED}. This is a summary, not legal advice: always check the current rule and your licensing consultant.</p>

        <section className="mb-12">
          <h2 className="mb-4 text-2xl font-bold text-heading">Training items, who needs them and when</h2>
          <div className="overflow-x-auto rounded-2xl border border-border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
                <tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Who</th><th className="px-4 py-3">Deadline and renewal</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ITEMS.map(i => (
                  <tr key={i.item} className="align-top">
                    <td className="px-4 py-3 font-semibold text-heading">{i.item}</td>
                    <td className="px-4 py-3 text-text-muted">{i.who}</td>
                    <td className="px-4 py-3 text-text-muted">{i.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">
            For each certificate (CPR, First Aid, ITS-SIDS, playground safety and maltreatment), the rule asks that proof of completion be kept in that
            staff member&apos;s file at the center.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-2xl font-bold text-heading">The 11 health and safety topics</h2>
          <ol className="space-y-2">
            {TOPICS.map((t, i) => (
              <li key={t} className="flex gap-3 rounded-xl border border-border bg-white px-4 py-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-600">{i + 1}</span>
                <span className="text-text-main">{t}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mb-12">
          <h2 className="mb-3 text-2xl font-bold text-heading">The rest of the staff file</h2>
          <p className="mb-3 leading-relaxed text-text-muted">
            Training is only part of a staff file. Items such as the employment application, criminal record check qualification, health
            records and education documentation are covered in DCDEE&apos;s Child Care Center Handbook, which points to a Staff File Checklist
            in its resource section. Use that checklist as the master list for your center.
          </p>
          <p className="leading-relaxed text-text-muted">
            Watch for rule changes: the Child Care Commission has proposed extending the health and safety training to volunteers and to all
            substitutes, whatever the number of days they work.
          </p>
        </section>

        <section className="mb-12 rounded-2xl bg-brand-900 p-8 text-white">
          <h2 className="mb-3 text-2xl font-bold">Keep every staff file current without the binder</h2>
          <ul className="mb-6 space-y-2 text-white/85">
            {[
              'Start from NC Staff and Substitute file checklists in one click, then adjust them',
              'Due dates from each start date, with annual, 5-year and on-expiry renewals',
              'Staff upload certificates from their phone and get reminders before they lapse',
              'One grid shows who needs what before your licensing visit',
            ].map(p => <li key={p} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />{p}</li>)}
          </ul>
          <Link href={joinHref} className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-semibold text-brand-700 hover:bg-brand-50">
            Start your 3-month free trial <ArrowRight className="h-5 w-5" />
          </Link>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-bold text-heading">Sources</h2>
          <ul className="space-y-2 text-sm">
            {SOURCES.map(s => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1.5 text-brand-600 hover:underline">
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {s.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </article>
    </JobsShell>
  )
}
