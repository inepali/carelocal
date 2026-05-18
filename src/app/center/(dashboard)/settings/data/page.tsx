'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Edit2, Trash2, Save, X, Loader2, Database } from 'lucide-react'

const LOOKUP_GROUPS = [
  { id: 'Role', label: 'Roles' },
  { id: 'Document Type', label: 'Document Types' },
  { id: 'Shift Type', label: 'Shift Types' },
  { id: 'Payment Method', label: 'Payment Methods' }
]

export default function ManageDataPage() {
  const supabase = createClient()
  const [activeGroup, setActiveGroup] = useState(LOOKUP_GROUPS[0].id)
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [centerId, setCenterId] = useState<string | null>(null)
  
  // Edit / Add state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [activeGroup])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    if (admin) {
      setCenterId(admin.center_id)
      const { data: lookups } = await supabase
        .from('center_lookups')
        .select('*')
        .eq('center_id', admin.center_id)
        .eq('group_name', activeGroup)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      
      setItems(lookups || [])
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!editLabel.trim() || !centerId) return
    setSaving(true)

    // Use explicit editValue, or fallback to auto-generating from label if empty
    const finalValue = editValue.trim() || editLabel.trim().toLowerCase().replace(/\s+/g, '_')

    try {
      if (editingId === 'new') {
        // Insert
        await supabase.from('center_lookups').insert({
          center_id: centerId,
          group_name: activeGroup,
          label: editLabel.trim(),
          value: finalValue,
          is_active: true
        })
      } else {
        // Update
        await supabase.from('center_lookups').update({
          label: editLabel.trim(),
          value: finalValue
        }).eq('id', editingId)
      }
      
      setEditingId(null)
      setEditLabel('')
      setEditValue('')
      await loadData()
    } catch (err) {
      console.error('Error saving lookup', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this item?')) return
    
    await supabase.from('center_lookups').delete().eq('id', id)
    await loadData()
  }

  async function toggleStatus(item: any) {
    await supabase.from('center_lookups').update({ is_active: !item.is_active }).eq('id', item.id)
    await loadData()
  }

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-[#0b3828] tracking-tight mb-2 flex items-center gap-3">
          <Database className="w-8 h-8 text-[#157354]" /> Manage System Data
        </h1>
        <p className="text-[#6b7a73] font-medium">Configure the dynamic dropdowns and choices used across your center.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar Tabs */}
        <div className="w-full md:w-64 shrink-0 space-y-2">
          {LOOKUP_GROUPS.map(group => (
            <button
              key={group.id}
              onClick={() => { setActiveGroup(group.id); setEditingId(null) }}
              className={`w-full text-left px-5 py-3.5 rounded-xl font-bold transition-all ${
                activeGroup === group.id 
                  ? 'bg-[#157354] text-white shadow-md' 
                  : 'bg-white text-[#6b7a73] border border-[#e2e8e4] hover:bg-[#edf7f3] hover:text-[#157354] hover:border-[#157354]'
              }`}
            >
              {group.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-white rounded-3xl border border-[#e2e8e4] overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[#e2e8e4] bg-[#f8faf9]/50 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-[#1a2e25]">{LOOKUP_GROUPS.find(g => g.id === activeGroup)?.label}</h2>
              <p className="text-sm font-medium text-[#6b7a73]">Manage items in this list</p>
            </div>
            
            {editingId !== 'new' && (
              <button
                onClick={() => { setEditingId('new'); setEditLabel(''); setEditValue('') }}
                className="flex items-center gap-2 bg-[#fbbf24] text-[#0b3828] font-bold px-4 py-2.5 rounded-xl hover:bg-[#f59e0b] shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" /> Add New
              </button>
            )}
          </div>

          <div className="p-6 space-y-4">
            {editingId === 'new' && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 bg-[#edf7f3] rounded-2xl border border-[#a9dac9]">
                <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Label (e.g., Certification)"
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#a9dac9] focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
                  />
                  <input
                    type="text"
                    placeholder="Value (e.g., certification)"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#a9dac9] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 font-mono text-sm"
                  />
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button onClick={handleSave} disabled={saving} className="p-2.5 bg-[#157354] text-white rounded-xl hover:bg-[#0f4a36]">
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-2.5 bg-white text-[#6b7a73] rounded-xl border border-[#e2e8e4] hover:bg-slate-50">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-[#157354]" />
              </div>
            ) : items.length === 0 && editingId !== 'new' ? (
              <div className="py-12 text-center">
                <Database className="w-12 h-12 text-[#e2e8e4] mx-auto mb-3" />
                <p className="text-[#6b7a73] font-bold">No items found for this group.</p>
                <p className="text-sm text-[#a8b5ae]">Click "Add New" to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map(item => (
                  <div key={item.id} className="flex items-center justify-between p-4 bg-white border border-[#e2e8e4] rounded-2xl hover:border-[#157354] transition-colors group">
                    {editingId === item.id ? (
                       <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-3 mr-4">
                         <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                           <input
                             type="text"
                             autoFocus
                             placeholder="Label"
                             value={editLabel}
                             onChange={e => setEditLabel(e.target.value)}
                             className="w-full px-4 py-2 rounded-xl border border-[#157354] focus:outline-none"
                           />
                           <input
                             type="text"
                             placeholder="Value"
                             value={editValue}
                             onChange={e => setEditValue(e.target.value)}
                             className="w-full px-4 py-2 rounded-xl border border-[#157354] focus:outline-none font-mono text-sm"
                           />
                         </div>
                         <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                           <button onClick={handleSave} disabled={saving} className="p-2 bg-[#157354] text-white rounded-lg hover:bg-[#0f4a36]">
                             {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                           </button>
                           <button onClick={() => setEditingId(null)} className="p-2 bg-slate-100 text-[#6b7a73] rounded-lg hover:bg-slate-200">
                             <X className="w-4 h-4" />
                           </button>
                         </div>
                       </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <div className={`w-3 h-3 rounded-full ${item.is_active ? 'bg-[#16a34a]' : 'bg-slate-300'}`} />
                        <div>
                          <div className={`font-bold ${item.is_active ? 'text-[#1a2e25]' : 'text-[#a8b5ae]'}`}>{item.label}</div>
                          <div className="text-xs text-[#a8b5ae] font-mono mt-0.5">{item.value}</div>
                        </div>
                      </div>
                    )}
                    
                    {editingId !== item.id && (
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => toggleStatus(item)}
                          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[#e2e8e4] hover:bg-slate-50 text-[#6b7a73]"
                        >
                          {item.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button 
                          onClick={() => { setEditingId(item.id); setEditLabel(item.label); setEditValue(item.value || '') }}
                          className="p-1.5 text-[#6b7a73] hover:text-[#157354] bg-slate-50 hover:bg-[#edf7f3] rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 text-[#6b7a73] hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors"
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
        </div>
      </div>
    </div>
  )
}
