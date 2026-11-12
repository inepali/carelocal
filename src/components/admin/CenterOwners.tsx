'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Crown, Loader2, Plus, Search, Trash2, X, Building2 } from 'lucide-react'
import {
  addCenterOwner, createCenterWithOwner, listCenterOwners, removeCenterOwner, searchOwnerCandidates,
  type CenterOwner, type OwnerCandidate,
} from '@/app/actions/center-roles.actions'
import type { DomainKey } from '@/lib/domain-config'
import { showAlert, showConfirm } from '@/lib/dialog'

/** Search box over staff accounts; calls onPick with the chosen person */
function OwnerPicker({ centerId, domainKey, onPick, busyId, pickLabel = 'Make owner' }: {
  centerId: string | null
  domainKey?: DomainKey
  onPick: (person: OwnerCandidate) => void
  busyId?: string | null
  pickLabel?: string
}) {
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<OwnerCandidate[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) { setPeople([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      const res = await searchOwnerCandidates(centerId, query, domainKey)
      if (cancelled) return
      setSearching(false)
      setPeople(res.success ? res.people : [])
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, centerId, domainKey])

  return (
    <div>
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search staff by name or email"
          className="w-full pl-9 pr-9 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        {searching && <Loader2 className="w-4 h-4 text-slate-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
      {query.trim().length >= 2 && !searching && people.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">No staff accounts match. The owner needs a staff account on this site first.</p>
      )}
      {people.length > 0 && (
        <ul className="mt-2 rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-60 overflow-y-auto">
          {people.map(p => {
            const blocked = p.managesOtherCenter ? 'Manages another center' : p.centerAccess === 'owner' ? 'Already an owner' : null
            const note = p.memberStatus === 'active'
              ? `On the team${p.employmentClass ? ` · ${p.employmentClass}` : ''}${p.centerAccess === 'admin' ? ' · director' : ''}`
              : p.memberStatus ? `On the team (${p.memberStatus}) · will be activated` : centerId ? 'Not on the team yet · will be added as Regular' : null
            return (
              <li key={p.staffId} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900 truncate">{p.name}</div>
                  <div className="text-xs text-slate-500 truncate">{p.email}{note ? ` · ${note}` : ''}</div>
                </div>
                {blocked ? (
                  <span className="text-[11px] font-semibold text-slate-400">{blocked}</span>
                ) : (
                  <button
                    type="button"
                    disabled={!!busyId}
                    onClick={() => onPick(p)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
                  >
                    {busyId === p.staffId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crown className="w-3.5 h-3.5" />} {pickLabel}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Super admin: the center's owners in the center details pop-up */
export function CenterOwnersSection({ centerId }: { centerId: string }) {
  const [owners, setOwners] = useState<CenterOwner[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await listCenterOwners(centerId)
    setOwners(res.success ? res.owners : [])
  }, [centerId])
  useEffect(() => { load() }, [load])

  async function add(person: OwnerCandidate) {
    if (!await showConfirm(`Make ${person.name} an owner? Owners manage everything at the center, including billing, and name its Directors.`)) return
    setBusyId(person.staffId)
    const res = await addCenterOwner(centerId, person.staffId)
    setBusyId(null)
    if (!res.success) return showAlert(res.error)
    setAdding(false)
    load()
  }

  async function remove(owner: CenterOwner) {
    const message = owner.staffId
      ? `Remove ${owner.name} as owner? They stay on the team with no role.`
      : `Remove ${owner.email ?? 'this account'} as owner? They will no longer be able to open this center.`
    if (!await showConfirm(message)) return
    setBusyId(owner.userId)
    const res = await removeCenterOwner(centerId, owner.userId)
    setBusyId(null)
    if (!res.success) return showAlert(res.error)
    load()
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Owners</h3>
        {!adding && (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
            <Plus className="w-3.5 h-3.5" /> Add owner
          </button>
        )}
      </div>
      {owners === null ? (
        <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : owners.length === 0 ? (
        <p className="text-sm text-slate-500">No owner yet. Add one so someone can open this center.</p>
      ) : (
        <ul className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {owners.map(o => (
            <li key={o.userId} className="flex items-center gap-3 px-4 py-3">
              <Crown className="w-5 h-5 text-amber-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-900 truncate">{o.name}</div>
                <div className="text-xs text-slate-500 truncate">{o.email ?? '—'}</div>
              </div>
              {owners.length > 1 && (
                <button
                  onClick={() => remove(o)}
                  disabled={!!busyId}
                  aria-label={`Remove ${o.name} as owner`}
                  className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  {busyId === o.userId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-700">Pick a staff member to make owner</span>
            <button onClick={() => setAdding(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-900" aria-label="Cancel"><X className="w-4 h-4" /></button>
          </div>
          <OwnerPicker centerId={centerId} onPick={add} busyId={busyId} />
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-400">Owners name Directors, Assistant Directors and other roles from each employee’s page.</p>
    </section>
  )
}

/** Super admin: create a center and its first owner */
export function NewCenterDialog({ metros, onClose, onCreated }: {
  metros: { id: string; name: string }[]
  onClose: () => void
  onCreated: (centerId: string) => void
}) {
  const [name, setName] = useState('')
  const [domainKey, setDomainKey] = useState<DomainKey>('childcare')
  const [metroId, setMetroId] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [directorName, setDirectorName] = useState('')
  const [owner, setOwner] = useState<OwnerCandidate | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!owner) return showAlert('Pick the owner.')
    setSaving(true)
    const res = await createCenterWithOwner({
      name, domainKey, metroId: metroId || null, email, phone, directorName, ownerStaffId: owner.staffId,
    })
    setSaving(false)
    if (!res.success) return showAlert(res.error)
    onCreated(res.centerId)
  }

  const field = 'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30'
  const label = 'block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1'

  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <form role="dialog" aria-modal="true" aria-labelledby="new-center-title" onSubmit={submit}
        className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-6 border-b border-slate-100">
          <Building2 className="w-6 h-6 text-slate-400" />
          <h2 id="new-center-title" className="flex-1 text-xl font-black text-slate-900 tracking-tight">New center</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-6 space-y-4">
          <div>
            <label className={label} htmlFor="nc-name">Center name</label>
            <input id="nc-name" required value={name} onChange={e => setName(e.target.value)} className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="nc-site">Site</label>
              <select id="nc-site" value={domainKey} onChange={e => { setDomainKey(e.target.value as DomainKey); setOwner(null) }} className={field}>
                <option value="childcare">Child care</option>
                <option value="senior">Senior care</option>
                <option value="healthcare">Healthcare</option>
              </select>
            </div>
            <div>
              <label className={label} htmlFor="nc-metro">Metro area</label>
              <select id="nc-metro" value={metroId} onChange={e => setMetroId(e.target.value)} className={field}>
                <option value="">None</option>
                {metros.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="nc-email">Center email</label>
              <input id="nc-email" type="email" value={email} onChange={e => setEmail(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label} htmlFor="nc-phone">Phone</label>
              <input id="nc-phone" value={phone} onChange={e => setPhone(e.target.value)} className={field} />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="nc-director">Director / contact name</label>
            <input id="nc-director" value={directorName} onChange={e => setDirectorName(e.target.value)} className={field} />
          </div>
          <div>
            <span className={label}>Owner</span>
            {owner ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                <Crown className="w-4 h-4 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900 truncate">{owner.name}</div>
                  <div className="text-xs text-slate-500 truncate">{owner.email}</div>
                </div>
                <button type="button" onClick={() => setOwner(null)} className="text-xs font-bold text-blue-600 hover:underline">Change</button>
              </div>
            ) : (
              <OwnerPicker centerId={null} domainKey={domainKey} onPick={setOwner} pickLabel="Choose" />
            )}
            <p className="mt-1 text-[11px] text-slate-400">They join the team as a Regular employee and can open the center dashboard right away.</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="submit" disabled={saving || !name.trim() || !owner}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Create center
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
