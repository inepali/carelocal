import { getDomainConfig, type DomainKey } from '@/lib/domain-config'
import { jsonLd, siteUrl } from '@/lib/site'

/**
 * schema.org JSON-LD for a vertical's landing page: Organization, WebSite,
 * SoftwareApplication (with the plans shown on the page) and FAQPage (the FAQ shown
 * on the page — structured data must match visible content).
 * No ratings: only add AggregateRating once there are real, collected reviews.
 */
export function StructuredData({
  vertical,
  faqs,
  plans,
}: {
  vertical: DomainKey
  faqs: { q: string; a: string }[]
  plans: { name: string; price: number; desc: string }[]
}) {
  const config = getDomainConfig(vertical)
  const url = siteUrl(vertical)
  const orgId = `${url}/#organization`

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': orgId,
        name: config.appName,
        url,
        logo: `${url}/icon-512.png`,
        email: config.supportEmail,
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          email: config.supportEmail,
          url: `${url}/contact`,
          availableLanguage: 'English',
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${url}/#website`,
        name: config.appName,
        url,
        description: config.description,
        publisher: { '@id': orgId },
        inLanguage: 'en-US',
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${url}/#software`,
        name: config.appName,
        url,
        description: config.description,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        publisher: { '@id': orgId },
        offers: plans.map(plan => ({
          '@type': 'Offer',
          name: `${plan.name} plan`,
          description: plan.desc,
          price: plan.price,
          priceCurrency: 'USD',
          url: `${url}/register?plan=${plan.name.toLowerCase()}`,
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: plan.price,
            priceCurrency: 'USD',
            unitText: 'MONTH',
          },
        })),
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}/#faq`,
        mainEntity: faqs.map(faq => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: { '@type': 'Answer', text: faq.a },
        })),
      },
    ],
  }

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(graph) }} />
}
