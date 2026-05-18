'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Classroom } from '@/lib/types'
import { Plus, Edit2, Trash2, Users, Loader2, Home, Info } from 'lucide-react'
import Link from 'next/link'
import { useCenterContext } from '../context'

export default function SectionsPage() {
  const { classroomTerm } = useCenterContext()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [centerId, setCenterId] = useState<string | null>(null)
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRoom, setEditingRoom] = useState<Classroom | null>(null)
  const [formName, setFormName] = useState('')
  const [formAgeGroup, setFormAgeGroup] = useState('')
  const [formCapacity, setFormCapacity] = useState('')
  const [saving, setSaving] = useState(false)

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

    if (admin) {
      setCenterId(admin.center_id)
      const { data: rooms } = await supabase
        .from('classrooms')
        .select('*')
        .eq('center_id', admin.center_id)
        .order('name', { ascending: true })
      
      setClassrooms(rooms || [])
    }
    setLoading(false)
  }

  function openModal(room: Classroom | null = null) {
    if (room) {
      setEditingRoom(room)
      setFormName(room.name)
      setFormAgeGroup(room.age_group || '')
      setFormCapacity(room.capacity?.toString() || '')
    } else {
      setEditingRoom(null)
      setFormName('')
      setFormAgeGroup('')
      setFormCapacity('')
    }
    setIsModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!centerId) return
    setSaving(true)

    const payload = {
      center_id: centerId,
      name: formName,
      age_group: formAgeGroup || null,
      capacity: formCapacity ? parseInt(formCapacity) : null,
      is_active: true
    }

    let error
    if (editingRoom) {
      const { error: err } = await supabase
        .from('classrooms')
        .update(payload)
        .eq('id', editingRoom.id)
      error = err
    } else {
      const { error: err } = await supabase
        .from('classrooms')
        .insert(payload)
      error = err
    }

    if (!error) {
      setIsModalOpen(false)
      loadData()
    } else {
      alert("Failed to save classroom: " + error.message)
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this classroom? Any associated shifts will lose their room assignment.")) return
    
    const { error } = await supabase
      .from('classrooms')
      .delete()
      .eq('id', id)

    if (!error) {
      loadData()
    } else {
      alert("Failed to delete classroom. It might be in use.")
    }
  }

  if (loading) {
    return <div className="animate-pulse space-y-6 pt-10 px-8">
      <div className="h-10 w-48 bg-slate-200 rounded-lg mb-8"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1,2,3].map(i => <div key={i} className="h-48 bg-white rounded-3xl border border-slate-100 shadow-sm"></div>)}
      </div>
    </div>
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">{classroomTerm}</h1>
          <p className="text-[#6b7a73]">Manage your center's {classroomTerm.toLowerCase()} and age groups for shift assignments.</p>
        </div>
        <button 
          onClick={() => openModal()}
          className="inline-flex items-center justify-center gap-2 bg-[#fbbf24] text-[#0b3828] font-bold px-6 py-3 rounded-xl hover:bg-[#f59e0b] shadow-sm transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" /> Add {classroomTerm}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {classrooms.length === 0 ? (
          <div className="col-span-full py-20 bg-white border border-dashed border-[#a9dac9] rounded-[2.5rem] text-center">
            <Home className="w-16 h-16 text-[#e2e8e4] mx-auto mb-4" />
            <h3 className="text-xl font-bold text-[#0b3828] mb-2">No {classroomTerm.toLowerCase()} defined</h3>
            <p className="text-[#6b7a73] max-w-sm mx-auto mb-6">Create your {classroomTerm.toLowerCase()} to start assigning staff to specific age groups.</p>
            <button onClick={() => openModal()} className="text-[#157354] font-bold hover:underline">Add your first {classroomTerm.toLowerCase()} →</button>
          </div>
        ) : (
          classrooms.map((room) => (
            <div key={room.id} className="bg-white border border-[#e2e8e4] rounded-[2rem] p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
              <div className="flex items-start justify-between mb-6">
                <div className="w-12 h-12 rounded-2xl bg-[#edf7f3] text-[#157354] flex items-center justify-center shadow-sm">
                  <Home className="w-6 h-6" />
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openModal(room)} className="p-2 text-[#6b7a73] hover:text-[#157354] hover:bg-[#edf7f3] rounded-lg transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(room.id)} className="p-2 text-[#6b7a73] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <h3 className="text-xl font-black text-[#0b3828] mb-1 tracking-tight">{room.name}</h3>
              <div className="inline-flex items-center px-2.5 py-1 bg-[#f0fdf4] text-[#157354] rounded-lg text-xs font-bold uppercase tracking-widest border border-[#bbf7d0] mb-6">
                {room.age_group || 'Any Age'}
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-[#f0f4f2]">
                <div className="flex items-center gap-2 text-[#6b7a73]">
                  <Users className="w-4 h-4" />
                  <span className="text-xs font-bold">Capacity: {room.capacity || '—'}</span>
                </div>
                <div className="text-[10px] font-black uppercase tracking-widest text-[#a8b5ae]">Active</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b3828]/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 border-b border-[#e2e8e4] flex items-center justify-between bg-[#f8faf9]">
              <h2 className="text-2xl font-black text-[#0b3828] tracking-tight">{editingRoom ? `Edit ${classroomTerm}` : `New ${classroomTerm}`}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-[#e2e8e4] rounded-full transition-colors"><Trash2 className="w-5 h-5 text-[#6b7a73]" /></button>
            </div>
            
            <form onSubmit={handleSave} className="p-8 space-y-6">
              <div>
                <label className="block text-sm font-bold text-[#1a2e25] mb-2 uppercase tracking-widest text-[10px]">{classroomTerm} Name</label>
                <input 
                  autoFocus
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Toddler Room A"
                  className="w-full px-5 py-4 rounded-2xl border border-[#e2e8e4] focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-[#1a2e25] mb-2 uppercase tracking-widest text-[10px]">Age Group</label>
                  <input 
                    value={formAgeGroup}
                    onChange={(e) => setFormAgeGroup(e.target.value)}
                    placeholder="e.g. 2-3 years"
                    className="w-full px-5 py-4 rounded-2xl border border-[#e2e8e4] focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all font-medium"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-[#1a2e25] mb-2 uppercase tracking-widest text-[10px]">Capacity</label>
                  <input 
                    type="number"
                    value={formCapacity}
                    onChange={(e) => setFormCapacity(e.target.value)}
                    placeholder="e.g. 12"
                    className="w-full px-5 py-4 rounded-2xl border border-[#e2e8e4] focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all font-medium"
                  />
                </div>
              </div>

              <div className="pt-6 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-4 px-6 rounded-2xl border border-[#e2e8e4] font-bold text-[#6b7a73] hover:bg-[#f8faf9] transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={saving}
                  className="flex-3 bg-[#157354] text-white font-bold py-4 px-10 rounded-2xl hover:bg-[#0f4a36] shadow-lg shadow-[#157354]/20 transition-all flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
