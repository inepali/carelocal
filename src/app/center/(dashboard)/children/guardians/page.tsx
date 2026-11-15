'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Archive, ArchiveRestore, ArrowLeft, Loader2, Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { canOpenChildFiles, useCenterContext } from '../../context'
import { deleteCenterGuardian, listCenterGuardians, saveCenterGuardian, setCenterGuardianArchived, type CenterGuardianInput } from '@/lib/children'
import type { CenterGuardianWithChildren } from '@/lib/child-types'
import { showAlert, showConfirm } from '@/lib/dialog'
import { BTN, BTN_PRIMARY, BTN_QUIET, FLD, LBL, Modal, Pill } from '../_components/ui'

type Editing = CenterGuardianInput & { id?: string; linkedCount: number }

/**
 * Owner and admin: the center's list of parents and guardians. Each entry can be picked when adding a contact to a
 * child, and a change here (name, phone, email) updates that person on every child at once. Pick-up authorization
 * and the other contact flags stay on each child's Contacts tab.
 */
export default function GuardiansPage() {
  const ctx = useCenterContext()
  const allowed = canOpenChildFiles(ctx)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<CenterGuardianWithChildren[]>([])
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!ctx.centerId) return
    const res = await listCenterGuardians(createClient(), ctx.centerId, { includeArchived: true })
    if (res.success) setRows(res.guardians); else showAlert(res.error)
    setLoading(false)
  }, [ctx.centerId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (allowed) load(); else setLoading(false) }, [allowed, load])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return rows
      .filter(g => showArchived ? !!g.archived_at : !g.archived_at)
      .filter(g => !q || g.name.toLowerCase().includes(q) || (g.email ?? '').toLowerCase().includes(q)
        || (digits.length >= 3 && (g.phone ?? '').replace(/\D/g, '').includes(digits))
        || g.children.some(c => `${c.first_name} ${c.last_name}`.toLowerCase().includes(q)))
  }, [rows, search, showArchived])
  const activeCount = rows.filter(g => !g.archived_at).length
  const archivedCount = rows.length - activeCount

  async function save() {
    if (!editing || !ctx.centerId) return
    if (!editing.name.trim()) { showAlert('Enter the person’s name.'); return }
    const original = rows.find(r => r.id === editing.id)
    const detailsChanged = original && (
      original.name !== editing.name.trim() || (original.phone ?? '') !== (editing.phone ?? '').trim() || (original.email ?? '') !== (editing.email ?? '').trim())
    if (detailsChanged && editing.linkedCount > 0) {
      const ok = await showConfirm(
        `This updates the name, phone and email on ${editing.linkedCount} child${editing.linkedCount === 1 ? '' : 'ren'}’s contact list. Each change is logged on the child’s record.`,
        { title: 'Update everywhere', confirmLabel: 'Update' },
      )
      if (!ok) return
    }
    setSaving(true)
    const res = await saveCenterGuardian(createClient(), ctx.centerId, editing)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    setEditing(null)
    load()
  }

  async function toggleArchive(g: CenterGuardianWithChildren) {
    const res = await setCenterGuardianArchived(createClient(), g.id, !g.archived_at)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  async function remove(g: CenterGuardianWithChildren) {
    const linked = g.children.length
    const ok = await showConfirm(
      linked
        ? `Remove ${g.name} from the parents list? ${linked === 1 ? 'The child keeps' : `The ${linked} children keep`} this person as a contact, with the same details and pick-up settings, but they will no longer be linked to the list.`
        : `Remove ${g.name} from the parents list?`,
      { title: 'Remove from list', confirmLabel: 'Remove' },
    )
    if (!ok) return
    const res = await deleteCenterGuardian(createClient(), g.id)
    if (!res.success) { showAlert(res.error); return }
    load()
  }

  const set = <K extends keyof Editing>(key: K, value: Editing[K]) => setEditing(prev => (prev ? { ...prev, [key]: value } : prev))

  if (!allowed) {
    return (
      <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center shadow-sm">
        <Users className="mx-auto mb-3 h-10 w-10 text-brand-200" />
        <h1 className="mb-2 text-xl font-bold text-heading">Parents & guardians</h1>
        <p className="text-muted">
          {ctx.domainKey !== 'childcare' ? 'Child Files is available for child care centers.'
            : !ctx.childFilesEnabled ? 'Child Files is not turned on for your center yet. Contact CareLocal support to join the pilot.'
            : 'Only the owner and administrators can open the parents list.'}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl">
      <Link href="/center/children" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> Children</Link>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="mb-1 text-3xl font-extrabold text-heading">Parents & guardians</h1>
          <p className="text-muted">Everyone you can pick when adding a contact to a child. Fix a phone number here once and it changes for every child. Pick-up authorization stays on each child’s Contacts tab.</p>
        </div>
        <button onClick={() => setEditing({ name: '', relationship: '', phone: '', email: '', notes: '', linkedCount: 0 })} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-brand-800"><Plus className="h-5 w-5" /> Add person</button>
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, phone, email or child" className="w-full rounded-xl border border-border bg-white py-2.5 pl-10 pr-4 text-sm text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30" />
        </div>
        <select value={showArchived ? 'archived' : 'active'} onChange={e => setShowArchived(e.target.value === 'archived')} className="rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-medium text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30">
          <option value="active">Active ({activeCount})</option>
          <option value="archived">Archived ({archivedCount})</option>
        </select>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>
        ) : visible.length === 0 ? (
          <div className="px-6 py-16 text-center text-muted">
            <Users className="mx-auto mb-3 h-10 w-10 text-brand-100" />
            {rows.length === 0 ? 'No one on the list yet. Add a person, or tick “Also add to the parents list” when adding a contact to a child.'
              : showArchived ? 'No archived entries match.' : 'No one matches.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-border text-[15px] font-bold text-text-main">
                  <th scope="col" className="px-6 py-4">Name</th>
                  <th scope="col" className="px-4 py-4">Phone and email</th>
                  <th scope="col" className="px-4 py-4">Contact for</th>
                  <th scope="col" className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm text-text-muted">
                {visible.map(g => (
                  <tr key={g.id} className="align-top hover:bg-surface">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-text-main">{g.name}</div>
                      <div className="text-xs text-muted">{g.relationship || '—'}</div>
                      {g.notes && <div className="mt-1 max-w-xs text-xs text-subtle">{g.notes}</div>}
                    </td>
                    <td className="px-4 py-4 text-xs">
                      {g.phone ? <div><a href={`tel:${g.phone}`} className="hover:text-brand-600">{g.phone}</a></div> : null}
                      {g.email ? <div><a href={`mailto:${g.email}`} className="hover:text-brand-600">{g.email}</a></div> : null}
                      {!g.phone && !g.email && '—'}
                    </td>
                    <td className="px-4 py-4">
                      {g.children.length === 0 ? <span className="text-xs text-muted">No children yet</span> : (
                        <div className="flex flex-wrap gap-1.5">
                          {g.children.map(c => (
                            <Link key={c.child_id} href={`/center/children/${c.child_id}`} className="hover:opacity-80">
                              <Pill className={c.status === 'enrolled' ? 'border-brand-100 bg-brand-50 text-brand-600' : 'border-border bg-surface text-muted'}>
                                {c.first_name} {c.last_name}{c.relationship ? ` · ${c.relationship}` : ''}{c.status === 'withdrawn' ? ' · withdrawn' : ''}
                              </Pill>
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setEditing({ id: g.id, name: g.name, relationship: g.relationship ?? '', phone: g.phone ?? '', email: g.email ?? '', notes: g.notes ?? '', linkedCount: g.children.length })} className={BTN}><Pencil className="h-3.5 w-3.5" /> Edit</button>
                        <button onClick={() => toggleArchive(g)} title={g.archived_at ? 'Restore to the picker' : 'Archive (hide from the picker)'} className="rounded-lg p-2 text-subtle hover:bg-surface hover:text-brand-600">
                          {g.archived_at ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                        </button>
                        <button onClick={() => remove(g)} title="Remove from list" className="rounded-lg p-2 text-subtle hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <Modal title={editing.id ? 'Edit parent or guardian' : 'Add parent or guardian'} onClose={() => setEditing(null)} footer={
          <>
            <button onClick={() => setEditing(null)} className={BTN_QUIET}>Cancel</button>
            <button onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
          </>
        }>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={LBL}>Name *</label><input autoFocus value={editing.name} onChange={e => set('name', e.target.value)} className={FLD} maxLength={120} /></div>
              <div><label className={LBL}>Usual relationship</label><input value={editing.relationship ?? ''} onChange={e => set('relationship', e.target.value)} className={FLD} maxLength={60} placeholder="Mother, grandfather, neighbor…" /></div>
              <div><label className={LBL}>Phone</label><input type="tel" value={editing.phone ?? ''} onChange={e => set('phone', e.target.value)} className={FLD} maxLength={30} /></div>
              <div><label className={LBL}>Email</label><input type="email" value={editing.email ?? ''} onChange={e => set('email', e.target.value)} className={FLD} maxLength={254} /></div>
              <div className="sm:col-span-2">
                <label className={LBL}>Notes for the office</label>
                <textarea value={editing.notes ?? ''} onChange={e => set('notes', e.target.value)} className={FLD} rows={2} maxLength={1000} placeholder="Best time to call, preferred language…" />
                <p className="mt-1 text-[11px] text-subtle">Only owners and administrators see this. Keep custody and health details on the child’s record, not here.</p>
              </div>
            </div>
            {editing.linkedCount > 0 && (
              <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-muted">
                Contact for {editing.linkedCount} child{editing.linkedCount === 1 ? '' : 'ren'}. Name, phone and email changes apply to all of them. The usual relationship only fills in new contacts.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
