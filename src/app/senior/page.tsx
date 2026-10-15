import type { Metadata } from 'next'
import Link from 'next/link'
import { ProductsMenu } from '@/components/marketing/ProductsMenu'
import { ComplianceSuite } from '@/components/marketing/ComplianceSuite'
import { ArrowRight, ChevronDown, Clock, FileText, ShieldCheck, Users, Zap } from 'lucide-react'
import { StructuredData } from '@/components/marketing/StructuredData'
import { getDomainConfig } from '@/lib/domain-config'

const config = getDomainConfig('senior')


export const metadata: Metadata = {
  title: { absolute: config.title },
  description: config.description,
  // Served at "/" of its own domain; the vertical path redirects there
  alternates: { canonical: '/' },
}

const featureIcons = [Zap, FileText, Users, ShieldCheck]

export default function SeniorHomePage() {
  return (
    <main className="min-h-screen bg-surface text-brand-900">
      <StructuredData vertical="senior" faqs={config.faqs} plans={config.pricing} />
      <nav className="glass border-b border-brand-100">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">{config.logoShort}</span>
            <span className="text-lg font-bold">{config.appName}</span>
          </Link>
          <div className="flex items-center gap-4">
            <div className="hidden md:block text-sm font-semibold text-brand-700"><ProductsMenu /></div>
            <Link href="/login" className="text-sm font-semibold text-brand-700 hover:text-brand-600">Log in</Link>
            <Link href="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">Start free</Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
        <div>
          <p className="mb-4 text-sm font-bold uppercase tracking-[0.16em] text-brand-600">{config.hero.tagline}</p>
          <h1 className="max-w-3xl text-5xl font-black leading-tight md:text-6xl">{config.hero.title}<span className="text-brand-600">{config.hero.titleHighlight}</span></h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-brand-700">{config.hero.subtitle}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-800">{config.hero.ctaPrimary}<ArrowRight className="h-4 w-4" /></Link>
            <Link href="/login" className="rounded-xl border border-brand-200 px-6 py-3 font-semibold text-brand-700 hover:bg-brand-50">{config.hero.ctaSecondary}</Link>
          </div>
          <p className="mt-5 text-sm text-brand-600">{config.hero.footnote}</p>
        </div>
        <div className="rounded-3xl border border-brand-100 bg-white p-8 shadow-xl shadow-brand-900/5">
          <div className="mb-6 flex items-center gap-3"><Clock className="h-6 w-6 text-brand-600" /><h2 className="text-xl font-bold">Coverage when it matters</h2></div>
          <div className="space-y-4">
            {config.howItWorks.map((step) => <div key={step.step} className="flex gap-4 border-b border-brand-50 pb-4 last:border-0"><span className="font-mono text-sm font-bold text-brand-500">{step.step}</span><div><h3 className="font-bold">{step.title}</h3><p className="mt-1 text-sm leading-6 text-brand-700">{step.desc}</p></div></div>)}
          </div>
        </div>
      </section>

      <section className="border-y border-brand-100 bg-white/70">
        <div className="mx-auto grid max-w-6xl gap-5 px-6 py-14 md:grid-cols-2 lg:grid-cols-4">
          {config.features.map((feature, index) => { const Icon = featureIcons[index]; return <article key={feature.title} className="rounded-2xl border border-brand-100 bg-white p-6"><Icon className="h-6 w-6 text-brand-600" /><h2 className="mt-4 font-bold">{feature.title}</h2><p className="mt-2 text-sm leading-6 text-brand-700">{feature.desc}</p></article> })}
        </div>
      </section>
      <ComplianceSuite vertical="senior" />

      <section id="faq" className="border-t border-brand-100 bg-white px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-10 text-center text-4xl font-bold text-brand-900">Frequently Asked Questions</h2>
          <div className="divide-y divide-brand-100">
            {config.faqs.map(faq => (
              <details key={faq.q} className="group py-6 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer items-center justify-between focus:outline-none">
                  <h3 className="pr-4 text-lg font-bold text-brand-900">{faq.q}</h3>
                  <ChevronDown className="h-5 w-5 shrink-0 text-brand-600 transition duration-300 group-open:-rotate-180" />
                </summary>
                <p className="mt-4 leading-relaxed text-brand-700">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-brand-900 px-6 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-brand-100 md:flex-row">
          <span className="font-semibold text-white">{config.appName}</span>
          <div className="flex gap-6">
            <Link href="/register" className="hover:text-white">Start free trial</Link>
            <Link href="/contact" className="hover:text-white">Contact</Link>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
          </div>
          <span>© {new Date().getFullYear()} {config.appName}. All rights reserved.</span>
        </div>
      </footer>
    </main>
  )
}
