'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffRoleType } from '@/lib/types'
import { Plus, Lock, Pencil, Trash2, Check, X, Loader2, ShieldCheck, Tags, AlertTriangle, AlertCircle } from 'lucide-react'

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export default function CenterRolesPage() {
  const supabase = createClient()
  const [centerId, setCenterId] = useState<string | null>(null)
  const [roles, setRoles] = useState<StaffRoleType[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Add form
  const [showAdd, setShowAdd] = useState(false)
  const [newLabel, setNewLabel] = useState('')

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')

  const [deleteTarget, setDeleteTarget] = useState<StaffRoleType | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    if (!admin) return

    setCenterId(admin.center_id)

    const { data } = await supabase
      .from('staff_role_types')
      .select('*')
      .or(`center_id.is.null,center_id.eq.${admin.center_id}`)
      .order('sort_order', { ascending: true })

    const sorted = (data || []).sort((a, b) => {
      if (a.center_id === null && b.center_id !== null) return -1
      if (a.center_id !== null && b.center_id === null) return 1
      return a.sort_order - b.sort_order
    })

    setRoles(sorted)
    setLoading(false)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!centerId || !newLabel.trim()) return
    setSaving(true)
    setError('')

    const value = slugify(newLabel)
    const maxOrder = roles.filter(r => r.center_id !== null).reduce((m, r) => Math.max(m, r.sort_order), 0)

    const { error: insertErr } = await supabase
      .from('staff_role_types')
      .insert({
        center_id: centerId,
        value,
        label: newLabel.trim(),
        sort_order: maxOrder + 1,
      })

    if (insertErr) {
      setError(insertErr.message.includes('unique') ? 'A role with that name already exists.' : insertErr.message)
    } else {
      setNewLabel('')
      setShowAdd(false)
      await loadData()
    }
    setSaving(false)
  }

  async function handleUpdate(id: string) {
    if (!editLabel.trim()) return
    setSaving(true)
    setError('')

    const { error: updateErr } = await supabase
      .from('staff_role_types')
      .update({ label: editLabel.trim() })
      .eq('id', id)

    if (updateErr) {
      setError(updateErr.message)
    } else {
      setEditingId(null)
      setEditLabel('')
      await loadData()
    }
    setSaving(false)
  }

  async function handleToggleActive(role: StaffRoleType) {
    setSaving(true)
    setError('')
    const { error: updErr } = await supabase
      .from('staff_role_types')
      .update({ is_active: !role.is_active })
      .eq('id', role.id)

    if (updErr) setError(updErr.message)
    else await loadData()
    setSaving(false)
  }

  function openDeleteModal(role: StaffRoleType) {
    setDeleteError(null)
    setDeleteTarget(role)
  }

  function closeDeleteModal() {
    if (deleteSubmitting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }

  async function confirmDeleteRole() {
    if (!deleteTarget) return
    setDeleteSubmitting(true)
    setDeleteError(null)
    const { error: delErr } = await supabase.from('staff_role_types').delete().eq('id', deleteTarget.id)
    setDeleteSubmitting(false)
    if (delErr) {
      setDeleteError(delErr.message)
      return
    }
    setDeleteTarget(null)
    setSaving(true)
    await loadData()
    setSaving(false)
  }

  const platformRoles = roles.filter(r => r.center_id === null)
  const centerRoles   = roles.filter(r => r.center_id !== null)

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 max-w-3xl mx-auto">
        <div className="h-16 bg-white rounded-2xl border border-[#e2e8e4]" />
        <div className="h-64 bg-white rounded-2xl border border-[#e2e8e4]" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Staff Roles</h1>
          <p className="text-[#6b7a73]">
            Manage the staff roles your center uses — no code changes required.
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(!showAdd); setError('') }}
          className={`inline-flex items-center gap-2 font-semibold px-6 py-3 rounded-xl shadow-sm transition-colors ${
            showAdd
              ? 'bg-white text-[#6b7a73] border border-[#e2e8e4] hover:bg-gray-50'
              : 'bg-[#157354] text-white hover:bg-[#0f4a36]'
          }`}
        >
          {showAdd ? <><X className="w-4 h-4" /> Cancel</> : <><Plus className="w-4 h-4" /> Add Role</>}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 flex items-start justify-between gap-3 rounded-2xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          <span className="font-medium">{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            className="shrink-0 font-black text-xs uppercase tracking-widest text-red-800 underline underline-offset-2 hover:text-red-950"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Add Role Form */}
      {showAdd && (
        <div className="bg-white border-2 border-[#157354] rounded-2xl p-6 mb-6 shadow-lg animate-in fade-in slide-in-from-top-4">
          <h2 className="text-base font-bold text-[#1a2e25] mb-4">New Custom Role</h2>
          <form onSubmit={handleAdd} className="flex gap-3">
            <div className="flex-1">
              <input
                type="text"
                required
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. Van Driver, Admin, Kitchen Staff"
                className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                autoFocus
              />
              {newLabel && (
                <p className="text-xs text-[#a8b5ae] mt-1">
                  Stored as: <code className="font-mono bg-[#f8faf9] px-1 rounded">{slugify(newLabel)}</code>
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={saving || !newLabel.trim()}
              className="flex items-center gap-2 bg-[#157354] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#0f4a36] disabled:opacity-60 shadow-sm transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4" /> Save</>}
            </button>
          </form>
        </div>
      )}

      <div className="space-y-6">
        {/* Platform Defaults Card */}
        <div className="bg-white border border-[#e2e8e4] rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 bg-[#f8faf9] border-b border-[#e2e8e4] flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#157354]" />
            <span className="text-xs font-bold text-[#0b3828] uppercase tracking-widest">Platform Defaults</span>
            <span className="ml-auto text-xs text-[#a8b5ae]">Managed by CareLocal · read-only</span>
          </div>
          <div className="divide-y divide-[#e2e8e4]">
            {platformRoles.map(role => (
              <div key={role.id} className="flex items-center gap-4 px-6 py-4">
                <Lock className="w-4 h-4 text-[#a8b5ae] shrink-0" />
                <div className="flex-1">
                  <span className="font-medium text-[#1a2e25]">{role.label}</span>
                  <code className="ml-2 text-xs text-[#a8b5ae] font-mono">{role.value}</code>
                </div>
                <span className="text-xs text-[#a8b5ae] bg-[#f8faf9] px-2 py-0.5 rounded-full border border-[#e2e8e4]">
                  default
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Center Custom Roles Card */}
        <div className="bg-white border border-[#e2e8e4] rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 bg-[#f8faf9] border-b border-[#e2e8e4] flex items-center gap-2">
            <Tags className="w-4 h-4 text-[#157354]" />
            <span className="text-xs font-bold text-[#0b3828] uppercase tracking-widest">Your Custom Roles</span>
            <span className="ml-auto text-xs text-[#a8b5ae]">{centerRoles.length} role{centerRoles.length !== 1 ? 's' : ''}</span>
          </div>

          {centerRoles.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Tags className="w-10 h-10 text-[#e2e8e4] mx-auto mb-3" />
              <p className="text-sm font-medium text-[#6b7a73]">No custom roles yet.</p>
              <p className="text-xs text-[#a8b5ae] mt-1">Click <strong>Add Role</strong> above to create your first custom staff role.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#e2e8e4]">
              {centerRoles.map(role => (
                <div
                  key={role.id}
                  className={`flex flex-col gap-4 px-6 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between ${!role.is_active ? 'bg-[#fafafa]' : 'hover:bg-[#f8faf9]'}`}
                >
                  <div className="min-w-0 flex-1">
                    {editingId === role.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          autoFocus
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          className="min-w-[12rem] flex-1 px-3 py-2 rounded-lg border border-[#e2e8e4] text-sm focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleUpdate(role.id)
                            if (e.key === 'Escape') { setEditingId(null); setEditLabel('') }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdate(role.id)}
                          disabled={saving}
                          className="p-2 bg-[#157354] text-white rounded-lg hover:bg-[#0f4a36] transition-colors disabled:opacity-60"
                          title="Save name"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingId(null); setEditLabel('') }}
                          className="p-2 text-[#6b7a73] hover:bg-[#f8faf9] rounded-lg border border-[#e2e8e4] transition-colors"
                          title="Cancel editing"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <span className={`font-semibold ${role.is_active ? 'text-[#1a2e25]' : 'line-through text-[#a8b5ae]'}`}>
                          {role.label}
                        </span>
                        <code className="ml-2 text-xs text-[#a8b5ae] font-mono break-all">{role.value}</code>
                      </div>
                    )}
                  </div>

                  {editingId !== role.id && (
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(role)}
                        disabled={saving}
                        title={role.is_active ? 'Deactivate (hides from dropdowns)' : 'Reactivate'}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                          role.is_active
                            ? 'bg-[#edf7f3] text-[#157354] border-[#a9dac9] hover:bg-[#d4ede4]'
                            : 'bg-gray-100 text-[#6b7a73] border-[#e2e8e4] hover:bg-gray-200'
                        }`}
                      >
                        {role.is_active ? 'Active' : 'Inactive'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditingId(role.id); setEditLabel(role.label); setError('') }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e8e4] px-3 py-1.5 text-xs font-semibold text-[#157354] hover:bg-[#edf7f3] hover:border-[#a9dac9] transition-colors"
                        title="Edit display name"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => openDeleteModal(role)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors disabled:opacity-50"
                        title="Delete this custom role"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info box */}
        <div className="bg-[#edf7f3] border border-[#a9dac9] rounded-2xl p-5 text-sm text-[#3d5a4f]">
          <p className="font-semibold text-[#0b3828] mb-1">How custom roles work</p>
          <ul className="space-y-1 text-sm">
            <li>• Custom roles appear in all shift, staff, and document dropdowns alongside platform defaults.</li>
            <li>• <strong>Deactivating</strong> a role hides it from new selections but doesn't affect existing records.</li>
            <li>• <strong>Deleting</strong> a role is permanent. Existing shifts/profiles that used it keep their value.</li>
            <li>• Changes take effect immediately — no deployment needed.</li>
          </ul>
        </div>
      </div>

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b3828]/50 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-role-title"
          onClick={deleteSubmitting ? undefined : closeDeleteModal}
        >
          <div
            className="w-full max-w-md rounded-[2rem] border-2 border-red-100 bg-white shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="border-b border-red-100 bg-gradient-to-br from-red-50 to-amber-50/30 px-8 py-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow-lg shadow-red-600/20">
                  <AlertTriangle className="h-6 w-6" strokeWidth={2.25} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-red-700/90">Delete custom role</p>
                  <h2 id="delete-role-title" className="text-xl font-black tracking-tight text-[#0b3828]">
                    Remove &ldquo;{deleteTarget.label}&rdquo;?
                  </h2>
                </div>
              </div>
            </div>
            <div className="space-y-4 px-8 py-6">
              <p className="text-sm font-medium leading-relaxed text-[#3d5a4f]">
                This removes the role from your center&apos;s list. Existing shifts or profiles that already use the code{' '}
                <code className="rounded bg-[#f8faf9] px-1 font-mono text-xs text-[#1a2e25]">{deleteTarget.value}</code> keep that value — only new picks are affected.
              </p>
              {deleteError && (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                >
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                  <p className="font-medium break-words">{deleteError}</p>
                </div>
              )}
            </div>
            <div className="flex flex-col-reverse gap-3 px-8 pb-8 sm:flex-row">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleteSubmitting}
                className="flex-1 rounded-2xl border-2 border-[#e2e8e4] py-3.5 text-xs font-black uppercase tracking-widest text-[#3d5a4f] transition-colors hover:bg-[#f8faf9] disabled:opacity-50"
              >
                Keep role
              </button>
              <button
                type="button"
                onClick={confirmDeleteRole}
                disabled={deleteSubmitting}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-red-600 py-3.5 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                {deleteSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" /> Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" /> Delete role
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
