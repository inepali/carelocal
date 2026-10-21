import { ImageResponse } from 'next/og'
import { headers } from 'next/headers'
import { getDomainConfig, getDomainKey, type DomainKey } from '@/lib/domain-config'
import { getPublicCenter } from '@/lib/server/public-center'
import { capitalize, clip, nounFor, placeOf } from '@/lib/center-seo'

// Social share card for one center (Open Graph / X / LinkedIn / Slack previews): its name, category and place.
export const alt = 'Center on CareLocal'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const COLORS: Record<DomainKey, { bg: string; accent: string }> = {
  childcare: { bg: '#0a3d3a', accent: '#f4b860' },
  healthcare: { bg: '#312e81', accent: '#a5b4fc' },
  senior: { bg: '#0a3d3a', accent: '#f4b860' },
}

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const domain = getDomainKey((await headers()).get('host') || '')
  const config = getDomainConfig(domain)
  const color = COLORS[domain]
  const center = await getPublicCenter(domain, handle)

  const name = clip(center?.name ?? config.appName, 70)
  const place = center ? placeOf(center) : ''
  const category = center ? `${capitalize(nounFor(domain))} center${place ? ` in ${place}` : ''}` : config.title
  const chips = center
    ? [
        center.programs.length > 0 ? `${center.programs.length} program${center.programs.length === 1 ? '' : 's'}` : null,
        center.careScore ? `${center.careScore.average.toFixed(1)} ★ Care Score` : null,
        center.toursEnabled ? 'Tours available' : null,
      ].filter((chip): chip is string => !!chip)
    : []

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: color.bg, padding: 72, color: 'white', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: '#ffffff22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 700 }}>
            {config.logoShort}
          </div>
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 700 }}>{config.appName}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: name.length > 40 ? 64 : 84, fontWeight: 800, lineHeight: 1.05, maxWidth: 1050 }}>{name}</div>
          <div style={{ display: 'flex', fontSize: 38, color: color.accent, fontWeight: 600 }}>{category}</div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {chips.map(chip => (
            <div key={chip} style={{ display: 'flex', fontSize: 26, color: color.accent, border: `2px solid ${color.accent}66`, borderRadius: 999, padding: '10px 26px' }}>
              {chip}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  )
}
