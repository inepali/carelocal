import { ImageResponse } from 'next/og'
import { headers } from 'next/headers'
import { getDomainConfig, getDomainKey, type DomainKey } from '@/lib/domain-config'
import { listJobCities, listPublicJobs } from '@/lib/server/public-jobs'

// The share card for the jobs pages (ads, texts, Facebook, WhatsApp, LinkedIn). Job pages under /jobs use it too.
export const alt = 'Jobs on CareLocal: one free profile, apply in one tap'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const CARD: Record<DomainKey, { bg: string; accent: string; headline: string }> = {
  childcare: { bg: '#0a3d3a', accent: '#f4b860', headline: 'Find a child care job that fits your life' },
  healthcare: { bg: '#312e81', accent: '#a5b4fc', headline: 'Find a healthcare job that fits your life' },
  senior: { bg: '#0a3d3a', accent: '#f4b860', headline: 'Find a caregiving job that fits your life' },
}

export default async function Image() {
  const domainKey = getDomainKey((await headers()).get('host') || '')
  const config = getDomainConfig(domainKey)
  const card = CARD[domainKey]
  const [jobs, cities] = await Promise.all([
    listPublicJobs(domainKey).catch(() => []),
    listJobCities(domainKey).catch(() => []),
  ])
  const where = cities[0] ? `${cities[0].city}${cities[0].state ? `, ${cities[0].state}` : ''}` : null
  const badge = jobs.length > 0 ? `${jobs.length} open job${jobs.length === 1 ? '' : 's'}${where ? ` · ${where}` : ''}` : 'Now hiring'

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: card.bg, padding: 72, color: 'white', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ width: 72, height: 72, borderRadius: 16, background: '#ffffff22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 700 }}>
              {config.logoShort}
            </div>
            <div style={{ fontSize: 40, fontWeight: 700 }}>{config.appName}</div>
          </div>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, color: card.bg, background: card.accent, borderRadius: 999, padding: '12px 28px' }}>{badge}</div>
        </div>
        <div style={{ display: 'flex', fontSize: 72, fontWeight: 800, lineHeight: 1.08, maxWidth: 1000 }}>{card.headline}</div>
        <div style={{ display: 'flex', gap: 16 }}>
          {['Free profile', 'Apply in one tap', 'No fees, ever'].map(point => (
            <div key={point} style={{ display: 'flex', fontSize: 28, color: card.accent, border: `2px solid ${card.accent}66`, borderRadius: 999, padding: '10px 26px' }}>
              {point}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  )
}
