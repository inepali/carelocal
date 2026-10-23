import { notFound } from 'next/navigation'
import {
  Database, HardDrive, Mail, CreditCard, MessageSquare, CloudSun, Plus, ExternalLink, CheckCircle2, XCircle, CircleDashed,
  type LucideIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { INTEGRATIONS, supabaseEnvironment, type Integration } from '@/lib/integrations'

export const metadata = { title: 'System Settings' }

const ICONS: Record<string, LucideIcon> = {
  supabase: Database,
  r2: HardDrive,
  resend: Mail,
  stripe: CreditCard,
  twilio: MessageSquare,
  weather: CloudSun,
}

type Health = 'connected' | 'attention' | 'partial' | 'planned'

const BADGE: Record<Health, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'bg-emerald-100 text-emerald-700' },
  attention: { label: 'Needs setup', className: 'bg-rose-100 text-rose-700' },
  partial: { label: 'In progress', className: 'bg-amber-100 text-amber-700' },
  planned: { label: 'Planned', className: 'bg-slate-100 text-slate-500' },
}

/** Only whether each variable is set is ever read, never its value */
function assess(integration: Integration) {
  const set = (name: string) => Boolean(process.env[name])
  const missing = integration.env.filter(n => !set(n))
  // A service still being built is "in progress" whether or not its keys are set yet
  let health: Health
  if (integration.stage === 'planned') health = 'planned'
  else if (integration.stage === 'building') health = 'partial'
  else health = missing.length === 0 ? 'connected' : 'attention'
  return { health, missing, isSet: set }
}

export default async function AdminSettingsPage() {
  // The proxy already limits /admin to super admins; this keeps the page safe if that ever changes
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.app_metadata?.is_super_admin !== true) notFound()

  const cards = INTEGRATIONS.map(i => ({ integration: i, ...assess(i) }))
  const count = (h: Health) => cards.filter(c => c.health === h).length
  const environment = supabaseEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL)

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">System Settings</h1>
          <p className="text-slate-500 font-medium">The third-party services CareLocal runs on, and whether each one is set up on this server.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest">
          <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-700">{count('connected')} connected</span>
          {count('attention') > 0 && <span className="rounded-full bg-rose-100 px-3 py-1.5 text-rose-700">{count('attention')} need setup</span>}
          {count('partial') > 0 && <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-700">{count('partial')} in progress</span>}
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-500">{count('planned')} planned</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ integration, health, missing, isSet }) => {
          const Icon = ICONS[integration.id] ?? Database
          const badge = BADGE[health]
          return (
            <section key={integration.id} className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-base font-extrabold tracking-tight text-slate-900">{integration.name}</h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{integration.category}</p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${badge.className}`}>{badge.label}</span>
              </div>

              <p className="mb-4 text-sm font-medium text-slate-500">{integration.description}</p>

              {integration.id === 'supabase' && environment && (
                <p className="mb-4 text-xs font-bold text-slate-600">
                  This server is using the <span className={environment === 'Production' ? 'text-rose-600' : 'text-emerald-700'}>{environment}</span> database.
                </p>
              )}

              {integration.env.length + (integration.optionalEnv?.length ?? 0) > 0 && (
                <ul className="mb-4 space-y-1.5">
                  {integration.env.map(name => (
                    <EnvLine key={name} name={name} isSet={isSet(name)} planned={integration.stage === 'planned'} />
                  ))}
                  {(integration.optionalEnv ?? []).map(name => (
                    <EnvLine key={name} name={name} isSet={isSet(name)} planned={false} optional />
                  ))}
                </ul>
              )}

              {health === 'attention' && (
                <p className="mb-4 text-xs font-bold text-rose-600">Missing: {missing.join(', ')}</p>
              )}

              <div className="mt-auto pt-2">
                {integration.manageUrl ? (
                  <a href={integration.manageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" /> Open {integration.name} dashboard
                  </a>
                ) : (
                  <span className="text-xs font-semibold text-slate-300">No dashboard link yet</span>
                )}
              </div>
            </section>
          )
        })}

        <div className="flex min-h-[14rem] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 p-6 text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-50 text-slate-300"><Plus className="h-5 w-5" /></span>
          <h2 className="text-sm font-extrabold text-slate-500">More integrations</h2>
          <p className="mt-1 max-w-[16rem] text-xs font-medium text-slate-400">New services get a card here as they are connected.</p>
        </div>
      </div>

      <p className="text-xs font-medium text-slate-400">
        This page only shows whether a setting exists on this server. Keys and secrets are never displayed.
      </p>
    </div>
  )
}

function EnvLine({ name, isSet, planned, optional }: { name: string; isSet: boolean; planned: boolean; optional?: boolean }) {
  const Icon = isSet ? CheckCircle2 : planned || optional ? CircleDashed : XCircle
  const tone = isSet ? 'text-emerald-500' : planned || optional ? 'text-slate-300' : 'text-rose-500'
  return (
    <li className="flex items-center gap-2 text-xs">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} />
      <span className="truncate font-mono font-semibold text-slate-600">{name}</span>
      {optional && <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">optional</span>}
    </li>
  )
}
