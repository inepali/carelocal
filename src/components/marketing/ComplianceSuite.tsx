import {
  BellRing, CheckCircle, ClipboardCheck, Eye, FileStack, FolderLock, GraduationCap, Lock, PenLine, Send, ShieldCheck,
} from 'lucide-react'
import type { DomainKey } from '@/lib/domain-config'
import { COMPLIANCE_SUITE, type SuiteIcon } from '@/lib/marketing'

const ICONS: Record<SuiteIcon, React.ElementType> = {
  files: FileStack,
  request: Send,
  signature: PenLine,
  training: GraduationCap,
  inspection: ClipboardCheck,
  reminder: BellRing,
}

const SECURITY_ICONS = [Lock, FolderLock, Eye, ShieldCheck]

// Illustrative compliance grid (not real data)
const DEMO_ROWS: { name: string; cells: ('ok' | 'soon' | 'late' | 'review' | 'todo')[] }[] = [
  { name: 'Maria G.', cells: ['ok', 'ok', 'ok', 'soon', 'ok', 'ok', 'ok'] },
  { name: 'James T.', cells: ['ok', 'review', 'ok', 'ok', 'todo', 'ok', 'ok'] },
  { name: 'Aisha K.', cells: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'] },
  { name: 'Daniel R.', cells: ['ok', 'ok', 'late', 'ok', 'soon', 'todo', 'ok'] },
]

const DEMO_CELL: Record<string, string> = {
  ok: 'bg-emerald-500',
  soon: 'bg-amber-400',
  late: 'bg-red-500',
  review: 'bg-sky-500',
  todo: 'bg-slate-200',
}

/**
 * Landing-page section for the compliance & operations suite. Colors come from the
 * vertical's brand tokens, copy from COMPLIANCE_SUITE.
 */
export function ComplianceSuite({ vertical }: { vertical: DomainKey }) {
  const copy = COMPLIANCE_SUITE[vertical]

  return (
    <section id="compliance" className="py-24 px-6 bg-white border-y border-brand-100">
      <div className="max-w-6xl mx-auto">
        <div className="grid gap-12 lg:grid-cols-[1.05fr_.95fr] lg:items-center mb-16">
          <div>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-brand-600">{copy.eyebrow}</p>
            <h2 className="text-4xl md:text-5xl font-extrabold leading-tight text-brand-900 mb-5">
              {copy.title}<span className="text-brand-600">{copy.titleHighlight}</span>
            </h2>
            <p className="text-lg leading-relaxed text-brand-700">{copy.subtitle}</p>
          </div>

          {/* Illustrative compliance overview */}
          <div className="rounded-3xl border border-brand-100 bg-surface p-6 shadow-xl shadow-brand-900/5" aria-hidden="true">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-bold text-brand-900">Compliance overview</span>
              <span className="flex gap-1.5 text-[11px]">
                <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700">Overdue 1</span>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">Due soon 3</span>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">Review 1</span>
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-brand-100 bg-white">
              <div className="grid grid-cols-[96px_repeat(7,1fr)] border-b border-brand-100 bg-brand-50/60 px-3 py-2">
                <span />
                {copy.gridColumns.map(c => (
                  <span key={c} className="truncate text-center text-[10px] font-semibold text-brand-700">{c}</span>
                ))}
              </div>
              {DEMO_ROWS.map(row => (
                <div key={row.name} className="grid grid-cols-[96px_repeat(7,1fr)] items-center border-b border-brand-50 px-3 py-2.5 last:border-0">
                  <span className="truncate text-xs font-medium text-brand-900">{row.name}</span>
                  {row.cells.map((cell, i) => (
                    <span key={i} className={`mx-auto h-4 w-4 rounded ${DEMO_CELL[cell]}`} />
                  ))}
                </div>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-brand-700">Every {copy.people.slice(0, -1)}’s file, every requirement — at a glance.</p>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {copy.pillars.map(pillar => {
            const Icon = ICONS[pillar.icon]
            return (
              <article key={pillar.title} className="flex flex-col rounded-2xl border border-brand-100 bg-white p-6 transition-all hover:border-brand-500/40 hover:shadow-md">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mb-2 text-lg font-bold text-brand-900">{pillar.title}</h3>
                <p className="mb-4 text-sm leading-relaxed text-brand-700">{pillar.desc}</p>
                <ul className="mt-auto space-y-2">
                  {pillar.points.map(point => (
                    <li key={point} className="flex items-start gap-2 text-sm text-brand-900">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> {point}
                    </li>
                  ))}
                </ul>
              </article>
            )
          })}
        </div>

        <div className="mt-12 rounded-3xl bg-brand-900 p-8 md:p-10">
          <div className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h3 className="text-2xl font-bold text-white">Built for sensitive records</h3>
              <p className="text-sm text-brand-100/80">Personnel and health documents deserve more than a shared drive.</p>
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {copy.security.map((item, i) => {
              const Icon = SECURITY_ICONS[i % SECURITY_ICONS.length]
              return (
                <div key={item.title}>
                  <Icon className="mb-3 h-6 w-6 text-brand-100" />
                  <h4 className="mb-1 font-semibold text-white">{item.title}</h4>
                  <p className="text-sm leading-relaxed text-brand-100/80">{item.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
