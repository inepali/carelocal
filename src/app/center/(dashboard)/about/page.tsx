'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CenterProgram, CenterTeamMember, CenterAboutItem } from '@/lib/types'
import { Building2, BookOpen, Users, ListPlus, Clock, Mail, CreditCard, Database, ExternalLink, FileText, Globe } from 'lucide-react'
import CenterProfileTab from './_components/CenterProfileTab'
import AboutListEditor from './_components/AboutListEditor'
import SubscriptionTab from './_components/SubscriptionTab'
import ManageDataTab from './_components/ManageDataTab'
import DocumentsTab from './_components/DocumentsTab'
import PublicPageTab from './_components/PublicPageTab'
import { useLookups } from '@/hooks/use-lookups'
import { lookupLabel } from '@/lib/lookups'
import { normalizeWebUrl } from '@/lib/utils'

const TABS = [
  { id: 'profile', name: 'Center Profile', icon: Building2 },
  { id: 'programs', name: 'Programs', icon: BookOpen },
  { id: 'team', name: 'Team', icon: Users },
  { id: 'data', name: 'Manage Data', icon: Database },
  { id: 'documents', name: 'Documents', icon: FileText },
  { id: 'public', name: 'Public Page', icon: Globe },
  { id: 'subscription', name: 'Subscription', icon: CreditCard },
  { id: 'others', name: 'Others', icon: ListPlus },
] as const

type TabId = typeof TABS[number]['id']

