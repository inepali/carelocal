'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Vendor } from '@/lib/types'
import { Plus, Edit2, Trash2, Loader2, Truck, Phone, Mail, Globe, X, Search, User } from 'lucide-react'

type VendorForm = {
  name: string
  service_type: string
  contact_name: string
  phone: string
  email: string
  website: string
  address: string
  notes: string
  is_active: boolean
}

const EMPTY_FORM: VendorForm = {
  name: '', service_type: '', contact_name: '', phone: '', email: '',
  website: '', address: '', notes: '', is_active: true,
}

const inputClass = 'w-full px-4 py-3 rounded-xl border border-[#e2e8e4] focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all font-medium'
const labelClass = 'block font-bold text-[#1a2e25] mb-2 uppercase tracking-widest text-[10px]'

export default function VendorsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [inspectionCounts, setInspectionCounts] = useState<Record<string, number>>({})
  const [centerId, setCenterId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Vendor | null>(null)
  const [form, setForm] = useState<VendorForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

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
      const [{ data: vendorRows }, { data: inspectionRows }] = await Promise.all([
        supabase.from('center_vendors').select('*').eq('center_id', admin.center_id).order('name'),
        supabase.from('center_inspections').select('vendor_id').eq('center_id', admin.center_id).not('vendor_id', 'is', null),
      ])
      setVendors(vendorRows || [])
      const counts: Record<string, number> = {}
      for (const row of inspectionRows || []) {
        if (row.vendor_id) counts[row.vendor_id] = (counts[row.vendor_id] || 0) + 1
      }
      setInspectionCounts(counts)
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return vendors.filter(v => {
      if (!showInactive && !v.is_active) return false
      if (!q) return true
      return [v.name, v.service_type, v.contact_name, v.email, v.phone]
        .some(f => f?.toLowerCase().includes(q))
    })
  }, [vendors, search, showInactive])

  function openModal(vendor: Vendor | null = null) {
    setError(null)
    setEditing(vendor)
    setForm(vendor ? {
      name: vendor.name,
      service_type: vendor.service_type || '',
      contact_name: vendor.contact_name || '',
      phone: vendor.phone || '',
      email: vendor.email || '',
      website: vendor.website || '',
      address: vendor.address || '',
      notes: vendor.notes || '',
      is_active: vendor.is_active,
    } : EMPTY_FORM)
    setIsModalOpen(true)
  }

  function set<K extends keyof VendorForm>(key: K, value: VendorForm[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!centerId) return
    const name = form.name.trim()
    if (!name) { setError('Vendor name is required.'); return }
    const email = form.email.trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email address.'); return }

    setSaving(true)
    setError(null)
    const clean = (s: string) => s.trim() || null
    const payload = {
      center_id: centerId,
      name,
      service_type: clean(form.service_type),
      contact_name: clean(form.contact_name),
      phone: clean(form.phone),
      email: email || null,
      website: clean(form.website),
      address: clean(form.address),
      notes: clean(form.notes),
      is_active: form.is_active,
    }

    const { error: err } = editing
      ? await supabase.from('center_vendors').update(payload).eq('id', editing.id)
      : await supabase.from('center_vendors').insert(payload)

    setSaving(false)
    if (err) { setError(err.message); return }
    setIsModalOpen(false)
    loadData()
  }

  async function handleDelete(vendor: Vendor) {
    const linked = inspectionCounts[vendor.id] || 0
    const msg = linked
      ? `"${vendor.name}" is assigned to ${linked} inspection${linked === 1 ? '' : 's'}. Deleting will clear the vendor on those inspections. Consider marking it inactive instead.\n\nDelete anyway?`
      : `Delete vendor "${vendor.name}"?`
    if (!confirm(msg)) return
    const { error: err } = await supabase.from('center_vendors').delete().eq('id', vendor.id)
    if (err) alert('Failed to delete vendor: ' + err.message)
    else loadData()
  }

  if (loading) {
    return <div className="animate-pulse space-y-6 pt-10 px-8">
      <div className="h-10 w-48 bg-slate-200 rounded-lg mb-8"></div>
      <div className="h-64 bg-white rounded-3xl border border-slate-100 shadow-sm"></div>
    </div>
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Vendors</h1>
          <p className="text-[#6b7a73]">Service providers you work with for inspections, maintenance, and repairs.</p>
        </div>
        <button
          onClick={() => openModal()}
          className="inline-flex items-center justify-center gap-2 bg-[#fbbf24] text-[#0b3828] font-bold px-6 py-3 rounded-xl hover:bg-[#f59e0b] shadow-sm transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" /> Add Vendor
        </button>
      </div>

      {vendors.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center mb-6">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#a8b5ae] absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search vendors…"
              className={`${inputClass} pl-10 bg-white`}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-[#6b7a73] font-medium">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="accent-[#157354]" />
            Show inactive
          </label>
        </div>
      )}

      {vendors.length === 0 ? (
        <div className="py-20 bg-white border border-dashed border-[#a9dac9] rounded-[2.5rem] text-center">
          <Truck className="w-16 h-16 text-[#e2e8e4] mx-auto mb-4" />
          <h3 className="text-xl font-bold text-[#0b3828] mb-2">No vendors yet</h3>
          <p className="text-[#6b7a73] max-w-sm mx-auto mb-6">Add the companies that service your center so you can assign them to inspections.</p>
          <button onClick={() => openModal()} className="text-[#157354] font-bold hover:underline">Add your first vendor →</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-[#6b7a73]">No vendors match your search.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(vendor => (
            <div key={vendor.id} className={`bg-white border border-[#e2e8e4] rounded-[2rem] p-6 shadow-sm hover:shadow-xl transition-all duration-300 group ${vendor.is_active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-[#edf7f3] text-[#157354] flex items-center justify-center shadow-sm">
                  <Truck className="w-6 h-6" />
                </div>
                <div className="flex items-center gap-1 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openModal(vendor)} aria-label="Edit vendor" className="p-2 text-[#6b7a73] hover:text-[#157354] hover:bg-[#edf7f3] rounded-lg transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(vendor)} aria-label="Delete vendor" className="p-2 text-[#6b7a73] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <h3 className="text-xl font-black text-[#0b3828] mb-1 tracking-tight">{vendor.name}</h3>
              <div className="flex flex-wrap gap-2 mb-4">
                {vendor.service_type && (
                  <span className="inline-flex items-center px-2.5 py-1 bg-[#f0fdf4] text-[#157354] rounded-lg text-xs font-bold uppercase tracking-widest border border-[#bbf7d0]">
                    {vendor.service_type}
                  </span>
                )}
                {!vendor.is_active && (
                  <span className="inline-flex items-center px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg text-xs font-bold uppercase tracking-widest">Inactive</span>
                )}
              </div>

              <div className="space-y-2 text-sm text-[#4a5a52]">
                {vendor.contact_name && <div className="flex items-center gap-2"><User className="w-4 h-4 text-[#a8b5ae]" />{vendor.contact_name}</div>}
                {vendor.phone && <a href={`tel:${vendor.phone}`} className="flex items-center gap-2 hover:text-[#157354]"><Phone className="w-4 h-4 text-[#a8b5ae]" />{vendor.phone}</a>}
                {vendor.email && <a href={`mailto:${vendor.email}`} className="flex items-center gap-2 hover:text-[#157354] truncate"><Mail className="w-4 h-4 text-[#a8b5ae] shrink-0" />{vendor.email}</a>}
                {vendor.website && (
                  <a href={/^https?:\/\//.test(vendor.website) ? vendor.website : `https://${vendor.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-[#157354] truncate">
                    <Globe className="w-4 h-4 text-[#a8b5ae] shrink-0" />{vendor.website}
                  </a>
                )}
              </div>

              <div className="pt-4 mt-4 border-t border-[#f0f4f2] text-xs font-bold text-[#6b7a73]">
                {inspectionCounts[vendor.id] || 0} inspection{(inspectionCounts[vendor.id] || 0) === 1 ? '' : 's'} assigned
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b3828]/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-[#e2e8e4] flex items-center justify-between bg-[#f8faf9]">
              <h2 className="text-2xl font-black text-[#0b3828] tracking-tight">{editing ? 'Edit Vendor' : 'New Vendor'}</h2>
              <button onClick={() => setIsModalOpen(false)} aria-label="Close" className="p-2 hover:bg-[#e2e8e4] rounded-full transition-colors"><X className="w-5 h-5 text-[#6b7a73]" /></button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelClass}>Vendor Name *</label>
                  <input autoFocus required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Carolina Fire Protection" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Service Type</label>
                  <input value={form.service_type} onChange={e => set('service_type', e.target.value)} placeholder="e.g. Fire safety" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Contact Name</label>
                  <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Phone</label>
                  <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Website</label>
                  <input value={form.website} onChange={e => set('website', e.target.value)} placeholder="example.com" className={inputClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Address</label>
                  <input value={form.address} onChange={e => set('address', e.target.value)} className={inputClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Notes</label>
                  <textarea rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} className={inputClass} />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm font-medium text-[#1a2e25]">
                <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} className="accent-[#157354]" />
                Active vendor
              </label>

              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}

              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 px-6 rounded-xl border border-[#e2e8e4] font-bold text-[#6b7a73] hover:bg-[#f8faf9] transition-all">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="flex-1 bg-[#157354] text-white font-bold py-3 px-6 rounded-xl hover:bg-[#0f4a36] shadow-lg shadow-[#157354]/20 transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
