import Link from 'next/link'
import { ChevronRight, MapPin } from 'lucide-react'
import type { PublicCenterSummary } from '@/lib/server/public-center'
import { centerPath, clip, placeOf } from '@/lib/center-seo'

/** A center in a public list (directory and city pages) */
export function CenterCard({ center }: { center: PublicCenterSummary }) {
  const place = placeOf(center)
  return (
    <Link href={centerPath(center.handle)} className="flex items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-bold text-heading">{center.name}</h2>
        {place && <p className="mt-0.5 flex items-center gap-1 text-sm text-muted"><MapPin className="h-3.5 w-3.5" aria-hidden />{place}</p>}
        {center.programNames.length > 0 && <p className="mt-1 text-sm font-semibold text-brand-600">{center.programNames.slice(0, 3).join(' · ')}</p>}
        {center.description && <p className="mt-1 text-sm text-text-muted">{clip(center.description, 140)}</p>}
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-subtle" aria-hidden />
    </Link>
  )
}
