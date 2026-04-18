'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffRoleType } from '@/lib/types'
import { Plus, Lock, Pencil, Trash2, Check, X, Loader2, ShieldCheck, Tags } from 'lucide-react'

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
    const { error: updErr } = await supabase
      .from('staff_role_types')
      .update({ is_active: !role.is_active })
      .eq('id', role.id)

    if (!updErr) await loadData()
    setSaving(false)
  }

  async function handleDelete(role: StaffRoleType) {
    if (!confirm(`Remove the "${role.label}" role? This won't affect existing shifts or profiles.`)) return
    setSaving(true)
    await supabase.from('staff_role_types').delete().eq('id', role.id)
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
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Staff Role Types</h1>
          <p className="text-[#6b7a73]">
            Manage the roles your center uses — no code changes required.
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
          {error && (
            <p className="text-sm text-red-600 mt-2">{error}</p>
          )}
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
                <div key={role.id} className={`flex items-center gap-4 px-6 py-4 transition-colors ${!role.is_active ? 'opacity-50 bg-[#fafafa]' : 'hover:bg-[#f8faf9]'}`}>
                  <div className="flex-1">
                    {editingId === role.id ? (
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-[#e2e8e4] text-sm focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25]"
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleUpdate(role.id)
                            if (e.key === 'Escape') { setEditingId(null); setEditLabel('') }
                          }}
                        />
                        <button
                          onClick={() => handleUpdate(role.id)}
                          disabled={saving}
                          className="p-1.5 bg-[#157354] text-white rounded-lg hover:bg-[#0f4a36] transition-colors"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditLabel('') }}
                          className="p-1.5 text-[#6b7a73] hover:bg-[#f8faf9] rounded-lg border border-[#e2e8e4] transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div>
                        <span className={`font-medium ${role.is_active ? 'text-[#1a2e25]' : 'line-through text-[#a8b5ae]'}`}>
                          {role.label}
                        </span>
                        <code className="ml-2 text-xs text-[#a8b5ae] font-mono">{role.value}</code>
                      </div>
                    )}
                  </div>

                  {editingId !== role.id && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Active toggle */}
                      <button
                        onClick={() => handleToggleActive(role)}
                        disabled={saving}
                        title={role.is_active ? 'Deactivate (hides from dropdowns)' : 'Reactivate'}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                          role.is_active
                            ? 'bg-[#edf7f3] text-[#157354] border-[#a9dac9] hover:bg-[#d4ede4]'
                            : 'bg-gray-100 text-[#6b7a73] border-[#e2e8e4] hover:bg-gray-200'
                        }`}
                      >
                        {role.is_active ? 'Active' : 'Inactive'}
                      </button>
                      {/* Edit */}
                      <button
                        onClick={() => { setEditingId(role.id); setEditLabel(role.label) }}
                        className="p-2 text-[#6b7a73] hover:text-[#157354] hover:bg-[#edf7f3] rounded-lg transition-colors border border-transparent hover:border-[#a9dac9]"
                        title="Rename"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(role)}
                        disabled={saving}
                        className="p-2 text-[#6b7a73] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
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
    </div>
  )
}
