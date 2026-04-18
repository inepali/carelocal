'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CenterDocumentRequirement, STAFF_TYPE_LABELS, StaffType, DocumentCategory, DOCUMENT_CATEGORY_LABELS } from '@/lib/types'
import { FileText, Plus, Trash2, Settings2, Info, CheckCircle2, Loader2, AlertCircle, FileStack, Upload, X, Download } from 'lucide-react'
import { getPresignedUploadUrl, deleteFile, getPresignedViewUrl } from '@/app/actions/storage.actions'

const STAFF_TYPES: { label: string; value: StaffType }[] = [
  { label: 'Teacher', value: 'teacher' },
  { label: 'Floater', value: 'floater' },
  { label: 'Support Staff', value: 'support' },
  { label: 'Cook', value: 'cook' },
  { label: 'Driver', value: 'driver' },
  { label: 'Admin', value: 'admin' },
]

export default function CenterDocumentsConfigPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])

  // Form State
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [reqName, setReqName] = useState('')
  const [isRequired, setIsRequired] = useState(true)
  const [reqCategory, setReqCategory] = useState<DocumentCategory>('other')
  const [applicableTypes, setApplicableTypes] = useState<StaffType[]>([])

  // Template State
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [existingTemplate, setExistingTemplate] = useState<{ key: string, bucket: string, name: string } | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState(false)

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setAdding(false)
      return
    }

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    if (!admin) {
      setAdding(false)
      return
    }

    let templateData = editingId ? {
      template_file_key: existingTemplate?.key,
      template_bucket_name: existingTemplate?.bucket,
      template_file_name: existingTemplate?.name
    } : {
      template_file_key: undefined,
      template_bucket_name: 'centeruploads',
      template_file_name: undefined
    }

    // Handle Template Upload if selected
    if (templateFile) {
      const uploadRes = await getPresignedUploadUrl(templateFile.name, templateFile.type, 'center')
      if (uploadRes.success && uploadRes.uploadUrl && uploadRes.fileKey && uploadRes.bucketName) {
        const uploadResponse = await fetch(uploadRes.uploadUrl, {
          method: 'PUT',
          body: templateFile,
          headers: { 'Content-Type': templateFile.type }
        })

        if (uploadResponse.ok) {
          // If we are replacing an existing template, delete the old one
          if (existingTemplate?.key) {
            await deleteFile(existingTemplate.key, existingTemplate.bucket)
          }

          templateData = {
            template_file_key: uploadRes.fileKey,
            template_bucket_name: uploadRes.bucketName,
            template_file_name: templateFile.name
          }
        } else {
          alert('Failed to upload template file')
          setAdding(false)
          return
        }
      } else {
        alert('Failed to generate template upload link')
        setAdding(false)
        return
      }
    }

    const payload = {
      center_id: admin.center_id,
      document_name: reqName,
      document_category: reqCategory,
      is_required: isRequired,
      applies_to: applicableTypes.length > 0 ? applicableTypes : null,
      ...templateData
    }

    if (editingId) {
      const { error } = await supabase
        .from('center_document_requirements')
        .update(payload)
        .eq('id', editingId)

      if (!error) {
        cancelEdit()
        loadRequirements()
      }
    } else {
      const { error } = await supabase
        .from('center_document_requirements')
        .insert({
          ...payload,
          sort_order: requirements.length
        })

      if (!error) {
        setReqName('')
        setShowAdd(false)
        setTemplateFile(null)
        loadRequirements()
      }
    }
    setAdding(false)
  }

  function startEdit(req: CenterDocumentRequirement) {
    setEditingId(req.id)
    setReqName(req.document_name)
    setReqCategory(req.document_category)
    setIsRequired(req.is_required)
    setApplicableTypes(req.applies_to || [])
    if (req.template_file_key && req.template_bucket_name) {
      setExistingTemplate({
        key: req.template_file_key,
        bucket: req.template_bucket_name,
        name: req.template_file_name || 'Attached Form'
      })
    } else {
      setExistingTemplate(null)
    }
    setShowAdd(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setReqName('')
    setReqCategory('other')
    setIsRequired(true)
    setApplicableTypes([])
    setTemplateFile(null)
    setExistingTemplate(null)
    setShowAdd(false)
  }

  async function handleRemoveTemplate() {
    if (!editingId || !existingTemplate) {
      setExistingTemplate(null)
      return
    }

    if (!confirm('Are you sure you want to remove the template from this requirement?')) return

    setDeletingTemplate(true)
    const { success } = await deleteFile(existingTemplate.key, existingTemplate.bucket)
    if (success) {
      const { error } = await supabase
        .from('center_document_requirements')
        .update({
          template_file_key: null,
          template_file_name: null
        })
        .eq('id', editingId)

      if (!error) {
        setExistingTemplate(null)
        loadRequirements()
      }
    }
    setDeletingTemplate(false)
  }

  async function handleViewTemplate(key: string, bucket: string) {
    const res = await getPresignedViewUrl(key, bucket)
    if (res.success && res.url) {
      window.open(res.url, '_blank')
    } else {
      alert('Could not open file')
    }
  }

  async function deleteRequirement(id: string) {
    const req = requirements.find(r => r.id === id)
    if (!confirm('Are you sure? This will remove this requirement for all your staff.')) return

    const { error } = await supabase
      .from('center_document_requirements')
      .delete()
      .eq('id', id)

    if (!error) {
      // Also delete the template if it exists
      if (req?.template_file_key && req?.template_bucket_name) {
        await deleteFile(req.template_file_key, req.template_bucket_name)
      }

      if (editingId === id) cancelEdit()
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
          onClick={showAdd ? cancelEdit : () => setShowAdd(true)}
          className={`inline-flex items-center justify-center gap-2 font-semibold px-6 py-3 rounded-xl shadow-sm transition-colors ${showAdd ? 'bg-white text-[#6b7a73] border border-[#e2e8e4] hover:bg-gray-50' : 'bg-[#157354] text-white hover:bg-[#0f4a36]'
            }`}
        >
          {showAdd ? 'Cancel' : <><Plus className="w-5 h-5" /> Add Requirement</>}
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* ── Left: Instructions ── */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-[#edf7f3] border border-[#a9dac9] rounded-2xl p-6">
            <h3 className="font-bold text-[#0b3828] flex items-center gap-2 mb-3">
              <Info className="w-5 h-5" /> {editingId ? 'Editing Requirement' : 'How this works'}
            </h3>
            {editingId ? (
              <p className="text-sm text-[#3d5a4f] leading-relaxed">
                You are currently editing <strong>{reqName || 'a requirement'}</strong>.
                Changes will be updated for all staff members who have this on their checklist.
              </p>
            ) : (
              <ul className="text-sm text-[#3d5a4f] space-y-3">
                <li>• Each requirement you add here appears on your staff's checklist.</li>
                <li>• You will be notified when staff upload a document for review.</li>
                <li>• You can mark requirements as "Optional" for certain staff types.</li>
                <li>• <strong>You</strong> are responsible for verifying if the uploaded document meets your state standards.</li>
              </ul>
            )}
          </div>
        </div>

        {/* ── Right: Requirements List ── */}
        <div className="lg:col-span-2 space-y-6">
          {showAdd && (
            <div className="bg-white border-2 border-[#157354] rounded-2xl p-6 shadow-lg animate-in fade-in slide-in-from-top-4">
              <h2 className="text-lg font-bold text-[#1a2e25] mb-4">
                {editingId ? 'Edit Requirement' : 'New Requirement'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
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

                <div>
                  <label className="block text-sm font-medium text-[#1a2e25] mb-1.5 uppercase tracking-widest text-[10px]">Document Type / Category</label>
                  <select
                    value={reqCategory}
                    onChange={(e) => setReqCategory(e.target.value as DocumentCategory)}
                    className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 font-bold text-sm"
                  >
                    {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-[#a8b5ae] mt-2 italic">The category helps staff filter their vault to find the right document for this requirement.</p>
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
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${applicableTypes.includes(type.value)
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

                <div className="border-t border-[#e2e8e4] pt-6">
                  <label className="block text-sm font-bold text-[#1a2e25] mb-2 uppercase tracking-wide text-[10px]">Attach Form or Template (Optional)</label>

                  {existingTemplate && !templateFile ? (
                    <div className="flex items-center justify-between p-3 bg-[#f8faf9] rounded-xl border border-[#e2e8e4]">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-[#157354]" />
                        <div>
                          <p className="text-xs font-bold text-[#1a2e25]">{existingTemplate.name}</p>
                          <button
                            type="button"
                            onClick={() => handleViewTemplate(existingTemplate.key, existingTemplate.bucket)}
                            className="text-[10px] text-[#157354] hover:underline font-bold"
                          >
                            View attached file
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={deletingTemplate}
                        onClick={handleRemoveTemplate}
                        className="p-1.5 text-[#6b7a73] hover:text-red-500 transition-colors"
                      >
                        {deletingTemplate ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="relative">
                        <input
                          type="file"
                          id="template_upload"
                          className="hidden"
                          onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
                          accept=".pdf,.doc,.docx,.jpg,.png"
                        />
                        <label
                          htmlFor="template_upload"
                          className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-[#e2e8e4] rounded-2xl cursor-pointer hover:border-[#157354] hover:bg-[#f8faf9] transition-all group"
                        >
                          {templateFile ? (
                            <>
                              <CheckCircle2 className="w-8 h-8 text-[#157354] mb-2" />
                              <p className="text-sm font-bold text-[#1a2e25]">{templateFile.name}</p>
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); setTemplateFile(null); }}
                                className="mt-2 text-xs text-red-500 font-bold hover:underline"
                              >
                                Remove selection
                              </button>
                            </>
                          ) : (
                            <>
                              <Upload className="w-8 h-8 text-[#a8b5ae] mb-2 group-hover:text-[#157354]" />
                              <p className="text-sm font-medium text-[#6b7a73]">Click to upload instructions or a blank form</p>
                              <p className="text-[10px] text-[#a8b5ae] mt-1">PDF, Word, or Images up to 5MB</p>
                            </>
                          )}
                        </label>
                      </div>
                      {existingTemplate && templateFile && (
                        <p className="text-[10px] text-amber-600 font-bold flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> This will replace the current template when you save.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 flex gap-3">
                  {editingId && (
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="flex-1 bg-white text-[#6b7a73] font-bold py-3 rounded-xl border border-[#e2e8e4] hover:bg-gray-50 transition-all"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={adding || !reqName}
                    className="flex-[2] flex items-center justify-center gap-2 bg-[#157354] text-white font-bold py-3 rounded-xl hover:bg-[#0f4a36] disabled:opacity-50 transition-all shadow-md"
                  >
                    {adding ? <Loader2 className="w-5 h-5 animate-spin" /> : (editingId ? 'Update Requirement' : 'Create Requirement')}
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
                      <div className="flex items-center gap-3 mt-1 text-[#6b7a73]">
                        <span className="text-[10px] font-black uppercase tracking-widest bg-[#f8faf9] px-2 py-0.5 rounded border border-[#e2e8e4] text-[#a8b5ae]">
                          {DOCUMENT_CATEGORY_LABELS[req.document_category]}
                        </span>
                        <span className="text-xs">
                          {req.applies_to ? `Applies to: ${req.applies_to.join(', ')}` : 'Applies to all staff'}
                        </span>
                        {req.template_file_key && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-[#157354] bg-[#edf7f3] px-2 py-0.5 rounded-full border border-[#a9dac9]">
                            <Download className="w-3 h-3" /> Form Attached
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(req)}
                        className="p-2 text-[#6b7a73] hover:text-[#157354] hover:bg-[#edf7f3] rounded-lg transition-colors border border-transparent hover:border-[#a9dac9]"
                        title="Edit Requirement"
                      >
                        <Settings2 className="w-5 h-5" />
                      </button>
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
