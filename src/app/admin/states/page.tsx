'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronRight, ExternalLink, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { showAlert, showConfirm } from '@/lib/dialog'
import { US_STATES, stateName } from '@/lib/us-states'
import type { DomainKey } from '@/lib/domain-config'

const VERTICALS: { key: DomainKey; label: string }[] = [
  { key: 'childcare', label: 'Childcare' },
  { key: 'healthcare', label: 'Healthcare' },
  { key: 'senior', label: 'Senior care' },
]
const verticalLabel = (key: string) => VERTICALS.find(v => v.key === key)?.label ?? key

interface StateDoc {
  id: string
  state_id: string
  document_name: string
  instructions: string | null
  link_url: string | null
  is_required: boolean
  sort_order: number
}
interface OnboardingState {
  id: string
  state_code: string
  domain_key: DomainKey
  status: 'active' | 'retired'
  state_required_docs: StateDoc[]
}

const FIELD = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm'

export default function AdminStatesPage() {
  const supabase = createClient()
  const [states, setStates] = useState<OnboardingState[]>([])
  const [loading, setLoading] = useState(true)
  const [newCode, setNewCode] = useState('')
  const [newVertical, setNewVertical] = useState<DomainKey>('childcare')
  const [adding, setAdding] = useState(false)
  // Cards start collapsed; this holds the ones the super admin has opened
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggleOpen = (id: string) => setOpen(prev => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next })

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('onboarding_states')
      .select('id, state_code, domain_key, status, state_required_docs(id, state_id, document_name, instructions, link_url, is_required, sort_order)')
      .order('state_code', { ascending: true })
    if (error) showAlert('Could not load the states: ' + error.message)
    setStates(((data ?? []) as unknown as OnboardingState[]).map(s => ({
      ...s, state_required_docs: [...s.state_required_docs].sort((a, b) => a.sort_order - b.sort_order),
    })))
    setLoading(false)
  }, [supabase])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function addState() {
    if (!newCode) return
    setAdding(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('onboarding_states').insert({ state_code: newCode, domain_key: newVertical, created_by: user?.id ?? null }).select('id').single()
    setAdding(false)
    if (error) { showAlert(error.code === '23505' ? `${stateName(newCode)} is already on the list for ${verticalLabel(newVertical)}.` : error.message); return }
    setNewCode('')
    // Open the new state so its documents can be added straight away
    if (data) setOpen(prev => new Set(prev).add(data.id))
    load()
  }

  async function setStatus(s: OnboardingState, status: 'active' | 'retired') {
    const { error } = await supabase.from('onboarding_states').update({ status }).eq('id', s.id)
    if (error) showAlert(error.message); else load()
  }

  async function removeState(s: OnboardingState) {
    if (!await showConfirm(`Delete ${stateName(s.state_code)} (${verticalLabel(s.domain_key)}) and its ${s.state_required_docs.length} document(s)? Staff will lose the ticks they made on those documents. Retiring the state instead hides it and keeps everything.`, { title: 'Delete state', tone: 'danger', confirmLabel: 'Delete' })) return
    const { error } = await supabase.from('onboarding_states').delete().eq('id', s.id)
    if (error) showAlert(error.message); else load()
  }

  return (
    <div className="pb-12">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-extrabold text-[#0f172a]">State Documents</h1>
        <p className="text-slate-500">Add a state when CareLocal rolls out there, and list the documents staff in that state need. Staff see the list on their Getting started checklist and tick items off themselves.</p>
      </div>

      <div className="mb-8 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="min-w-48 flex-1 text-sm font-semibold text-slate-700">State
          <select value={newCode} onChange={e => setNewCode(e.target.value)} className={`${FIELD} mt-1 font-normal`}>
            <option value="">Choose a state…</option>
            {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
          </select>
        </label>
        <label className="min-w-40 text-sm font-semibold text-slate-700">Vertical
          <select value={newVertical} onChange={e => setNewVertical(e.target.value as DomainKey)} className={`${FIELD} mt-1 font-normal`}>
            {VERTICALS.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </label>
        <button type="button" disabled={!newCode || adding} onClick={addState} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add state
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
      ) : states.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500">No states yet. Add the first state above.</p>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-slate-500">{states.length} state{states.length === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-4 font-semibold text-blue-600">
              <button type="button" onClick={() => setOpen(new Set(states.map(s => s.id)))} className="hover:underline">Expand all</button>
              <button type="button" onClick={() => setOpen(new Set())} className="hover:underline">Collapse all</button>
            </div>
          </div>
          <div className="space-y-4">
            {states.map(s => (
              <StateCard key={s.id} state={s} open={open.has(s.id)} onToggle={() => toggleOpen(s.id)} onChanged={load} onStatus={setStatus} onDelete={removeState} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function StateCard({ state, open, onToggle, onChanged, onStatus, onDelete }: {
  state: OnboardingState
  open: boolean
  onToggle: () => void
  onChanged: () => void
  onStatus: (s: OnboardingState, status: 'active' | 'retired') => void
  onDelete: (s: OnboardingState) => void
}) {
  const supabase = createClient()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const docs = state.state_required_docs
  const retired = state.status === 'retired'

  async function move(index: number, direction: -1 | 1) {
    const other = docs[index + direction]
    const current = docs[index]
    if (!other) return
    // Renumber the whole list so equal sort_order values can never leave the pair unmoved
    const reordered = [...docs]
    reordered[index] = other
    reordered[index + direction] = current
    const results = await Promise.all(reordered.map((d, i) => supabase.from('state_required_docs').update({ sort_order: i }).eq('id', d.id)))
    const failed = results.find(r => r.error)
    if (failed?.error) showAlert(failed.error.message)
    onChanged()
  }

  async function removeDoc(doc: StateDoc) {
    if (!await showConfirm(`Delete "${doc.document_name}"? Staff will lose any tick they made on it.`, { title: 'Delete document', tone: 'danger', confirmLabel: 'Delete' })) return
    const { error } = await supabase.from('state_required_docs').delete().eq('id', doc.id)
    if (error) showAlert(error.message); else onChanged()
  }

  return (
    <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${retired ? 'border-slate-200 opacity-75' : 'border-slate-200'}`}>
      <header className={`flex flex-wrap items-center gap-3 bg-slate-50 px-5 py-4 ${open ? 'border-b border-slate-200' : ''}`}>
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 flex-wrap items-center gap-3 text-left">
          <ChevronRight className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
          <h2 className="text-lg font-bold text-slate-800">{stateName(state.state_code)} <span className="font-medium text-slate-400">({state.state_code})</span></h2>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600">{verticalLabel(state.domain_key)}</span>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${retired ? 'border-slate-200 bg-slate-100 text-slate-500' : 'border-green-200 bg-green-50 text-green-700'}`}>{retired ? 'RETIRED' : 'ACTIVE'}</span>
          <span className="text-sm text-slate-500">{docs.length} document{docs.length === 1 ? '' : 's'}</span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => onStatus(state, retired ? 'active' : 'retired')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-white">{retired ? 'Reactivate' : 'Retire'}</button>
          <button type="button" onClick={() => onDelete(state)} aria-label="Delete state" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
        </div>
      </header>

      {open && (
      <>
      <ul className="divide-y divide-slate-100">
        {docs.map((doc, i) => editing === doc.id ? (
          <li key={doc.id} className="bg-blue-50/30 px-5 py-4"><DocForm stateId={state.id} doc={doc} sortOrder={doc.sort_order} onDone={() => { setEditing(null); onChanged() }} onCancel={() => setEditing(null)} /></li>
        ) : (
          <li key={doc.id} className="flex items-start gap-3 px-5 py-3.5">
            <div className="flex flex-col">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" disabled={i === docs.length - 1} onClick={() => move(i, 1)} aria-label="Move down" className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                {doc.document_name}
                {!doc.is_required && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">Optional</span>}
              </div>
              {doc.instructions && <p className="mt-0.5 text-sm text-slate-500">{doc.instructions}</p>}
              {doc.link_url && <a href={doc.link_url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">{doc.link_url} <ExternalLink className="h-3 w-3" /></a>}
            </div>
            <button type="button" onClick={() => setEditing(doc.id)} aria-label="Edit document" className="rounded-lg p-2 text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Pencil className="h-4 w-4" /></button>
            <button type="button" onClick={() => removeDoc(doc)} aria-label="Delete document" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
        {docs.length === 0 && editing !== 'new' && <li className="px-5 py-6 text-center text-sm text-slate-500">No documents yet. Staff in this state see only their five profile tasks.</li>}
        {editing === 'new' && (
          <li className="bg-blue-50/30 px-5 py-4"><DocForm stateId={state.id} sortOrder={docs.length} onDone={() => { setEditing(null); onChanged() }} onCancel={() => setEditing(null)} /></li>
        )}
      </ul>

      {editing !== 'new' && (
        <div className="border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline"><Plus className="h-4 w-4" /> Add document</button>
        </div>
      )}
      </>
      )}
    </section>
  )
}

function DocForm({ stateId, doc, sortOrder, onDone, onCancel }: { stateId: string; doc?: StateDoc; sortOrder: number; onDone: () => void; onCancel: () => void }) {
  const supabase = createClient()
  const [name, setName] = useState(doc?.document_name ?? '')
  const [instructions, setInstructions] = useState(doc?.instructions ?? '')
  const [link, setLink] = useState(doc?.link_url ?? '')
  const [required, setRequired] = useState(doc?.is_required ?? true)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) { showAlert('Give the document a name.'); return }
    const url = link.trim()
    if (url && !/^https?:\/\//i.test(url)) { showAlert('The link must start with http:// or https://'); return }
    setSaving(true)
    const row = { document_name: name.trim(), instructions: instructions.trim() || null, link_url: url || null, is_required: required }
    const { error } = doc
      ? await supabase.from('state_required_docs').update(row).eq('id', doc.id)
      : await supabase.from('state_required_docs').insert({ ...row, state_id: stateId, sort_order: sortOrder })
    setSaving(false)
    if (error) { showAlert(error.message); return }
    onDone()
  }

  return (
    <div className="space-y-3">
      <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={200} placeholder="Document name, e.g. Criminal background check" className={FIELD} />
      <textarea value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={1000} rows={2} placeholder="Instructions for staff (optional)" className={FIELD} />
      <input value={link} onChange={e => setLink(e.target.value)} maxLength={500} placeholder="Link to the official form or site (optional)" className={FIELD} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} className="h-4 w-4 rounded" /> Required
        </label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /> Cancel</button>
          <button type="button" disabled={saving} onClick={save} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}
