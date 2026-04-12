'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CenterDocumentRequirement, STAFF_TYPE_LABELS, StaffType } from '@/lib/types'
import { FileText, Plus, Trash2, Settings2, Info, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'

const STAFF_TYPES: { label: string; value: StaffType }[] = [
  { label: 'Teacher', value: 'teacher' },
  { label: 'Floater', value: 'floater' },
  { label: 'Support Staff', value: 'support' },
  { label: 'Cook', value: 'cook' },
]

export default function CenterDocumentsConfigPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])
  
  // Form State
  const [showAdd, setShowAdd] = useState(false)
  const [reqName, setReqName] = useState('')
  const [isRequired, setIsRequired] = useState(true)
  const [applicableTypes, setApplicableTypes] = useState<StaffType[]>([])

  useEffect(() => {
    loadRequirements()
  }, [])

  async function loadRequirements() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    if (admin) {
      const { data } = await supabase
        .from('center_document_requirements')
        .select('*')
        .eq('center_id', admin.center_id)
        .order('sort_order', { ascending: true })
      
      setRequirements(data || [])
    }
    setLoading(false)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)

    const { data: { user } } = await supabase.auth.getUser()
    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id!)
      .single()

    const { error } = await supabase
      .from('center_document_requirements')
      .insert({
        center_id: admin.center_id,
        document_name: reqName,
        is_required: isRequired,
        applies_to: applicableTypes.length > 0 ? applicableTypes : null,
        sort_order: requirements.length
      })

    if (!error) {
      setReqName('')
      setShowAdd(false)
      loadRequirements()
    }
    setAdding(false)
  }

  async function deleteRequirement(id: string) {
    if (!confirm('Are you sure? This will remove this requirement for all your staff.')) return
    
    const { error } = await supabase
      .from('center_document_requirements')
      .delete()
      .eq('id', id)
    
    if (!error) {
      setRequirements(requirements.filter(r => r.id !== id))
    }
  }

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-64 bg-white rounded-2xl border border-[#e2e8e4]"></div>
    </div>
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">Document Requirements</h1>
          <p className="text-[#6b7a73]">Define which documents are required for staff to work at your center.</p>
        </div>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center justify-center gap-2 bg-[#157354] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#0f4a36] shadow-sm transition-colors"
        >
          <Plus className="w-5 h-5" /> {showAdd ? 'Cancel' : 'Add Requirement'}
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* ── Left: Instructions ── */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-[#edf7f3] border border-[#a9dac9] rounded-2xl p-6">
            <h3 className="font-bold text-[#0b3828] flex items-center gap-2 mb-3">
              <Info className="w-5 h-5" /> How this works
            </h3>
            <ul className="text-sm text-[#3d5a4f] space-y-3">
              <li>• Each requirement you add here appears on your staff's checklist.</li>
              <li>• You will be notified when staff upload a document for review.</li>
              <li>• You can mark requirements as "Optional" for certain staff types.</li>
              <li>• <strong>You</strong> are responsible for verifying if the uploaded document meets your state standards.</li>
            </ul>
          </div>
        </div>

        {/* ── Right: Requirements List ── */}
        <div className="lg:col-span-2 space-y-6">
          {showAdd && (
            <div className="bg-white border-2 border-[#157354] rounded-2xl p-6 shadow-lg animate-in fade-in slide-in-from-top-4">
              <h2 className="text-lg font-bold text-[#1a2e25] mb-4">New Requirement</h2>
              <form onSubmit={handleAdd} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Requirement Name</label>
                  <input 
                    type="text" 
                    required
                    value={reqName}
                    onChange={(e) => setReqName(e.target.value)}
                    placeholder="e.g. State Fingerprint Clearance"
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    id="is_req" 
                    checked={isRequired}
                    onChange={(e) => setIsRequired(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-[#157354] focus:ring-[#157354]" 
                  />
                  <label htmlFor="is_req" className="text-sm font-medium text-[#1a2e25]">This is a mandatory requirement</label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#1a2e25] mb-1.5 text-xs text-muted-foreground uppercase tracking-widest">Applicable Roles</label>
                  <div className="flex flex-wrap gap-2">
                    {STAFF_TYPES.map(type => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => {
                          if (applicableTypes.includes(type.value)) {
                            setApplicableTypes(applicableTypes.filter(t => t !== type.value))
                          } else {
                            setApplicableTypes([...applicableTypes, type.value])
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                          applicableTypes.includes(type.value) 
                            ? 'bg-[#157354] text-white border-[#157354]' 
                            : 'bg-white text-[#6b7a73] border-[#e2e8e4] hover:bg-gray-50'
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#a8b5ae] mt-2 italic">If none selected, it applies to all roles.</p>
                </div>

                <div className="pt-2">
                  <button 
                    type="submit"
                    disabled={adding || !reqName}
                    className="w-full flex items-center justify-center gap-2 bg-[#157354] text-white font-bold py-3 rounded-xl hover:bg-[#0f4a36] disabled:opacity-50 transition-all shadow-md"
                  >
                    {adding ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create Requirement'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {requirements.length === 0 ? (
            <div className="bg-white border border-[#e2e8e4] rounded-2xl p-12 text-center shadow-sm">
              <Settings2 className="w-12 h-12 text-[#e2e8e4] mx-auto mb-4" />
              <h2 className="text-xl font-bold text-[#0b3828] mb-2">No requirements defined</h2>
              <p className="text-[#6b7a73] max-w-sm mx-auto mb-6">
                Start by adding the common documents you need from your staff, like CPR certifications or Background Checks.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-[#e2e8e4] rounded-2xl shadow-sm overflow-hidden text-sm">
              <div className="p-4 bg-[#f8faf9] border-b border-[#e2e8e4] font-bold text-[#0b3828] flex items-center gap-2 uppercase tracking-widest text-xs">
                <FileText className="w-4 h-4" /> Configured Requirements
              </div>
              <div className="divide-y divide-[#e2e8e4]">
                {requirements.map((req) => (
                  <div key={req.id} className="p-6 flex items-center justify-between hover:bg-[#f8faf9] transition-colors group">
                    <div>
                      <h3 className="font-bold text-[#1a2e25] flex items-center gap-2 text-base">
                        {req.document_name}
                        {req.is_required && (
                          <span className="text-[10px] bg-[#157354] text-white px-2 py-0.5 rounded-full uppercase tracking-tighter">Required</span>
                        )}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 text-[#6b7a73]">
                        <span className="text-xs">
                          {req.applies_to ? `Applies to: ${req.applies_to.join(', ')}` : 'Applies to all staff'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => deleteRequirement(req.id)}
                        className="p-2 text-[#6b7a73] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                        title="Delete Requirement"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
