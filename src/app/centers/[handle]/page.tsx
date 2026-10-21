import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import { BadgeCheck, BookOpen, Briefcase, Clock, ExternalLink, Mail, MapPin, Navigation, Phone, Star, Users } from 'lucide-react'
import { getDomainKey, getDomainConfig } from '@/lib/domain-config'
import { getPublicCenter, listNearbyCenters } from '@/lib/server/public-center'
import { citySlug, listPublicJobsForCenter, publicRoleLabels } from '@/lib/server/public-jobs'
import {
  capitalize, centerCrumbs, centerDescription, centerJsonLd, centerPath, centerTitle, centerUrl, cityPath, jsonLdString, nounFor, placeOf,
} from '@/lib/center-seo'
import { JobsShell, PublicJobCard } from '@/app/jobs/_components/JobsShell'
import { ScheduleTourButton } from './_components/ScheduleTourButton'

type Props = { params: Promise<{ handle: string }> }

async function siteDomain() {
  return getDomainKey((await headers()).get('host') || '')
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  const domain = await siteDomain()
  const center = await getPublicCenter(domain, handle)
  if (!center) return { title: 'Center not found', robots: { index: false, follow: false } }

  const jobs = await listPublicJobsForCenter(domain, center.slug)
  const title = centerTitle(center, domain)
  const description = centerDescription(center, domain, jobs.length)
  const canonical = centerUrl(domain, center.handle)
  return {
    // The brand suffix would push the name, category and city past what search results show
    title: { absolute: title },
    description,
    alternates: { canonical },
    // A page with nothing to read yet stays out of search until the center adds a description or a program
    robots: center.thin ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: {
      title, description, url: canonical, type: 'website', locale: 'en_US', siteName: getDomainConfig(domain).appName,
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

const SECTION = 'rounded-2xl border border-border bg-white p-8 shadow-sm'
const SECTION_TITLE = 'mb-4 flex items-center gap-2 text-lg font-bold text-text-main'

/** Public: a center that turned its page on. Programs, team, about and open jobs; contact details only as the center allows. */
export default async function PublicCenterPage({ params }: Props) {
  const { handle } = await params
  const domain = await siteDomain()
  const center = await getPublicCenter(domain, handle)
  if (!center) notFound()
  // One address per page: /centers/Kiddie-Academy is the same page as /centers/kiddie-academy
  if (handle !== center.handle) permanentRedirect(centerPath(center.handle))

  const [jobs, roleLabels, nearby] = await Promise.all([
    listPublicJobsForCenter(domain, center.slug),
    publicRoleLabels(domain),
    listNearbyCenters(domain, center.city, center.state, center.handle),
  ])
  const noun = nounFor(domain)
  const place = placeOf(center)
  const street = [center.address, place, center.zip].filter(Boolean).join(', ')
  const mapsUrl = street ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${center.name}, ${street}`)}` : null
  const crumbs = centerCrumbs(center, domain)
  const jsonLd = jsonLdString(centerJsonLd(center, domain, centerTitle(center, domain), centerDescription(center, domain, jobs.length)))

  return (
    <JobsShell domain={domain}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <article className="mx-auto max-w-4xl space-y-6 px-6 py-10">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            {crumbs.map((crumb, i) => (
              <li key={crumb.path} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden>›</span>}
                {i === crumbs.length - 1
                  ? <span aria-current="page" className="font-semibold text-text-main">{crumb.name}</span>
                  : <Link href={crumb.path} className="hover:text-brand-600 hover:underline">{crumb.name}</Link>}
              </li>
            ))}
          </ol>
        </nav>

        <header className="rounded-[2rem] border-2 border-border bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            {center.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={center.logoUrl} alt={`${center.name} logo`} width={80} height={80} decoding="async" className="h-20 w-20 shrink-0 rounded-2xl border border-border object-contain bg-white" />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-black tracking-tight text-heading">{center.name}</h1>
              <p className="mt-1 text-base font-semibold text-brand-600">{capitalize(noun)} center{place ? ` in ${place}` : ''}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
                {street && <address className="inline-flex items-center gap-1.5 not-italic"><MapPin className="h-4 w-4 shrink-0" aria-hidden />{street}</address>}
                {center.careScore && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700" title="Average rating from the staff who have worked here">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
                    {center.careScore.average.toFixed(1)} Care Score <span className="font-normal text-muted">({center.careScore.count} rating{center.careScore.count === 1 ? '' : 's'})</span>
                  </span>
                )}
                {center.licenseNumber && <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />License {center.licenseNumber}</span>}
              </div>
              {(center.phone || center.email) && (
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  {center.phone && <a href={`tel:${center.phone}`} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline"><Phone className="h-4 w-4" aria-hidden />{center.phone}</a>}
                  {center.email && <a href={`mailto:${center.email}`} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline"><Mail className="h-4 w-4" aria-hidden />{center.email}</a>}
                </div>
              )}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {center.toursEnabled && <ScheduleTourButton handle={center.handle} centerName={center.name} domain={domain} />}
            {jobs.length > 0 && <a href="#jobs" className={center.toursEnabled ? 'rounded-xl border-2 border-brand-600/20 bg-white px-6 py-3 text-sm font-black text-brand-600 hover:border-brand-600' : 'rounded-xl bg-brand-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-brand-600/20 hover:bg-brand-800'}>See {jobs.length} open job{jobs.length === 1 ? '' : 's'}</a>}
            <Link href={`/register?invite=${encodeURIComponent(center.slug)}`} rel="nofollow" className="rounded-xl border-2 border-brand-600/20 bg-white px-6 py-3 text-sm font-black text-brand-600 hover:border-brand-600">Join this center</Link>
            {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${center.name}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-brand-600"><Navigation className="h-4 w-4" aria-hidden /> Directions</a>}
          </div>
        </header>

        {(center.description || center.about.length > 0) && (
          <section aria-labelledby="about-heading" className={SECTION}>
            <h2 id="about-heading" className={SECTION_TITLE}>About {center.name}</h2>
            {center.description && <p className="whitespace-pre-line leading-relaxed text-text-muted">{center.description}</p>}
            {center.about.length > 0 && (
              <div className={`space-y-5 ${center.description ? 'mt-6 border-t border-border pt-6' : ''}`}>
                {center.about.map(item => (
                  <div key={item.id}>
                    <h3 className="font-bold text-text-main">{item.title}</h3>
                    {item.content && <p className="mt-1 whitespace-pre-line leading-relaxed text-text-muted">{item.content}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {center.programs.length > 0 && (
          <section aria-labelledby="programs-heading" className={SECTION}>
            <h2 id="programs-heading" className={SECTION_TITLE}><BookOpen className="h-5 w-5 text-brand-600" aria-hidden /> Programs at {center.name}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {center.programs.map(p => (
                <div key={p.id} className="rounded-xl border border-border bg-surface p-5">
                  <h3 className="font-bold text-heading">{p.name}</h3>
                  <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                    {p.ageRange && <span className="rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 font-semibold text-brand-600">{p.ageRange}</span>}
                    {p.capacity != null && <span className="rounded-full border border-border bg-white px-2.5 py-1 text-text-muted">Up to {p.capacity}</span>}
                  </div>
                  {p.schedule && <p className="mt-2 flex items-center gap-1.5 text-sm text-muted"><Clock className="h-4 w-4 shrink-0" aria-hidden />{p.schedule}</p>}
                  {p.description && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-muted">{p.description}</p>}
                  {p.moreInfoUrl && (
                    <a href={p.moreInfoUrl} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Learn more about ${p.name}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
                      Learn more <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {center.team.length > 0 && (
          <section aria-labelledby="team-heading" className={SECTION}>
            <h2 id="team-heading" className={SECTION_TITLE}><Users className="h-5 w-5 text-brand-600" aria-hidden /> Our team</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              {center.team.map(t => {
                const heading = t.title || (t.role ? roleLabels[t.role] : null)
                return (
                  <div key={t.id}>
                    <h3 className="font-bold text-text-main">{t.name}</h3>
                    {heading && <p className="text-sm font-semibold text-brand-600">{heading}</p>}
                    {t.bio && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-text-muted">{t.bio}</p>}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {jobs.length > 0 && (
          <section id="jobs" aria-labelledby="jobs-heading" className="scroll-mt-24">
            <h2 id="jobs-heading" className={SECTION_TITLE}><Briefcase className="h-5 w-5 text-brand-600" aria-hidden /> Open jobs at {center.name}</h2>
            <div className="space-y-3">
              {jobs.map(job => <PublicJobCard key={job.id} job={job} roleLabel={job.role_value ? roleLabels[job.role_value] : undefined} />)}
            </div>
            {place && (
              <p className="mt-3 text-sm">
                <Link href={`/jobs/in/${citySlug(center.city, center.state)}`} className="font-semibold text-brand-600 hover:underline">See all {noun} jobs in {place}</Link>
              </p>
            )}
          </section>
        )}

        {(nearby.length > 0 || place) && (
          <section aria-labelledby="nearby-heading" className={SECTION}>
            <h2 id="nearby-heading" className="mb-3 text-lg font-bold text-text-main">{place ? `More ${noun} centers in ${place}` : `More ${noun} centers`}</h2>
            {nearby.length > 0 && (
              <ul className="mb-4 grid gap-2 sm:grid-cols-2">
                {nearby.map(n => (
                  <li key={n.handle}>
                    <Link href={centerPath(n.handle)} className="font-semibold text-brand-600 hover:underline">{n.name}</Link>
                    {n.programNames.length > 0 && <span className="text-sm text-muted"> · {n.programNames.slice(0, 2).join(', ')}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
              {place && <Link href={cityPath(center)} className="text-brand-600 hover:underline">All {noun} centers in {place}</Link>}
              <Link href="/centers" className="text-brand-600 hover:underline">Browse all centers</Link>
            </div>
          </section>
        )}
      </article>
    </JobsShell>
  )
}
