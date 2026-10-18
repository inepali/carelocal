'use client'

import { useEffect, useState, Suspense, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { deleteVaultDocument } from '@/app/actions/storage.actions'
import { openStoredFile, uploadStoredFile, DOCUMENT_ACCEPT } from '@/lib/files'
import { appliesToEmploymentClass, type CenterDocumentRequirement, type CenterStaffDocumentStatus as SharedStatus } from '@/lib/types'
import { computeCompliance, COMPLIANCE_STATE_STYLE, formatDate } from '@/lib/compliance'
import { RequestInbox } from '@/components/staff/RequestInbox'
import { useLookups } from '@/hooks/use-lookups'
import { lookupLabel } from '@/lib/lookups'
import { 
  FileText, 
  Upload, 
  Trash2, 
  Eye, 
  CheckCircle2, 
  Loader2, 
  ShieldCheck, 
  ChevronRight, 
  X, 
  Download
} from 'lucide-react'
import { showAlert, showConfirm } from '@/lib/dialog'

interface StaffProfile {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  balance_due: number | null
  staff_type: string
}

interface StaffDocument {
  id: string
  document_name: string
  document_category: string
  expiry_date: string | null
  file_url: string
  file_key: string | null
  bucket_name: string | null
  uploaded_at: string
}

interface Center {
  id: string
  name: string
  slug: string
}

type Requirement = CenterDocumentRequirement
type CenterStaffDocumentStatus = Omit<SharedStatus, 'matched_document'>


export default function MobileDocumentsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
      </div>
    }>
      <DocumentsContent />
    </Suspense>
  )
}

