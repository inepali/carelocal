'use client'

import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffDocument, DOCUMENT_CATEGORY_LABELS, DocumentCategory, Center, CenterDocumentRequirement, StaffType, CenterStaffDocumentStatus } from '@/lib/types'
import { FileText, Plus, Trash2, ArrowRight, Upload, Info, CheckCircle2, Loader2, AlertCircle, ShieldCheck, ChevronRight, X, Calendar, ExternalLink, Globe, Sparkles, Download, Eye } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { getPresignedUploadUrl, getPresignedViewUrl } from '@/app/actions/storage.actions'
import { useLookups } from '@/hooks/use-lookups'

// Mock categories if types aren't fully exporting them yet
const CATEGORIES: { label: string; value: DocumentCategory }[] = [
  { label: 'Identity (ID/Passport)', value: 'identity' },
  { label: 'Certification (CPR/First Aid)', value: 'certification' },
  { label: 'Background Check', value: 'background' },
  { label: 'Training', value: 'training' },
  { label: 'Medical/Health', value: 'medical' },
  { label: 'Documentation', value: 'documentation' },
  { label: 'Academic Qualification', value: 'academic_qualification' },
  { label: 'Other', value: 'other' },
]

export default function StaffDocumentsPage() {
  return (
    <Suspense fallback={<div className="p-10 text-[#6b7a73] font-medium">Loading documents portal...</div>}>
      <DocumentsContent />
    </Suspense>
  )
}

