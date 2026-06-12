'use client'

import { useEffect, useState, Suspense, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { getPresignedUploadUrl, getPresignedViewUrl } from '@/app/actions/storage.actions'
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

// Document Categories
const CATEGORIES = [
  { label: 'Identity (ID/Passport)', value: 'identity' },
  { label: 'Certification (CPR/First Aid)', value: 'certification' },
  { label: 'Background Check', value: 'background' },
  { label: 'Training', value: 'training' },
  { label: 'Medical/Health', value: 'medical' },
  { label: 'Documentation', value: 'documentation' },
  { label: 'Academic Qualification', value: 'academic_qualification' },
  { label: 'Other', value: 'other' },
]

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

interface Requirement {
  id: string
  document_name: string
  document_category: string
  template_file_key: string | null
  template_bucket_name: string | null
}

interface CenterStaffDocumentStatus {
  id: string
  requirement_id: string
  status: string
  matched_document_id: string | null
}

export default function MobileDocumentsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 text-[#157354] animate-spin" />
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
  const [documents, setDocuments] = useState<StaffDocument[]>([])
  
  // Center requirements state (if center query parameter is present)
  const [center, setCenter] = useState<Center | null>(null)
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [centerDocStatuses, setCenterDocStatuses] = useState<CenterStaffDocumentStatus[]>([])
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

        // Fetch center requirements
        const { data: reqs } = await supabase
          .from('center_document_requirements')
          .select('*')
          .eq('center_id', centerData.id)
          .order('sort_order', { ascending: true })
        setRequirements(reqs || [])

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

  const handleView = async (fileKey: string | null, bucketName: string | null, fallbackUrl?: string | null) => {
    if (!fileKey || !bucketName) {
      if (fallbackUrl) window.open(fallbackUrl, '_blank')
      else alert('No file details available')
      return
    }

    const res = await getPresignedViewUrl(fileKey, bucketName)
    if (res.success && res.url) {
      window.open(res.url, '_blank')
    } else {
      alert(res.error || 'Failed to view document')
    }
  }

  const handleDelete = async (id: string) => {
    if (!profile) return
    if (!confirm('Are you sure you want to delete this document from your vault?')) return

    const { error } = await supabase
      .from('staff_documents')
      .delete()
      .eq('id', id)

    if (error) {
      alert('Delete failed: ' + error.message)
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
      alert('Please complete all form fields')
      return
    }

    setUploading(true)

    try {
      // 1. Fetch Presigned Upload URL
      const presigned = await getPresignedUploadUrl(selectedFile.name, selectedFile.type)
      
      if (!presigned.success || !presigned.uploadUrl) {
        alert(presigned.error || 'Failed to authorize upload')
        setUploading(false)
        return
      }

      // 2. Put file to Cloudflare R2
      const uploadRes = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        body: selectedFile,
        headers: {
          'Content-Type': selectedFile.type,
        },
      })

      if (!uploadRes.ok) {
        throw new Error('Storage upload failed')
      }

      // 3. Save reference in staff_documents
      const { error } = await supabase
        .from('staff_documents')
        .insert({
          staff_id: profile.id,
          document_name: docName || selectedFile.name,
          document_category: docCategory,
          expiry_date: expiryDate || null,
          file_url: 'r2_private_access',
          file_key: presigned.fileKey,
          bucket_name: presigned.bucketName,
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
      alert('Upload failed: ' + (err instanceof Error ? err.message : 'Server error'))
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
      alert('Linking failed: ' + error.message)
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

  const handleDownloadTemplate = async (req: Requirement) => {
    if (!req.template_file_key || !req.template_bucket_name) return
    const res = await getPresignedViewUrl(req.template_file_key, req.template_bucket_name)
    if (res.success && res.url) {
      window.open(res.url, '_blank')
    } else {
      alert('Could not retrieve template file link')
    }
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
  const progressCount = requirements.filter(req => {
    const statusObj = centerDocStatuses.find(s => s.requirement_id === req.id)
    return statusObj?.status === 'accepted' || statusObj?.status === 'pending_review'
  }).length

  return (
    <div className="py-2">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0b3828] tracking-tight">Credentials</h1>
          <p className="text-xs text-[#6b7a73] font-medium mt-1">Manage licenses, training, and certifications.</p>
        </div>
        {!showUpload && activeTab === 'vault' && (
          <button
            onClick={() => setShowUpload(true)}
            className="bg-[#157354] hover:bg-[#0f4a36] text-white font-bold p-2.5 rounded-xl shadow-sm text-xs transition-colors flex items-center gap-1 cursor-pointer"
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
                ? 'bg-white text-[#0b3828] shadow-sm'
                : 'text-[#6b7a73] hover:text-[#0b3828]'
            }`}
          >
            Checklist ({progressCount}/{requirements.length})
          </button>
          <button
            onClick={() => setActiveTab('vault')}
            className={`flex-1 text-center py-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'vault'
                ? 'bg-white text-[#0b3828] shadow-sm'
                : 'text-[#6b7a73] hover:text-[#0b3828]'
            }`}
          >
            My Vault ({documents.length})
          </button>
        </div>
      )}

      {/* ── SHOW UPLOAD FORM ── */}
      {showUpload && activeTab === 'vault' && (
        <div className="bg-white border border-[#e2e8e4] rounded-2xl p-5 shadow-md mb-6 animate-in slide-in-from-top-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-black text-[#0b3828] uppercase tracking-wider">Upload New Credential</h2>
            <button 
              onClick={() => setShowUpload(false)}
              className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-[#0b3828] mb-1.5 uppercase tracking-wider">
                Select File (PDF or Image)
              </label>
              <label className={`
                relative flex flex-col items-center justify-center w-full h-28 
                border border-dashed rounded-xl cursor-pointer transition-all
                ${selectedFile ? 'border-[#157354] bg-[#f0fdf4]' : 'border-slate-300 hover:bg-[#f8faf9]'}
              `}>
                <input 
                  type="file" 
                  className="hidden" 
                  accept=".pdf,image/*"
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
                    <CheckCircle2 className="w-6 h-6 text-[#157354] mb-1" />
                    <span className="text-xs font-bold text-[#0b3828] max-w-[220px] truncate">{selectedFile.name}</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">Click to replace file</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center p-2 text-center">
                    <Upload className="w-6 h-6 text-[#a8b5ae] mb-1" />
                    <span className="text-xs font-semibold text-[#6b7a73]">Click to choose PDF or Image</span>
                  </div>
                )}
              </label>
            </div>

            <div>
              <label className="block text-[10px] font-black text-[#0b3828] mb-1 uppercase tracking-wider">Document Name</label>
              <input 
                type="text" 
                required
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="e.g. CPR & First Aid Certificate"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-[#f8faf9] focus:outline-none focus:border-[#157354]"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-[#0b3828] mb-1 uppercase tracking-wider">Category</label>
              <select
                required
                value={docCategory}
                onChange={(e) => setDocCategory(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-[#f8faf9] focus:outline-none focus:border-[#157354]"
              >
                <option value="" disabled>Select Category</option>
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-[#0b3828] mb-1 uppercase tracking-wider">Expiry Date (Optional)</label>
              <input 
                type="date" 
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-[#f8faf9] focus:outline-none focus:border-[#157354]"
              />
            </div>

            <button 
              type="submit"
              disabled={uploading || !selectedFile || !docCategory}
              className="w-full bg-[#157354] text-white font-bold py-3.5 rounded-xl hover:bg-[#0f4a36] text-xs uppercase tracking-wider shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
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
          {documents.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-[#e2e8e4] px-4">
              <FileText className="w-10 h-10 text-[#a8b5ae] mx-auto mb-3" />
              <h3 className="text-base font-bold text-[#0b3828] mb-1">No Documents Uploaded</h3>
              <p className="text-xs text-[#6b7a73] font-medium max-w-xs mx-auto mb-4">
                Upload credentials like CPR certificates, fingerprint clearances, or state teaching licenses to apply for shifts.
              </p>
              <button
                onClick={() => setShowUpload(true)}
                className="inline-flex items-center justify-center gap-1.5 bg-[#edf7f3] border border-[#d4ede4] text-[#157354] font-bold py-2.5 px-4 rounded-xl text-xs uppercase tracking-wider hover:bg-[#157354] hover:text-white transition-all cursor-pointer shadow-sm"
              >
                <Upload className="w-3.5 h-3.5" /> Upload First File
              </button>
            </div>
          ) : (
            documents.map((doc) => {
              const categoryObj = CATEGORIES.find(c => c.value === doc.document_category)
              const isExpired = doc.expiry_date && new Date(doc.expiry_date) < new Date()

              return (
                <div 
                  key={doc.id}
                  className="bg-white border border-[#e2e8e4] rounded-2xl p-4 shadow-sm hover:border-[#157354]/40 transition-colors flex items-center justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#edf7f3] flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-[#157354]" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-[#0b3828] text-xs truncate flex items-center gap-1">
                        {doc.document_name}
                        {isExpired && (
                          <span className="flex items-center gap-0.5 text-[8px] bg-rose-50 text-rose-600 border border-rose-200 px-1.5 py-0.5 rounded-full font-black uppercase">
                            Expired
                          </span>
                        )}
                      </h3>
                      <div className="text-[10px] text-[#6b7a73] font-medium mt-0.5 flex flex-wrap items-center gap-x-2">
                        <span className="capitalize">{categoryObj?.label || doc.document_category}</span>
                        {doc.expiry_date && (
                          <span>• Exp: {new Date(doc.expiry_date).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleView(doc.file_key, doc.bucket_name, doc.file_url)}
                      className="p-2.5 text-[#157354] hover:bg-[#edf7f3] rounded-lg transition-colors cursor-pointer"
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
          <div className="bg-[#edf7f3] border border-[#d4ede4] rounded-2xl p-4 shadow-sm flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[#157354] shrink-0 mt-0.5" />
            <div className="text-xs">
              <h4 className="font-bold text-[#0b3828]">{center.name}</h4>
              <p className="text-[#3d5a4f] mt-1 leading-relaxed">
                Complete the center checklist to pick up open shifts. Link required credentials from your vault.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {requirements.map((req) => {
              const assignment = centerDocStatuses.find(s => s.requirement_id === req.id)
              const isMet = assignment?.status === 'accepted'
              const isPending = assignment?.status === 'pending_review'
              const isRejected = assignment?.status === 'rejected'

              return (
                <div 
                  key={req.id}
                  className={`border rounded-2xl p-4 shadow-sm flex items-center justify-between gap-4 transition-all ${
                    isMet 
                      ? 'bg-emerald-50/50 border-emerald-200' 
                      : isPending 
                        ? 'bg-amber-50/50 border-amber-200' 
                        : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isMet 
                        ? 'bg-emerald-100 text-emerald-800' 
                        : isPending 
                          ? 'bg-amber-100 text-amber-800' 
                          : 'bg-slate-100 text-slate-400'
                    }`}>
                      {isMet ? (
                        <ShieldCheck className="w-5 h-5" />
                      ) : (
                        <FileText className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-[#0b3828] text-xs leading-snug">{req.document_name}</h4>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                        Category: {CATEGORIES.find(c => c.value === req.document_category)?.label || req.document_category}
                      </p>
                      
                      {isRejected && (
                        <span className="inline-block mt-1 text-[9px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">
                          Rejected by Director
                        </span>
                      )}

                      {req.template_file_key && (
                        <button
                          onClick={() => handleDownloadTemplate(req)}
                          className="mt-1 flex items-center gap-1 text-[10px] font-bold text-[#157354] hover:underline"
                        >
                          <Download className="w-3 h-3" /> Download Form Template
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {isMet ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase tracking-wider px-2 py-1 border border-emerald-200">
                        Approved
                      </span>
                    ) : isPending ? (
                      <span className="text-[9px] font-bold text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2.5 py-1 uppercase tracking-wider">
                        Reviewing
                      </span>
                    ) : (
                      <button
                        onClick={() => setLinkingReq(req)}
                        className="bg-[#0b3828] hover:bg-black text-white font-bold text-[10px] uppercase tracking-wider px-3 py-2 rounded-xl transition-all cursor-pointer shadow-sm"
                      >
                        Link Doc
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── LINK VAULT DOCUMENT MODAL ── */}
      {linkingReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-3xl border border-[#e6ece9] max-w-sm w-full p-5 shadow-2xl relative text-left">
            <button 
              onClick={() => setLinkingReq(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <h3 className="text-base font-black text-[#0b3828] mb-1 pr-6">Link Vault Document</h3>
            <p className="text-[11px] text-[#6b7a73] font-medium mb-4">
              Select a matching file to satisfy: <strong>{linkingReq.document_name}</strong>
            </p>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {documents
                .filter(d => d.document_category === linkingReq.document_category || d.document_category === 'other')
                .map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => handleLinkDoc(linkingReq.id, doc.id)}
                    className="w-full flex items-center justify-between p-3 border border-slate-100 hover:border-[#157354] rounded-xl bg-slate-50 text-left transition-colors cursor-pointer group"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-xs font-bold text-[#0b3828] truncate">{doc.document_name}</div>
                      <div className="text-[9px] text-slate-400 capitalize mt-0.5">Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                ))}

              {documents.filter(d => d.document_category === linkingReq.document_category || d.document_category === 'other').length === 0 && (
                <div className="text-center py-6 text-xs text-[#6b7a73] font-medium border border-dashed border-slate-200 rounded-xl bg-slate-50">
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
                className="flex-1 bg-[#157354] hover:bg-[#0f4a36] text-white font-bold py-2.5 rounded-xl text-[10px] uppercase tracking-wider text-center cursor-pointer shadow-sm"
              >
                Upload New File
              </button>
              <button
                onClick={() => setLinkingReq(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-[#6b7a73] font-bold py-2.5 rounded-xl text-[10px] uppercase tracking-wider text-center cursor-pointer"
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