function DocumentsContent() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const centerSlug = searchParams.get('center')

  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<StaffProfile | null>(null)
  const { data: docTypes } = useLookups('Document Type')
  const [documents, setDocuments] = useState<StaffDocument[]>([])
  
  // Center requirements state (if center query parameter is present)
  const [center, setCenter] = useState<Center | null>(null)
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [centerDocStatuses, setCenterDocStatuses] = useState<CenterStaffDocumentStatus[]>([])
  const [startDate, setStartDate] = useState<string | null>(null)
  const [signingReq, setSigningReq] = useState<string | null>(null)
  const [signature, setSignature] = useState('')
  const [linkingReq, setLinkingReq] = useState<Requirement | null>(null)

  // Upload Form State
  const [showUpload, setShowUpload] = useState(false)
  const [docName, setDocName] = useState('')
  const [docCategory, setDocCategory] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  // UI state
  const [activeTab, setActiveTab] = useState<'vault' | 'onboarding'>('vault')

  useEffect(() => {
    if (centerSlug) {
      setActiveTab('onboarding')
    }
  }, [centerSlug])

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // 1. Fetch Profile
    const { data: staffProfile } = await supabase
      .from('staff_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (!staffProfile) {
      setLoading(false)
      return
    }
    setProfile(staffProfile)

    // 2. Fetch Vault Documents
    const { data: docs } = await supabase
      .from('staff_documents')
      .select('*')
      .eq('staff_id', staffProfile.id)
      .order('uploaded_at', { ascending: false })
    
    setDocuments(docs || [])

    // 3. Fetch Center and Checklist if slug exists
    if (centerSlug) {
      const { data: centerData } = await supabase
        .from('centers')
        .select('*')
        .eq('slug', centerSlug)
        .single()

      if (centerData) {
        setCenter(centerData)

        // Fetch my employment class at this center (set by the center admin)
        const { data: membership } = await supabase
          .from('center_staff')
          .select('employment_class, employment_start_date')
          .eq('center_id', centerData.id)
          .eq('staff_id', staffProfile.id)
          .maybeSingle()

        // Fetch center requirements that apply to my class
        const { data: reqs } = await supabase
          .from('center_document_requirements')
          .select('*')
          .eq('center_id', centerData.id)
          .order('sort_order', { ascending: true })
        setRequirements((reqs || []).filter(r => !r.is_internal && appliesToEmploymentClass(r, membership?.employment_class)))
        setStartDate(membership?.employment_start_date ?? null)

        // Fetch statuses
        const { data: statusData } = await supabase
          .from('center_staff_document_status')
          .select('*, matched_document:staff_documents(*)')
          .eq('center_id', centerData.id)
          .eq('staff_id', staffProfile.id)
        setCenterDocStatuses(statusData || [])
      }
    }
    setLoading(false)
  }, [supabase, centerSlug])

  useEffect(() => {
    loadData()
  }, [loadData])


  const handleDelete = async (id: string) => {
    if (!profile) return
    if (!await showConfirm('Are you sure you want to delete this document from your vault?')) return

    const res = await deleteVaultDocument(id)

    if (!res.success) {
      showAlert('Delete failed: ' + res.error)
    } else {
      setDocuments(prev => prev.filter(d => d.id !== id))
      // Reload center checklists to update linked statuses
      if (center) {
        const { data: statusData } = await supabase
          .from('center_staff_document_status')
          .select('*, matched_document:staff_documents(*)')
          .eq('center_id', center.id)
          .eq('staff_id', profile.id)
        setCenterDocStatuses(statusData || [])
      }
    }
  }

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFile || !docCategory || !profile) {
      showAlert('Please complete all form fields')
      return
    }

    setUploading(true)

    try {
      const { fileKey, bucketName } = await uploadStoredFile('vault', selectedFile)

      // 3. Save reference in staff_documents
      const { error } = await supabase
        .from('staff_documents')
        .insert({
          staff_id: profile.id,
          document_name: docName || selectedFile.name,
          document_category: docCategory,
          expiry_date: expiryDate || null,
          file_url: 'r2_private_access',
          file_key: fileKey,
          bucket_name: bucketName,
          file_name: selectedFile.name
        })

      if (error) {
        throw error
      }

      // Reset Form
      setDocName('')
      setDocCategory('')
      setExpiryDate('')
      setSelectedFile(null)
      setShowUpload(false)
      await loadData()
    } catch (err: unknown) {
      console.error(err)
      showAlert('Upload failed: ' + (err instanceof Error ? err.message : 'Server error'))
    } finally {
      setUploading(false)
    }
  }

  const handleLinkDoc = async (reqId: string, docId: string) => {
    if (!center || !profile) return

    const { error } = await supabase
      .from('center_staff_document_status')
      .upsert({
        center_id: center.id,
        staff_id: profile.id,
        requirement_id: reqId,
        matched_document_id: docId,
        status: 'pending_review',
        center_reviewed: false
      }, { onConflict: 'center_id,staff_id,requirement_id' })

    if (error) {
      showAlert('Linking failed: ' + error.message)
    } else {
      setLinkingReq(null)
      // Reload statuses
      const { data: statusData } = await supabase
        .from('center_staff_document_status')
        .select('*, matched_document:staff_documents(*)')
        .eq('center_id', center.id)
        .eq('staff_id', profile.id)
      setCenterDocStatuses(statusData || [])
    }
  }

  const handleDownloadTemplate = (req: Requirement) => {
    if (req.template_file_key) openStoredFile('template', req.id)
  }

  if (loading) {
    return (
      <div className="space-y-4 py-4 animate-pulse">
        <div className="h-6 w-3/4 bg-slate-200 rounded-xl mb-6"></div>
        <div className="h-44 bg-white rounded-2xl border border-slate-100"></div>
      </div>
    )
  }

  // Calculate matching status metrics for center onboarding checklist
  const checklistRows = requirements.map(req => {
    const record = centerDocStatuses.find(s => s.requirement_id === req.id) ?? null
    const doc = record?.matched_document_id ? documents.find(d => d.id === record.matched_document_id) : undefined
    return { req, record, result: computeCompliance(req, record, startDate, doc?.expiry_date) }
  })
  const applicableRows = checklistRows.filter(r => r.result.state !== 'not_applicable')
  const progressCount = applicableRows.filter(r => r.record?.status === 'accepted' && (r.result.state === 'current' || r.result.state === 'due_soon')).length

  const handleSign = async (req: Requirement) => {
    if (!signature.trim()) return
    const { error } = await supabase.rpc('acknowledge_requirement', { p_requirement_id: req.id, p_signature: signature.trim() })
    if (error) { showAlert(error.message); return }
    setSigningReq(null)
    setSignature('')
    await loadData()
  }

  return (
    <div className="py-2">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-heading tracking-tight">Credentials</h1>
          <p className="text-xs text-muted font-medium mt-1">Manage licenses, training, and certifications.</p>
        </div>
        {!showUpload && activeTab === 'vault' && (
          <button
            onClick={() => setShowUpload(true)}
            className="bg-brand-600 hover:bg-brand-800 text-white font-bold p-2.5 rounded-xl shadow-sm text-xs transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Upload className="w-4 h-4" /> Upload
          </button>
        )}
      </div>

      {/* Toggle tabs if center is active */}
      {center && (
        <div className="bg-slate-100 p-1 rounded-xl flex gap-1 mb-6">
          <button
            onClick={() => setActiveTab('onboarding')}
            className={`flex-1 text-center py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'onboarding'
                ? 'bg-white text-heading shadow-sm'
                : 'text-muted hover:text-heading'
            }`}
          >
            Checklist ({progressCount}/{applicableRows.length})
          </button>
          <button
            onClick={() => setActiveTab('vault')}
            className={`flex-1 text-center py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'vault'
                ? 'bg-white text-heading shadow-sm'
                : 'text-muted hover:text-heading'
            }`}
          >
            My Vault ({documents.length})
          </button>
        </div>
      )}

      {/* ── SHOW UPLOAD FORM ── */}
      {showUpload && activeTab === 'vault' && (
        <div className="bg-white border border-border rounded-2xl p-5 shadow-md mb-6 animate-in slide-in-from-top-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-black text-heading uppercase tracking-wider">Upload New Credential</h2>
            <button 
              onClick={() => setShowUpload(false)}
              className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-heading mb-1.5 uppercase tracking-wider">
                Select File (PDF or Image)
              </label>
              <label className={`
                relative flex flex-col items-center justify-center w-full h-28 
                border border-dashed rounded-xl cursor-pointer transition-all
                ${selectedFile ? 'border-brand-600 bg-brand-50' : 'border-slate-300 hover:bg-surface'}
              `}>
                <input 
                  type="file" 
                  className="hidden" 
                  accept={DOCUMENT_ACCEPT}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    setSelectedFile(file)
                    if (file && !docName) {
                      setDocName(file.name.substring(0, file.name.lastIndexOf('.')) || file.name)
                    }
                  }}
                />
                {selectedFile ? (
                  <div className="flex flex-col items-center p-2">
                    <CheckCircle2 className="w-6 h-6 text-brand-600 mb-1" />
                    <span className="text-xs font-bold text-heading max-w-[220px] truncate">{selectedFile.name}</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">Click to replace file</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center p-2 text-center">
                    <Upload className="w-6 h-6 text-subtle mb-1" />
                    <span className="text-xs font-semibold text-muted">Click to choose PDF or Image</span>
                  </div>
                )}
              </label>
            </div>

            <div>
              <label className="block text-[10px] font-black text-heading mb-1 uppercase tracking-wider">Document Name</label>
              <input 
                type="text" 
                required
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="e.g. CPR & First Aid Certificate"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-surface focus:outline-none focus:border-brand-600"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-heading mb-1 uppercase tracking-wider">Category</label>
              <select
                required
                value={docCategory}
                onChange={(e) => setDocCategory(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-surface focus:outline-none focus:border-brand-600"
              >
                <option value="" disabled>Select Category</option>
                {docTypes.filter(c => c.is_active).map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-heading mb-1 uppercase tracking-wider">Expiry Date (Optional)</label>
              <input 
                type="date" 
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-surface focus:outline-none focus:border-brand-600"
              />
            </div>

            <button 
              type="submit"
              disabled={uploading || !selectedFile || !docCategory}
              className="w-full bg-brand-600 text-white font-bold py-3.5 rounded-xl hover:bg-brand-800 text-xs uppercase tracking-wider shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Uploading to Secure R2...
                </>
              ) : 'Save Document'}
            </button>
          </form>
        </div>
      )}

      {/* ── VAULT DOCUMENTS TAB ── */}
      {activeTab === 'vault' && (
        <div className="space-y-3">
          <RequestInbox variant="mobile" />
          {documents.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-border px-4">
              <FileText className="w-10 h-10 text-subtle mx-auto mb-3" />
              <h3 className="text-base font-bold text-heading mb-1">No Documents Uploaded</h3>
              <p className="text-xs text-muted font-medium max-w-xs mx-auto mb-4">
                Upload credentials like CPR certificates, fingerprint clearances, or state teaching licenses to apply for shifts.
              </p>
              <button
                onClick={() => setShowUpload(true)}
                className="inline-flex items-center justify-center gap-1.5 bg-brand-50 border border-brand-100 text-brand-600 font-bold py-2.5 px-4 rounded-xl text-xs uppercase tracking-wider hover:bg-brand-600 hover:text-white transition-all cursor-pointer shadow-sm"
              >
                <Upload className="w-3.5 h-3.5" /> Upload First File
              </button>
            </div>
          ) : (
            documents.map((doc) => {
              const categoryLabel = lookupLabel(docTypes, doc.document_category)
              const isExpired = doc.expiry_date && new Date(doc.expiry_date) < new Date()

              return (
                <div 
                  key={doc.id}
                  className="bg-white border border-border rounded-2xl p-4 shadow-sm hover:border-brand-600/40 transition-colors flex items-center justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-brand-600" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-heading text-xs truncate flex items-center gap-1">
                        {doc.document_name}
                        {isExpired && (
                          <span className="flex items-center gap-0.5 text-[8px] bg-rose-50 text-rose-600 border border-rose-200 px-1.5 py-0.5 rounded-full font-black uppercase">
                            Expired
                          </span>
                        )}
                      </h3>
                      <div className="text-[10px] text-muted font-medium mt-0.5 flex flex-wrap items-center gap-x-2">
                        <span className="capitalize">{categoryLabel}</span>
                        {doc.expiry_date && (
                          <span>• Exp: {new Date(doc.expiry_date).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openStoredFile('vault', doc.id)}
                      className="p-2.5 text-brand-600 hover:bg-brand-50 rounded-lg transition-colors cursor-pointer"
                      title="View Credential"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      className="p-2.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Delete File"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── ONBOARDING CHECKLIST TAB ── */}
      {activeTab === 'onboarding' && center && (
        <div className="space-y-4">
          <div className="bg-brand-50 border border-brand-100 rounded-2xl p-4 shadow-sm flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-brand-600 shrink-0 mt-0.5" />
            <div className="text-xs">
              <h4 className="font-bold text-heading">{center.name}</h4>
              <p className="text-text-muted mt-1 leading-relaxed">
                Complete the center checklist to pick up open shifts. Link required credentials from your vault.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {checklistRows.map(({ req, record, result }) => {
              const style = COMPLIANCE_STATE_STYLE[result.state]
              const isAck = req.evidence_type === 'acknowledgement'
              const isDone = record?.status === 'accepted' && (result.state === 'current' || result.state === 'due_soon')
              const needsSignature = isAck && result.state !== 'not_applicable' && !(isDone && record?.acknowledged_version === req.policy_version)
              const canLink = !isAck && result.state !== 'not_applicable' && record?.status !== 'pending_review' && (!isDone || result.state === 'due_soon')

              return (
                <div key={req.id} className="border border-slate-200 bg-white rounded-2xl p-4 shadow-sm space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-bold text-heading text-xs leading-snug">{req.document_name}</h4>
                      <p className={`text-[10px] font-bold uppercase tracking-wider mt-0.5 ${result.state === 'overdue' ? 'text-rose-600' : 'text-slate-400'}`}>
                        {result.dueDate ? `Due ${formatDate(result.dueDate)}` : lookupLabel(docTypes, req.document_category)}
                      </p>
                      {record?.status === 'rejected' && record.review_notes && (
                        <p className="mt-1 text-[10px] text-rose-600">Center note: {record.review_notes}</p>
                      )}
                      {record?.not_applicable && (
                        <p className="mt-1 text-[10px] text-slate-500">Not applicable{record.not_applicable_reason ? `: ${record.not_applicable_reason}` : ''}</p>
                      )}
                      {req.template_file_key && (
                        <button onClick={() => handleDownloadTemplate(req)} className="mt-1 flex items-center gap-1 text-[10px] font-bold text-brand-600 hover:underline">
                          <Download className="w-3 h-3" /> {isAck ? 'Read the policy' : 'Download Form Template'}
                        </button>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${style.className}`}>{style.label}</span>
                  </div>

                  {needsSignature && (signingReq === req.id ? (
                    <div className="space-y-2">
                      <p className="text-[10px] text-slate-500">By signing you confirm you have received and read this{req.policy_version > 1 ? ` (version ${req.policy_version})` : ''}.</p>
                      <input value={signature} onChange={e => setSignature(e.target.value)} placeholder="Type your full name"
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-surface focus:outline-none focus:border-brand-600" />
                      <div className="flex gap-2">
                        <button onClick={() => setSigningReq(null)} className="flex-1 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 border border-slate-200 rounded-xl">Cancel</button>
                        <button disabled={!signature.trim()} onClick={() => handleSign(req)} className="flex-1 py-2 text-[10px] font-bold uppercase tracking-wider text-white bg-brand-600 rounded-xl disabled:opacity-50">Sign</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setSigningReq(req.id); setSignature('') }} className="w-full bg-brand-600 text-white font-bold text-[10px] uppercase tracking-wider px-3 py-2 rounded-xl">
                      {record?.acknowledged_at ? 'Sign updated policy' : 'Acknowledge'}
                    </button>
                  ))}

                  {canLink && (
                    <button onClick={() => setLinkingReq(req)} className="w-full bg-brand-900 hover:bg-black text-white font-bold text-[10px] uppercase tracking-wider px-3 py-2 rounded-xl">
                      {record?.matched_document_id ? 'Replace Document' : req.evidence_type === 'training' ? 'Link Certificate' : 'Link Document'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── LINK VAULT DOCUMENT MODAL ── */}
      {linkingReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-3xl border border-border max-w-sm w-full p-5 shadow-2xl relative text-left">
            <button 
              onClick={() => setLinkingReq(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <h3 className="text-base font-black text-heading mb-1 pr-6">Link Vault Document</h3>
            <p className="text-[11px] text-muted font-medium mb-4">
              Select a matching file to satisfy: <strong>{linkingReq.document_name}</strong>
            </p>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {documents
                .filter(d => d.document_category === linkingReq.document_category || d.document_category === 'other')
                .map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => handleLinkDoc(linkingReq.id, doc.id)}
                    className="w-full flex items-center justify-between p-3 border border-slate-100 hover:border-brand-600 rounded-xl bg-slate-50 text-left transition-colors cursor-pointer group"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-xs font-bold text-heading truncate">{doc.document_name}</div>
                      <div className="text-[9px] text-slate-400 capitalize mt-0.5">Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                ))}

              {documents.filter(d => d.document_category === linkingReq.document_category || d.document_category === 'other').length === 0 && (
                <div className="text-center py-6 text-xs text-muted font-medium border border-dashed border-slate-200 rounded-xl bg-slate-50">
                  No matching files found. Upload a file of this category to your vault first.
                </div>
              )}
            </div>

            <div className="mt-4 pt-2 border-t border-slate-100 flex gap-2">
              <button
                onClick={() => {
                  setLinkingReq(null)
                  setActiveTab('vault')
                  setShowUpload(true)
                }}
                className="flex-1 bg-brand-600 hover:bg-brand-800 text-white font-bold py-2.5 rounded-xl text-[10px] uppercase tracking-wider text-center cursor-pointer shadow-sm"
              >
                Upload New File
              </button>
              <button
                onClick={() => setLinkingReq(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-muted font-bold py-2.5 rounded-xl text-[10px] uppercase tracking-wider text-center cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