function DocumentsContent() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const [documents, setDocuments] = useState<StaffDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [myStaffType, setMyStaffType] = useState<StaffType | null>(null)
  const [centerDocStatuses, setCenterDocStatuses] = useState<CenterStaffDocumentStatus[]>([])
  
  // Form State
  const [showUpload, setShowUpload] = useState(false)
  const [docName, setDocName] = useState('')
  const [docCategory, setDocCategory] = useState<DocumentCategory | ''>('')
  const [expiryDate, setExpiryDate] = useState('')

  const { data: lookupDocTypesRaw } = useLookups('Document Type')
  const lookupDocTypes = lookupDocTypesRaw.filter(l => l.is_active !== false)

  useEffect(() => {
    loadDocuments()
  }, [])

  async function loadDocuments() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // 1. Fetch Profile
    const { data: profile } = await supabase
      .from('staff_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (profile) {
      setMyStaffType(profile.staff_type)
      
      // 2. Fetch Vault Documents
      const { data: docs } = await supabase
        .from('staff_documents')
        .select('*')
        .eq('staff_id', profile.id)
        .order('uploaded_at', { ascending: false })
      
      const userDocs = docs || []
      setDocuments(userDocs)

    }
    setLoading(false)
  }

  async function handleView(fileKey?: string, bucketName?: string, fallbackUrl?: string) {
    if (!fileKey || !bucketName) {
      if (fallbackUrl) window.open(fallbackUrl, '_blank')
      else alert('No file access info available')
      return
    }

    const res = await getPresignedViewUrl(fileKey, bucketName)
    if (res.success && res.url) {
      window.open(res.url, '_blank')
    } else {
      alert(res.error || 'Failed to generate access link')
    }
  }


  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile) {
      alert('Please select a file first')
      return
    }

    setUploading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setUploading(false)
      return
    }

    const { data: profile } = await supabase
      .from('staff_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      setUploading(false)
      return
    }

    // 1. Get Presigned URL
    const presigned = await getPresignedUploadUrl(selectedFile.name, selectedFile.type)
    
    if (!presigned.success || !presigned.uploadUrl) {
      alert(presigned.error || 'Failed to get upload authorization')
      setUploading(false)
      return
    }

    // 2. Upload to Cloudflare R2
    try {
      const uploadRes = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        body: selectedFile,
        headers: {
          'Content-Type': selectedFile.type,
        },
      })

      if (!uploadRes.ok) {
        throw new Error('Failed to upload to storage')
      }

      // 3. Save to Supabase
      const { error } = await supabase
        .from('staff_documents')
        .insert({
          staff_id: profile.id,
          document_name: docName || selectedFile.name,
          document_category: docCategory,
          expiry_date: expiryDate || null,
          file_url: 'r2_private_access', // No longer using direct public URLs
          file_key: presigned.fileKey,
          bucket_name: presigned.bucketName,
          file_name: selectedFile.name
        })

      if (!error) {
        setDocName('')
        setDocCategory('')
        setExpiryDate('')
        setSelectedFile(null)
        setShowUpload(false)
        loadDocuments()
      } else {
        console.error('Database save error:', error)
        alert('Failed to save document info')
      }
    } catch (err) {
      console.error('Upload error:', err)
      alert('File upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function deleteDoc(id: string) {
    if (!confirm('Are you sure you want to delete this document?')) return
    
    const { error } = await supabase
      .from('staff_documents')
      .delete()
      .eq('id', id)
    
    if (!error) {
      setDocuments(documents.filter(d => d.id !== id))
    }
  }

  async function handleDownloadTemplate(req: CenterDocumentRequirement) {
    if (!req.template_file_key || !req.template_bucket_name) return
    
    const res = await getPresignedViewUrl(req.template_file_key, req.template_bucket_name)
    if (res.success && res.url) {
      window.open(res.url, '_blank')
    } else {
      alert('Could not open template file')
    }
  }

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-40 bg-white rounded-2xl border border-[#e2e8e4]"></div>
    </div>
  }

  const documentTypes = lookupDocTypes.length > 0 ? lookupDocTypes : CATEGORIES
  const documentGroups = documentTypes.map((documentType) => ({
    ...documentType,
    documents: documents.filter((document) => document.document_category === documentType.value),
  }))

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">My Documents</h1>
          <p className="text-[#6b7a73]">Upload and manage your credentials. These will be visible to centers you work with.</p>
        </div>
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b3828]/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="add-document-title">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#e2e8e4] bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="add-document-title" className="text-lg font-bold text-[#1a2e25]">Add Document</h2>
              <button type="button" onClick={() => setShowUpload(false)} className="rounded-lg p-1.5 text-[#6b7a73] hover:bg-[#f8faf9]" aria-label="Close upload form" title="Close upload form">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleUpload} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-bold text-[#0b3828] mb-2 uppercase tracking-widest text-[10px]">Select File (PDF or Image)</label>
              <label className={`
                relative flex flex-col items-center justify-center w-full h-32 
                border-2 border-dashed rounded-2xl cursor-pointer transition-all
                ${selectedFile ? 'border-[#157354] bg-[#f0fdf4]' : 'border-[#e2e8e4] hover:bg-[#f8faf9]'}
              `}>
                <input 
                  type="file" 
                  className="hidden" 
                  accept=".pdf,image/*"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
                {selectedFile ? (
                  <div className="flex flex-col items-center">
                    <CheckCircle2 className="w-8 h-8 text-[#157354] mb-2" />
                    <span className="text-xs font-bold text-[#0b3828] max-w-[200px] truncate">{selectedFile.name}</span>
                    <button 
                      type="button"
                      onClick={(e) => { e.preventDefault(); setSelectedFile(null); }}
                      className="mt-2 text-[10px] text-red-500 font-black uppercase tracking-tighter"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <Upload className="w-8 h-8 text-[#a8b5ae] mb-2" />
                    <span className="text-xs font-medium text-[#6b7a73]">Click or drag file to upload</span>
                  </div>
                )}
              </label>
            </div>

            <div>
              <label className="block text-sm font-bold text-[#0b3828] mb-2 uppercase tracking-widest text-[10px]">Document Label</label>
              <input 
                type="text" 
                required
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder={selectedFile ? selectedFile.name.split('.')[0] : "e.g. My CPR Certification"}
                className="w-full px-5 py-4 rounded-2xl border-2 border-[#f0f4f2] bg-white focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all font-medium text-[#0b3828]"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-[#0b3828] mb-2 uppercase tracking-widest text-[10px]">Category</label>
                    <select
                      required
                      disabled
                      value={docCategory}
                      aria-label="Selected document type"
                      className="w-full px-4 py-3 rounded-xl border border-[#c9d9d1] bg-[#f8faf9] text-[#1a2e25] focus:outline-none disabled:cursor-not-allowed disabled:opacity-100"
                    >
                      <option value="" disabled>Select Type</option>
                      {(lookupDocTypes.length > 0 ? lookupDocTypes : CATEGORIES).map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Expiry Date (Optional)</label>
              <input 
                type="date" 
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
              />
            </div>
            <div className="sm:col-span-2 pt-2">
              <button 
                type="submit"
                disabled={uploading || !docName || !docCategory}
                className="w-full flex items-center justify-center gap-2 bg-[#157354] text-white font-semibold py-3 rounded-xl hover:bg-[#0f4a36] disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Document'}
              </button>
            </div>
            </form>
          </div>
        </div>
      )}


      <div className="space-y-5">
        {documents.length === 0 && (
          <div className="bg-[#edf7f3] border border-dashed border-[#a9dac9] rounded-2xl p-8 text-center">
            <FileText className="w-10 h-10 text-[#157354] mx-auto mb-3" />
            <h2 className="text-xl font-bold text-[#0b3828] mb-2">No documents yet</h2>
            <p className="text-[#3d5a4f] max-w-sm mx-auto">
              Choose a document type below to upload your first credential.
            </p>
          </div>
        )}
        {documentGroups.map((group) => (
          <section key={group.value} className="overflow-hidden rounded-2xl border border-[#e2e8e4] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[#e2e8e4] bg-[#f8faf9] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf7f3] text-[#157354]">
                  <FileText className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-bold text-[#1a2e25]">{group.label}</h2>
                  <p className="text-xs text-[#6b7a73]">{group.documents.length} document{group.documents.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDocCategory(group.value)
                  setShowUpload(true)
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#157354] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#0f4a36]"
              >
                <Plus className="h-4 w-4" /> Add New
              </button>
            </div>
            {group.documents.length > 0 ? (
              <div className="divide-y divide-[#e2e8e4]">
                {group.documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-[#fbfcfb] group">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#edf7f3] flex items-center justify-center shrink-0">
                  <FileText className="w-6 h-6 text-[#157354]" />
                </div>
                <div>
                  <h3 className="font-bold text-[#1a2e25] flex items-center gap-2">
                    {doc.document_name}
                    {doc.expiry_date && new Date(doc.expiry_date) < new Date() && (
                      <span className="flex items-center gap-1 text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">
                        <AlertCircle className="w-3 h-3" /> Expired
                      </span>
                    )}
                  </h3>
                  <div className="text-sm text-[#6b7a73] flex items-center gap-3">
                    <span className="capitalize">{doc.document_category}</span>
                    {doc.expiry_date && (
                      <span className="flex items-center gap-1">
                        • Expires {new Date(doc.expiry_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => handleView(doc.file_key, doc.bucket_name, doc.file_url)}
                  className="p-3 text-[#157354] hover:bg-[#edf7f3] rounded-xl transition-colors group/btn"
                  title="View Document"
                >
                  <Eye className="w-5 h-5 group-hover/btn:scale-110 transition-transform" />
                </button>
                <button 
                  onClick={() => deleteDoc(doc.id)}
                  className="p-3 text-[#a8b5ae] hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors group/btn"
                  title="Delete"
                >
                  <Trash2 className="w-5 h-5 group-hover/btn:scale-110 transition-transform" />
                </button>
              </div>
            </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-6 text-sm text-[#6b7a73]">No documents added in this category yet.</div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
