'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Globe, Loader2, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { siteUrl } from '@/lib/site'
import { getDomainKey } from '@/lib/domain-config'

const LBL = 'block text-sm font-medium text-text-main mb-1.5'
const FLD = 'w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600'

interface Form {
  enabled: boolean
  handle: string
  description: string
  showPhone: boolean
  showEmail: boolean
  showLicense: boolean
  showCareScore: boolean
  toursEnabled: boolean
}

const EMPTY: Form = { enabled: false, handle: '', description: '', showPhone: true, showEmail: true, showLicense: true, showCareScore: true, toursEnabled: true }

/** "Kiddie Academy of Harrisburg!" -> "kiddie-academy-of-harrisburg" (letters, numbers and single dashes) */
const toHandle = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

/** Center admin: switch the public page (/centers/<handle>) on, pick its address and what it shows. */
export default function PublicPageTab({ centerId }: { centerId: string }) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<Form>(EMPTY)
  const [saved, setSaved] = useState<{ enabled: boolean; handle: string } | null>(null)
  const [suggestion, setSuggestion] = useState('')
  const [origin, setOrigin] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('centers')
      .select('name, city, state, domain_key, public_enabled, public_handle, public_description, public_show_phone, public_show_email, public_show_license, public_show_care_score, public_tours_enabled')
      .eq('id', centerId).single()
    if (data) {
      setForm({
        enabled: !!data.public_enabled,
        handle: data.public_handle ?? '',
        description: data.public_description ?? '',
        showPhone: data.public_show_phone ?? true,
        showEmail: data.public_show_email ?? true,
        showLicense: data.public_show_license ?? true,
        showCareScore: data.public_show_care_score ?? true,
        toursEnabled: data.public_tours_enabled ?? true,
      })
      setSaved({ enabled: !!data.public_enabled, handle: data.public_handle ?? '' })
      setSuggestion(toHandle([data.name, data.city, data.state].filter(Boolean).join(' ')))
      setOrigin(siteUrl(getDomainKey(window.location.host)))
    }
    setLoading(false)
  }, [supabase, centerId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function save() {
    const handle = toHandle(form.handle)
    if (form.enabled && handle.length < 3) {
      setMessage('Error: Choose a web address of at least 3 letters or numbers.')
      return
    }
    setSaving(true)
    setMessage('')
    const { error } = await supabase.from('centers').update({
      public_enabled: form.enabled,
      public_handle: handle || null,
      public_description: form.description.trim() || null,
      public_show_phone: form.showPhone,
      public_show_email: form.showEmail,
      public_show_license: form.showLicense,
      public_show_care_score: form.showCareScore,
      public_tours_enabled: form.toursEnabled,
    }).eq('id', centerId)
    setSaving(false)
    if (error) {
      setMessage(error.code === '23505'
        ? 'Error: That web address is already taken. Try adding your city or a number.'
        : error.code === '23514'
          ? 'Error: The web address needs 3–60 letters, numbers and dashes.'
          : `Error: ${error.message}`)
      return
    }
    setForm(f => ({ ...f, handle }))
    setSaved({ enabled: form.enabled, handle })
    setMessage(form.enabled ? 'Saved. Your public page is live.' : 'Saved. Your public page is off.')
  }

  if (loading) return <div className="h-40 animate-pulse rounded-2xl border border-border bg-white" />

  const check = (key: 'showPhone' | 'showEmail' | 'showLicense' | 'showCareScore', label: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3 hover:bg-surface">
      <input type="checkbox" checked={form[key]} onChange={e => setForm({ ...form, [key]: e.target.checked })} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
      <span><span className="block text-sm font-medium text-text-main">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
    </label>
  )

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-text-main"><Globe className="h-5 w-5 text-brand-600" /> Public page</h2>
        <p className="text-xs text-muted">A page anyone can open, without signing in, so families and job seekers can find your center. It is off until you turn it on.</p>
      </div>

      {message && (
        <div className={`rounded-xl border p-3 text-sm font-medium ${message.startsWith('Error') ? 'border-red-100 bg-red-50 text-red-700' : 'border-[#bbf7d0] bg-brand-50 text-[#16a34a]'}`}>{message}</div>
      )}

      <div className="space-y-6 rounded-2xl border border-border bg-white p-6 shadow-sm">
        <label className="flex cursor-pointer items-center gap-3">
          <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked, handle: e.target.checked && !form.handle ? suggestion : form.handle })} className="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
          <span className="text-sm font-semibold text-text-main">Show a public page for my center</span>
        </label>

        <div>
          <label className={LBL} htmlFor="public-handle">Web address</label>
          <div className="flex items-center gap-2">
            <span className="hidden shrink-0 text-sm text-muted sm:block">{(origin || '').replace(/^https?:\/\//, '')}/centers/</span>
            <input id="public-handle" value={form.handle} onChange={e => setForm({ ...form, handle: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder={suggestion || 'your-center-name'} className={FLD} maxLength={60} />
            {suggestion && form.handle !== suggestion && (
              <button type="button" onClick={() => setForm({ ...form, handle: suggestion })} className="shrink-0 text-xs font-bold text-brand-600 hover:underline">Use suggestion</button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-subtle">Lowercase letters, numbers and dashes. If you change it later, links people already have to the old address stop working.</p>
        </div>

        <div>
          <label className={LBL} htmlFor="public-description">About your center</label>
          <textarea id="public-description" rows={4} maxLength={1500} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={`${FLD} resize-none`} placeholder="A few sentences for families and job seekers: your approach, your community, what makes your center a good place to work." />
          <p className="mt-1 text-right text-[11px] text-subtle">{form.description.length}/1500</p>
        </div>

        <div>
          <div className={LBL}>Contact details and ratings</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {check('showPhone', 'Phone number', 'From your Center Profile')}
            {check('showEmail', 'Email address', 'From your Center Profile')}
            {check('showLicense', 'License number', 'From your Center Profile')}
            {check('showCareScore', 'Care Score', 'Your average rating and how many ratings it is based on')}
          </div>
        </div>

        <div>
          <div className={LBL}>Tours</div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3 hover:bg-surface">
            <input type="checkbox" checked={form.toursEnabled} onChange={e => setForm({ ...form, toursEnabled: e.target.checked })} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
            <span><span className="block text-sm font-medium text-text-main">Show a “Schedule a Tour” button</span><span className="block text-xs text-muted">Visitors pick a date and time and share their details. You confirm each request from Tours, and you are notified by email and in the app.</span></span>
          </label>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted">
          <p className="mb-1 font-semibold text-text-main">Always shown on the page</p>
          Your center name and address, the programs marked “Currently offered”, your Team (names, titles and bios only), the Others section, and your open jobs.
          <p className="mt-2 font-semibold text-text-main">Never shown</p>
          Team email addresses, your staff, documents and compliance records, and individual reviews. Tour requests are visible only to you.
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {saved?.enabled && saved.handle ? (
            <a href={`/centers/${saved.handle}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
              View public page <ExternalLink className="h-4 w-4" />
            </a>
          ) : <span />}
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}
