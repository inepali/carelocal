import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { BadgeCheck, BookOpen, Briefcase, Clock, ExternalLink, Mail, MapPin, Navigation, Phone, Star, Users } from 'lucide-react'
import { getDomainKey, type DomainKey } from '@/lib/domain-config'
import { siteUrl } from '@/lib/site'
import { getPublicCenter, type PublicCenterPage } from '@/lib/server/public-center'
import { listPublicJobsForCenter, publicRoleLabels } from '@/lib/server/public-jobs'
import { JobsShell, PublicJobCard } from '@/app/jobs/_components/JobsShell'

type Props = { params: Promise<{ handle: string }> }

async function siteDomain() {
  return getDomainKey((await headers()).get('host') || '')
}

const placeOf = (c: Pick<PublicCenterPage, 'city' | 'state'>) => [c.city, c.state].filter(Boolean).join(', ')

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  const center = await getPublicCenter(await siteDomain(), handle)
  if (!center) return { title: 'Center not found', robots: { index: false } }
  const place = placeOf(center)
  const summary = center.description?.slice(0, 155) || `${center.name}${place ? ` in ${place}` : ''}: programs, team and open jobs.`
  return {
    title: `${center.name}${place ? ` · ${place}` : ''}`,
    description: summary,
    alternates: { canonical: `/centers/${center.handle}` },
    openGraph: { title: center.name, description: summary, type: 'website' },
  }
}

/** schema.org: ChildCare for child care, LocalBusiness elsewhere. No rating markup (self-reviews are not eligible). */
function centerJsonLd(center: PublicCenterPage, domain: DomainKey) {
  return {
    '@context': 'https://schema.org',
    '@type': domain === 'childcare' ? 'ChildCare' : 'LocalBusiness',
    name: center.name,
    url: `${siteUrl(domain)}/centers/${center.handle}`,
    ...(center.description ? { description: center.description } : {}),
    ...(center.logoUrl ? { logo: center.logoUrl } : {}),
    ...(center.phone ? { telephone: center.phone } : {}),
    ...(center.email ? { email: center.email } : {}),
    address: {
      '@type': 'PostalAddress',
      ...(center.address ? { streetAddress: center.address } : {}),
      ...(center.city ? { addressLocality: center.city } : {}),
      ...(center.state ? { addressRegion: center.state } : {}),
      ...(center.zip ? { postalCode: center.zip } : {}),
      addressCountry: 'US',
    },
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

  const [jobs, roleLabels] = await Promise.all([listPublicJobsForCenter(domain, center.slug), publicRoleLabels(domain)])
  const place = placeOf(center)
  const street = [center.address, place, center.zip].filter(Boolean).join(', ')
  const mapsUrl = street ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${center.name}, ${street}`)}` : null
  const jsonLd = JSON.stringify(centerJsonLd(center, domain)).replace(/</g, '\\u003c')

  return (
    <JobsShell domain={domain}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <section className="mx-auto max-w-4xl space-y-6 px-6 py-12">
        <div className="rounded-[2rem] border-2 border-border bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            {center.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={center.logoUrl} alt="" width={80} height={80} className="h-20 w-20 shrink-0 rounded-2xl border border-border object-contain bg-white" />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-black tracking-tight text-heading">{center.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
                {street && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 shrink-0" />{street}</span>}
                {center.careScore && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700" title="Average rating from the staff who have worked here">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    {center.careScore.average.toFixed(1)} Care Score <span className="font-normal text-muted">({center.careScore.count} rating{center.careScore.count === 1 ? '' : 's'})</span>
                  </span>
                )}
                {center.licenseNumber && <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 shrink-0 text-brand-600" />License {center.licenseNumber}</span>}
              </div>
              {(center.phone || center.email) && (
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  {center.phone && <a href={`tel:${center.phone}`} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline"><Phone className="h-4 w-4" />{center.phone}</a>}
                  {center.email && <a href={`mailto:${center.email}`} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline"><Mail className="h-4 w-4" />{center.email}</a>}
                </div>
              )}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {jobs.length > 0 && <a href="#jobs" className="rounded-xl bg-brand-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-brand-600/20 hover:bg-brand-800">See {jobs.length} open job{jobs.length === 1 ? '' : 's'}</a>}
            <Link href={`/register?invite=${encodeURIComponent(center.slug)}`} className="rounded-xl border-2 border-brand-600/20 bg-white px-6 py-3 text-sm font-black text-brand-600 hover:border-brand-600">Join this center</Link>
            {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-brand-600"><Navigation className="h-4 w-4" /> Directions</a>}
          </div>
        </div>

        {(center.description || center.about.length > 0) && (
          <div className={SECTION}>
            <h2 className={SECTION_TITLE}>About {center.name}</h2>
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
          </div>
        )}

        {center.programs.length > 0 && (
          <div className={SECTION}>
            <h2 className={SECTION_TITLE}><BookOpen className="h-5 w-5 text-brand-600" /> Programs</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {center.programs.map(p => (
                <div key={p.id} className="rounded-xl border border-border bg-surface p-5">
                  <h3 className="font-bold text-heading">{p.name}</h3>
                  <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                    {p.ageRange && <span className="rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 font-semibold text-brand-600">{p.ageRange}</span>}
                    {p.capacity != null && <span className="rounded-full border border-border bg-white px-2.5 py-1 text-text-muted">Up to {p.capacity}</span>}
                  </div>
                  {p.schedule && <p className="mt-2 flex items-center gap-1.5 text-sm text-muted"><Clock className="h-4 w-4 shrink-0" />{p.schedule}</p>}
                  {p.description && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-muted">{p.description}</p>}
                  {p.moreInfoUrl && (
                    <a href={p.moreInfoUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
                      Learn more <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {center.team.length > 0 && (
          <div className={SECTION}>
            <h2 className={SECTION_TITLE}><Users className="h-5 w-5 text-brand-600" /> Our team</h2>
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
          </div>
        )}

        {jobs.length > 0 && (
          <div id="jobs" className="scroll-mt-24">
            <h2 className={SECTION_TITLE}><Briefcase className="h-5 w-5 text-brand-600" /> Open jobs at {center.name}</h2>
            <div className="space-y-3">
              {jobs.map(job => <PublicJobCard key={job.id} job={job} roleLabel={job.role_value ? roleLabels[job.role_value] : undefined} />)}
            </div>
          </div>
        )}
      </section>
    </JobsShell>
  )
}
