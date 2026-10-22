import Link from 'next/link'
import type { ElementType, ReactNode } from 'react'
import type { DomainConfig } from '@/lib/domain-config'
import { LEGAL_UPDATED } from '@/lib/legal'

/** Page shell for the Terms & Conditions and the Privacy Policy: nav, title, white card, footer. */
export function LegalPage({ config, title, Icon, children }: { config: DomainConfig; title: string; Icon: ElementType; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface flex flex-col justify-between">
      <nav className="sticky top-0 z-50 glass border-b border-brand-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">{config.logoShort}</span>
            </div>
            <span className="font-bold text-brand-900 text-lg">{config.appName}</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-brand-700">
            <Link href="/#how-it-works" className="hover:text-brand-600 transition-colors">How it works</Link>
            <Link href="/#features" className="hover:text-brand-600 transition-colors">Features</Link>
            <Link href="/#pricing" className="hover:text-brand-600 transition-colors">Pricing</Link>
            <Link href="/contact" className="hover:text-brand-600 transition-colors">Contact</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-brand-600 hover:text-brand-800 transition-colors">Log in</Link>
            <Link href="/register" className="text-sm font-semibold bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-800 transition-colors shadow-sm">Get started free</Link>
          </div>
        </div>
      </nav>

      <main className="flex-grow py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12 text-center">
            <Icon className="w-16 h-16 text-brand-600 mx-auto mb-6" />
            <h1 className="text-4xl md:text-5xl font-black text-brand-900 mb-4 tracking-tight">{title}</h1>
            <p className="text-muted text-lg font-medium">Last updated: {LEGAL_UPDATED}</p>
          </div>

          <div className="bg-white rounded-[2rem] border-2 border-brand-100 p-8 md:p-12 shadow-xl shadow-brand-600/5">
            <div className="max-w-none">{children}</div>
            <div className="mt-12 pt-8 border-t border-brand-100 flex justify-center">
              <Link href="/" className="px-8 py-4 bg-surface text-brand-600 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-brand-50 transition-all border border-brand-100 flex items-center gap-2">
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </main>

      <footer className="py-12 px-6 bg-brand-900">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-brand-300">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">{config.logoShort}</span>
            </div>
            <span className="font-semibold text-white">{config.appName}</span>
          </div>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
          </div>
          <span>© {new Date().getFullYear()} {config.appName}. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}

/** A numbered section with an icon. `id` makes it linkable (for example /terms#sms). */
export function LegalSection({ id, Icon, title, children }: { id?: string; Icon: ElementType; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-10 scroll-mt-24">
      <div className="flex items-center gap-3 mb-4">
        <Icon className="w-6 h-6 text-brand-600 shrink-0" />
        <h2 className="text-2xl font-black text-brand-900 m-0">{title}</h2>
      </div>
      {children}
    </section>
  )
}

export function LegalP({ children }: { children: ReactNode }) {
  return <p className="text-brand-700 mb-4 leading-relaxed">{children}</p>
}

/** Lettered list: a short bold heading and a sentence or two under each. */
export function LegalItems({ items, tone = 'brand' }: { items: { title: string; body: ReactNode }[]; tone?: 'brand' | 'amber' }) {
  const badge = tone === 'amber' ? 'bg-amber-50 text-amber-800' : 'bg-brand-50 text-brand-600'
  return (
    <ul className="list-none pl-0 space-y-4 text-brand-700 mb-2">
      {items.map((item, i) => (
        <li key={item.title} className="flex gap-4">
          <span className={`shrink-0 w-6 h-6 rounded-full ${badge} flex items-center justify-center font-black text-xs`}>{String.fromCharCode(65 + i)}</span>
          <div>
            <strong className="text-brand-900 block mb-1">{item.title}</strong>
            <span className="leading-relaxed">{item.body}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
