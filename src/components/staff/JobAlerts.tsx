'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, Loader2, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useLookups } from '@/hooks/use-lookups'
import { lookupLabel } from '@/lib/lookups'
import { showAlert, showConfirm } from '@/lib/dialog'

type Alert = { id: string; city: string | null; state: string | null; role_value: string | null; is_active: boolean }

/**
 * Opt-in job alerts: a city (or any city in the metro area) and a role (or any role).
 * Staff hear about a job the first time it is published, once, however many alerts match.
 */
export function JobAlerts() {
  const { data: roleLookups } = useLookups('Role')
  const [staffId, setStaffId] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [cities, setCities] = useState<{ city: string; state: string | null }[]>([])
  const [form, setForm] = useState({ city: '', role: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('staff_profiles').select('id, metro_area_id').eq('user_id', user.id).maybeSingle()
    if (!profile) { setLoading(false); return }
    setStaffId(profile.id)
    const [{ data: rows }, { data: centers }] = await Promise.all([
      supabase.from('job_alerts').select('id, city, state, role_value, is_active').eq('staff_id', profile.id).order('created_at'),
      profile.metro_area_id
        ? supabase.from('centers').select('city, state').eq('metro_area_id', profile.metro_area_id)
        : Promise.resolve({ data: [] as { city: string; state: string | null }[] }),
    ])
    setAlerts((rows ?? []) as Alert[])
    const unique = new Map<string, { city: string; state: string | null }>()
    for (const c of centers ?? []) if (c.city) unique.set(`${c.city.toLowerCase()}|${(c.state ?? '').toLowerCase()}`, { city: c.city, state: c.state })
    setCities([...unique.values()].sort((a, b) => a.city.localeCompare(b.city)))
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function add() {
    if (!staffId) return
    const [city, state] = form.city ? form.city.split('|') : [null, null]
    setSaving(true)
    const { error } = await createClient().from('job_alerts').insert({
      staff_id: staffId, city: city || null, state: state || null, role_value: form.role || null,
    })
    setSaving(false)
    if (error) {
      showAlert(error.code === '23505' ? 'You already have this alert.' : `Could not save the alert: ${error.message}`)
      return
    }
    setForm({ city: '', role: '' })
    load()
  }

  async function toggle(alert: Alert) {
    const { error } = await createClient().from('job_alerts').update({ is_active: !alert.is_active }).eq('id', alert.id)
    if (error) { showAlert(error.message); return }
    setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, is_active: !a.is_active } : a))
  }

  async function remove(alert: Alert) {
    if (!await showConfirm('Delete this job alert?', { confirmLabel: 'Delete' })) return
    const { error } = await createClient().from('job_alerts').delete().eq('id', alert.id)
    if (error) { showAlert(error.message); return }
    setAlerts(prev => prev.filter(a => a.id !== alert.id))
  }

  const describe = (a: Alert) => [
    a.role_value ? lookupLabel(roleLookups, a.role_value) : 'Any role',
    a.city ? `in ${a.city}${a.state ? `, ${a.state}` : ''}` : 'anywhere in my metro area',
  ].join(' ')

  const roles = roleLookups.filter(r => r.is_active)

  return (
    <section className="mb-8 rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Bell className="h-5 w-5 text-brand-600" />
        <h2 className="text-lg font-bold text-text-main">Job alerts</h2>
      </div>
      <p className="mb-4 text-sm text-muted">Get a notification when a center posts a job that matches. You can pause or delete an alert any time.</p>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-brand-600" /></div>
      ) : (
        <>
          {alerts.length > 0 && (
            <ul className="mb-4 divide-y divide-border rounded-xl border border-border">
              {alerts.map(a => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={`flex-1 ${a.is_active ? 'text-text-main' : 'text-subtle line-through'}`}>{describe(a)}</span>
                  <button onClick={() => toggle(a)} title={a.is_active ? 'Pause' : 'Resume'} className="rounded-lg p-1.5 text-muted hover:bg-brand-50 hover:text-brand-600">
                    {a.is_active ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                  </button>
                  <button onClick={() => remove(a)} title="Delete" className="rounded-lg p-1.5 text-subtle hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="rounded-xl border border-border bg-white px-3 py-2 text-sm">
              <option value="">Any role</option>
              {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <select value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className="rounded-xl border border-border bg-white px-3 py-2 text-sm">
              <option value="">Anywhere in my metro area</option>
              {cities.map(c => <option key={`${c.city}|${c.state ?? ''}`} value={`${c.city}|${c.state ?? ''}`}>{c.city}{c.state ? `, ${c.state}` : ''}</option>)}
            </select>
            <button disabled={saving || !staffId} onClick={add} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add alert
            </button>
          </div>
        </>
      )}
    </section>
  )
}
