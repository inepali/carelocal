'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MetroArea } from '@/lib/types'
import { MapPin, Plus, Edit2, Check, X, Loader2, Save } from 'lucide-react'

export default function AdminMetrosPage() {
  const supabase = createClient()
  const [metros, setMetros] = useState<MetroArea[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  
  const [formData, setFormData] = useState<Partial<MetroArea>>({
    name: '',
    slug: '',
    city: '',
    state_code: '',
    timezone: '',
    is_active: true,
    staff_maintenance_fee: 0.00
  })

  useEffect(() => {
    loadMetros()
  }, [])

  async function loadMetros() {
    setLoading(true)
    const { data } = await supabase
      .from('metro_areas')
      .select('*')
      .order('state_code', { ascending: true })
      .order('name', { ascending: true })
    setMetros(data || [])
    setLoading(false)
  }

  const handleEdit = (metro: MetroArea) => {
    setEditingId(metro.id)
    setFormData(metro)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setIsAdding(false)
    setFormData({ name: '', slug: '', city: '', state_code: '', timezone: '', is_active: true, staff_maintenance_fee: 0.00 })
  }

  const saveMetro = async () => {
    if (!formData.name || !formData.state_code || !formData.slug) return alert('Name, Slug, and State Code are required')

    if (isAdding) {
      const { error } = await supabase.from('metro_areas').insert([
        { 
          name: formData.name, 
          slug: formData.slug,
          city: formData.city,
          state_code: formData.state_code, 
          timezone: formData.timezone,
          is_active: formData.is_active,
          staff_maintenance_fee: formData.staff_maintenance_fee || 0.00
        }
      ])
      if (error) alert(error.message)
    } else if (editingId) {
      const { error } = await supabase.from('metro_areas').update({
          name: formData.name, 
          slug: formData.slug,
          city: formData.city,
          state_code: formData.state_code, 
          timezone: formData.timezone,
          is_active: formData.is_active,
          staff_maintenance_fee: formData.staff_maintenance_fee || 0.00
      }).eq('id', editingId)
      if (error) alert(error.message)
    }

    cancelEdit()
    loadMetros()
  }

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0f172a] mb-2">Metro Areas</h1>
          <p className="text-slate-500">Manage regional hubs, timezones, and activity status.</p>
        </div>
        {!isAdding && !editingId && (
          <button 
            onClick={() => { setIsAdding(true); setFormData({ name: '', slug: '', state_code: '', timezone: '', is_active: true, staff_maintenance_fee: 0.00 }) }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-colors"
          >
            <Plus className="w-5 h-5" /> Add Metro
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
          <MapPin className="w-5 h-5 text-slate-500" />
          <h2 className="font-bold text-slate-800">Regions & Timezones</h2>
        </div>

        <div className="p-0 overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50/50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Metro Name</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Slug</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">City</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">State</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Timezone</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Maint. Fee</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isAdding && (
                <tr className="bg-blue-50/30">
                  <td className="px-6 py-4">
                    <input autoFocus type="text" placeholder="Name" className="w-full px-3 py-2 text-sm border rounded-lg" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} />
                  </td>
                  <td className="px-6 py-4">
                    <input type="text" placeholder="slug" className="w-full px-3 py-2 text-sm border rounded-lg" value={formData.slug || ''} onChange={e => setFormData({...formData, slug: e.target.value})} />
                  </td>
                  <td className="px-6 py-4">
                    <input type="text" placeholder="City" className="w-full px-3 py-2 text-sm border rounded-lg" value={formData.city || ''} onChange={e => setFormData({...formData, city: e.target.value})} />
                  </td>
                  <td className="px-6 py-4">
                    <input type="text" placeholder="State (e.g. NC)" className="w-full px-3 py-2 text-sm border rounded-lg" value={formData.state_code || ''} onChange={e => setFormData({...formData, state_code: e.target.value})} />
                  </td>
                  <td className="px-6 py-4">
                    <select value={formData.timezone || ''} onChange={e => setFormData({...formData, timezone: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg">
                       <option value="">Select timezone...</option>
                       <option value="America/Puerto_Rico">Atlantic Time (AST)</option>
                       <option value="America/New_York">Eastern Time (EST)</option>
                       <option value="America/Chicago">Central Time (CST)</option>
                       <option value="America/Denver">Mountain Time (MST)</option>
                       <option value="America/Phoenix">Mountain Time - Arizona (MST)</option>
                       <option value="America/Los_Angeles">Pacific Time (PST)</option>
                       <option value="America/Anchorage">Alaska Time (AKST)</option>
                       <option value="Pacific/Honolulu">Hawaii Time (HST)</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4" />
                      Active
                    </label>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400 text-sm">$</span>
                      <input type="number" min="0" max="10" step="0.50" placeholder="0.00" className="w-20 px-2 py-1.5 text-sm border rounded-lg" value={formData.staff_maintenance_fee !== undefined ? formData.staff_maintenance_fee : ''} onChange={e => setFormData({...formData, staff_maintenance_fee: parseFloat(e.target.value) || 0})} />
                    </div>
                  </td>
                  <td className="px-6 py-4 flex items-center justify-end gap-2">
                    <button onClick={saveMetro} className="p-2 text-green-600 hover:bg-green-50 rounded-lg"><Check className="w-4 h-4" /></button>
                    <button onClick={cancelEdit} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button>
                  </td>
                </tr>
              )}
              
              {loading && !isAdding ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></td></tr>
              ) : metros.length === 0 && !isAdding ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">No Metro Areas found.</td></tr>
              ) : metros.map(metro => (
                editingId === metro.id ? (
                  <tr key={metro.id} className="bg-blue-50/30">
                    <td className="px-6 py-4">
                      <input autoFocus type="text" placeholder="Name" className="w-full px-3 py-2 text-sm border rounded-lg" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} />
                    </td>
                    <td className="px-6 py-4">
                      <input type="text" placeholder="slug" className="w-full px-3 py-2 text-sm border rounded-lg" value={formData.slug || ''} onChange={e => setFormData({...formData, slug: e.target.value})} />
                    </td>
                    <td className="px-6 py-4">
                      <input type="text" placeholder="City" className="w-full px-3 py-2 text-sm border rounded-lg" value={formData.city || ''} onChange={e => setFormData({...formData, city: e.target.value})} />
                    </td>
                    <td className="px-6 py-4">
                      <input type="text" placeholder="State (e.g. NC)" className="w-full px-3 py-2 text-sm border rounded-lg" value={formData.state_code || ''} onChange={e => setFormData({...formData, state_code: e.target.value})} />
                    </td>
                    <td className="px-6 py-4">
                      <select value={formData.timezone || ''} onChange={e => setFormData({...formData, timezone: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg">
                         <option value="">Select timezone...</option>
                         <option value="America/Puerto_Rico">Atlantic Time (AST)</option>
                         <option value="America/New_York">Eastern Time (EST)</option>
                         <option value="America/Chicago">Central Time (CST)</option>
                         <option value="America/Denver">Mountain Time (MST)</option>
                         <option value="America/Phoenix">Mountain Time - Arizona (MST)</option>
                         <option value="America/Los_Angeles">Pacific Time (PST)</option>
                         <option value="America/Anchorage">Alaska Time (AKST)</option>
                         <option value="Pacific/Honolulu">Hawaii Time (HST)</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4" />
                        Active
                      </label>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 text-sm">$</span>
                        <input type="number" min="0" max="10" step="0.50" placeholder="0.00" className="w-20 px-2 py-1.5 text-sm border rounded-lg" value={formData.staff_maintenance_fee !== undefined ? formData.staff_maintenance_fee : ''} onChange={e => setFormData({...formData, staff_maintenance_fee: parseFloat(e.target.value) || 0})} />
                      </div>
                    </td>
                    <td className="px-6 py-4 flex items-center justify-end gap-2">
                      <button onClick={saveMetro} className="p-2 text-green-600 hover:bg-green-50 rounded-lg"><Check className="w-4 h-4" /></button>
                      <button onClick={cancelEdit} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ) : (
                  <tr key={metro.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-semibold text-slate-800">{metro.name}</td>
                    <td className="px-6 py-4 text-slate-500 text-sm">{metro.slug}</td>
                    <td className="px-6 py-4 text-slate-500 text-sm">{metro.city || <span className="italic text-slate-300">N/A</span>}</td>
                    <td className="px-6 py-4 text-slate-600 font-medium">
                      <span className="bg-slate-100 px-2.5 py-1 rounded-md text-xs border border-slate-200">{metro.state_code}</span>
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-sm">
                      {metro.timezone ? (
                        <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {metro.timezone}</span>
                      ) : <span className="text-slate-300 italic">Not set</span>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${metro.is_active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {metro.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-700 font-semibold text-sm">
                      ${(metro.staff_maintenance_fee || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => handleEdit(metro)}
                        disabled={!!editingId || isAdding}
                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
