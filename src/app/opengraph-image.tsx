import { ImageResponse } from 'next/og'
import { headers } from 'next/headers'
import { getDomainConfig, getDomainKey, type DomainKey } from '@/lib/domain-config'

// Social share card (Open Graph / X / LinkedIn / Slack previews), one per domain.
export const alt = 'CareLocal — staffing and compliance in one platform'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const CARD: Record<DomainKey, { bg: string; accent: string; headline: string; points: string[] }> = {
  childcare: {
    bg: '#0b3828', accent: '#74c3a8',
    headline: 'The all-in-one platform for childcare staffing and compliance',
    points: ['Fill shifts by text', 'Staff files & training', 'Inspections & vendors'],
  },
  healthcare: {
    bg: '#312e81', accent: '#a5b4fc',
    headline: 'Healthcare staffing and credentialing in one platform',
    points: ['Fill shifts by text', 'Credentials & competencies', 'Inspections & vendors'],
  },
  senior: {
    bg: '#0b3828', accent: '#74c3a8',
    headline: 'Caregiver staffing and compliance in one platform',
    points: ['Cover call-outs fast', 'Caregiver files & training', 'Inspections & vendors'],
  },
}

export default async function Image() {
  const domainKey = getDomainKey((await headers()).get('host') || '')
  const config = getDomainConfig(domainKey)
  const card = CARD[domainKey]

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: card.bg, padding: 72, color: 'white', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 16, background: '#ffffff22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 700 }}>
            {config.logoShort}
          </div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{config.appName}</div>
        </div>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 800, lineHeight: 1.1, maxWidth: 1000 }}>{card.headline}</div>
        <div style={{ display: 'flex', gap: 16 }}>
          {card.points.map(point => (
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