export default function CenterAboutPage() {
  const supabase = createClient()
  // The dashboard layout renders children only after its client-side load, so reading the hash here is hydration-safe.
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash.replace('#', '')
    return TABS.find(t => t.id === hash)?.id ?? 'profile'
  })
  const [centerId, setCenterId] = useState<string | null>(null)
  // Roles from Manage Data → Roles
  const { data: roleLookups } = useLookups('Role')
  const roleOptions = roleLookups.filter(r => r.is_active).map(r => ({ value: r.value, label: r.label }))

  async function fetchCenterId() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    return (admin?.center_id as string | undefined) ?? null
  }

  // Follow #hash links into a tab (e.g. /center/about#subscription, or a hash set from inside a tab)
  useEffect(() => {
    function syncFromHash() {
      const hash = window.location.hash.replace('#', '')
      const tab = TABS.find(t => t.id === hash)
      if (tab) setActiveTab(tab.id)
    }
    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [])

  useEffect(() => {
    let ignore = false
    fetchCenterId().then(id => {
      if (!ignore) setCenterId(id)
    })
    return () => { ignore = true }
  }, [])

  function selectTab(id: TabId) {
    setActiveTab(id)
    window.history.replaceState(null, '', `#${id}`)
  }

  return (
    <div className="max-w-6xl pb-24">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-heading mb-2">About</h1>
        <p className="text-muted">Manage your center profile, programs, leadership team, and additional information.</p>
      </div>

      <div role="tablist" aria-label="About sections" className="flex gap-1 border-b border-border mb-10 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              id={`about-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`about-panel-${tab.id}`}
              onClick={() => selectTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 -mb-px border-b-[3px] text-sm whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-brand-600 text-heading font-bold'
                  : 'border-transparent text-muted font-medium hover:text-heading hover:border-brand-200'
              }`}
            >
              <tab.icon className={`w-4 h-4 ${isActive ? 'text-brand-600' : ''}`} />
              {tab.name}
            </button>
          )
        })}
      </div>

      {/* Panels stay mounted so unsaved profile edits survive switching tabs. */}
      <div role="tabpanel" id="about-panel-profile" aria-labelledby="about-tab-profile" hidden={activeTab !== 'profile'}>
        <CenterProfileTab />
      </div>

      {centerId && (
        <>
          <div role="tabpanel" id="about-panel-programs" aria-labelledby="about-tab-programs" hidden={activeTab !== 'programs'}>
            <AboutListEditor<CenterProgram & { [key: string]: unknown }>
              table="center_programs"
              centerId={centerId}
              itemLabel="Program"
              icon={BookOpen}
              description="List the programs your center offers, such as infant care, pre-K, or after-school."
              emptyTitle="No programs yet"
              emptyText="Add the programs your center offers so families and staff know what you provide."
              defaults={{ is_active: true }}
              fields={[
                { key: 'name', label: 'Program Name', placeholder: 'e.g. Pre-K Readiness', required: true },
                { key: 'age_range', label: 'Age Range', placeholder: 'e.g. 3–5 years', half: true },
                { key: 'capacity', label: 'Capacity', type: 'number', placeholder: 'e.g. 20', half: true },
                { key: 'schedule', label: 'Schedule', placeholder: 'e.g. Mon–Fri, 7:30am–5:30pm' },
                { key: 'description', label: 'Description', type: 'textarea', placeholder: 'What does this program include?' },
                { key: 'more_info_url', label: 'More Info Link', type: 'url', placeholder: 'e.g. https://www.yourcenter.com/pre-k' },
                { key: 'is_active', label: 'Currently offered', type: 'checkbox' },
              ]}
              renderItem={(program) => (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h3 className="text-lg font-black text-heading tracking-tight">{program.name}</h3>
                    {!program.is_active && (
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md text-[10px] font-bold uppercase tracking-widest">Inactive</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {program.age_range && (
                      <span className="inline-flex items-center px-2.5 py-1 bg-brand-50 text-brand-600 rounded-lg text-xs font-bold border border-[#bbf7d0]">{program.age_range}</span>
                    )}
                    {program.capacity != null && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-surface text-muted rounded-lg text-xs font-bold border border-border"><Users className="w-3 h-3" /> {program.capacity}</span>
                    )}
                  </div>
                  {program.schedule && (
                    <p className="flex items-center gap-1.5 text-xs text-muted font-medium mb-2"><Clock className="w-3.5 h-3.5" /> {program.schedule}</p>
                  )}
                  {program.description && <p className="text-sm text-text-muted leading-relaxed whitespace-pre-line">{program.description}</p>}
                  {normalizeWebUrl(program.more_info_url) && (
                    <a
                      href={normalizeWebUrl(program.more_info_url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-brand-600 hover:underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> More info
                    </a>
                  )}
                </>
              )}
            />
          </div>

          <div role="tabpanel" id="about-panel-team" aria-labelledby="about-tab-team" hidden={activeTab !== 'team'}>
            <AboutListEditor<CenterTeamMember & { [key: string]: unknown }>
              table="center_team_members"
              centerId={centerId}
              itemLabel="Team Member"
              icon={Users}
              description="Introduce your leadership team with short bios."
              emptyTitle="No team bios yet"
              emptyText="Add your director and leadership team so people can get to know who runs the center."
              fields={[
                { key: 'name', label: 'Full Name', placeholder: 'e.g. Jane Smith', required: true, half: true },
                { key: 'role', label: 'Role', type: 'select', placeholder: 'Select a role…', options: roleOptions, half: true },
                { key: 'email', label: 'Email', type: 'email', placeholder: 'Optional' },
                { key: 'bio', label: 'Bio', type: 'textarea', placeholder: 'Background, experience, and what they love about the work.' },
              ]}
              renderItem={(member) => (
                <>
                  <h3 className="text-lg font-black text-heading tracking-tight">{member.name}</h3>
                  {/* Older entries may only have the free-text title */}
                  {(member.role || member.title) && (
                    <p className="text-xs font-bold uppercase tracking-widest text-brand-600 mb-3">
                      {member.role ? lookupLabel(roleLookups, member.role) : member.title}
                    </p>
                  )}
                  {member.email && (
                    <a href={`mailto:${member.email}`} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-brand-600 font-medium mb-3"><Mail className="w-3.5 h-3.5" /> {member.email}</a>
                  )}
                  {member.bio && <p className="text-sm text-text-muted leading-relaxed whitespace-pre-line">{member.bio}</p>}
                </>
              )}
            />
          </div>

          <div role="tabpanel" id="about-panel-others" aria-labelledby="about-tab-others" hidden={activeTab !== 'others'}>
            <AboutListEditor<CenterAboutItem & { [key: string]: unknown }>
              table="center_about_items"
              centerId={centerId}
              itemLabel="Item"
              icon={ListPlus}
              layout="list"
              description="Add any other information about your center, such as philosophy, accreditations, meals, or policies."
              emptyTitle="No additional information yet"
              emptyText="Add free-form entries for anything that doesn't fit elsewhere."
              fields={[
                { key: 'title', label: 'Title', placeholder: 'e.g. Our Philosophy', required: true },
                { key: 'content', label: 'Details', type: 'textarea', placeholder: 'Write anything you want to share.' },
              ]}
              renderItem={(item) => (
                <>
                  <h3 className="text-lg font-black text-heading tracking-tight mb-1">{item.title}</h3>
                  {item.content && <p className="text-sm text-text-muted leading-relaxed whitespace-pre-line">{item.content}</p>}
                </>
              )}
            />
          </div>

          <div role="tabpanel" id="about-panel-data" aria-labelledby="about-tab-data" hidden={activeTab !== 'data'}>
            {activeTab === 'data' && <ManageDataTab />}
          </div>

          <div role="tabpanel" id="about-panel-documents" aria-labelledby="about-tab-documents" hidden={activeTab !== 'documents'}>
            {activeTab === 'documents' && <DocumentsTab />}
          </div>

          <div role="tabpanel" id="about-panel-public" aria-labelledby="about-tab-public" hidden={activeTab !== 'public'}>
            <PublicPageTab centerId={centerId} />
          </div>

          <div role="tabpanel" id="about-panel-subscription" aria-labelledby="about-tab-subscription" hidden={activeTab !== 'subscription'}>
            <SubscriptionTab />
          </div>
        </>
      )}
    </div>
  )
}
