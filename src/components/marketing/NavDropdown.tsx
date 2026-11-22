import Link from 'next/link'
import { ChevronDown, ExternalLink, type LucideIcon } from 'lucide-react'

export interface NavDropdownItem {
  name: string
  href: string
  tagline?: string
  Icon?: LucideIcon
  comingSoon?: boolean
}

interface NavDropdownProps {
  label: string
  items: NavDropdownItem[]
  /** When set, the trigger is a link (e.g. "#features") instead of a plain button. */
  href?: string
}

/**
 * Header dropdown for the marketing nav. CSS-only (hover / keyboard focus),
 * so it works inside server components. Colors follow the active vertical's brand tokens.
 */
export function NavDropdown({ label, items, href }: NavDropdownProps) {
  const triggerClass =
    'flex items-center gap-1 hover:text-brand-600 group-focus-within:text-brand-600 transition-colors'
  const chevron = (
    <ChevronDown className="w-4 h-4 transition-transform group-hover:rotate-180 group-focus-within:rotate-180" />
  )

  return (
    <div className="relative group">
      {href ? (
        <Link href={href} aria-haspopup="true" className={triggerClass}>
          {label}
          {chevron}
        </Link>
      ) : (
        <button type="button" aria-haspopup="true" className={triggerClass}>
          {label}
          {chevron}
        </button>
      )}

      {/* pt-3 bridges the gap so the menu stays open while the pointer moves into it */}
      <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 top-full pt-3 z-50">
        <div className="w-80 rounded-2xl border border-brand-100 bg-white p-2 shadow-xl shadow-brand-900/10">
          {items.map(({ name, tagline, href: itemHref, Icon, comingSoon }) => {
            const external = /^https?:\/\//.test(itemHref)
            const content = (
              <>
                {Icon && (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <Icon className="h-5 w-5" />
                  </span>
                )}
                <span>
                  <span className="flex items-center gap-2 font-semibold text-brand-900">
                    {name}
                    {external && <ExternalLink className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />}
                    {comingSoon && (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-700">Soon</span>
                    )}
                  </span>
                  {tagline && <span className="mt-0.5 block text-xs font-normal leading-5 text-brand-700">{tagline}</span>}
                </span>
              </>
            )
            const className = 'flex items-start gap-3 rounded-xl p-3 hover:bg-brand-50 focus:bg-brand-50 focus:outline-none transition-colors'
            return external ? (
              <a key={name} href={itemHref} target="_blank" rel="noopener noreferrer" className={className} aria-label={`${name} (opens in a new tab)`}>
                {content}
              </a>
            ) : (
              <Link key={name} href={itemHref} className={className}>
                {content}
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
