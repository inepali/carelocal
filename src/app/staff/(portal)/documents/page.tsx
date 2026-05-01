'use client'

import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffDocument, DOCUMENT_CATEGORY_LABELS, DocumentCategory, Center, CenterDocumentRequirement, StaffType, CenterStaffDocumentStatus } from '@/lib/types'
import { FileText, Plus, Trash2, ArrowRight, Upload, Info, CheckCircle2, Loader2, AlertCircle, ShieldCheck, ChevronRight, X, Calendar, ExternalLink, Globe, Sparkles, Download, Eye } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { getPresignedUploadUrl, getPresignedViewUrl } from '@/app/actions/storage.actions'

// Mock categories if types aren't fully exporting them yet
const CATEGORIES: { label: string; value: DocumentCategory }[] = [
  { label: 'Identity (ID/Passport)', value: 'identity' },
  { label: 'Certification (CPR/First Aid)', value: 'certification' },
  { label: 'Background Check', value: 'background' },
  { label: 'Training', value: 'training' },
  { label: 'Medical/Health', value: 'medical' },
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
  const [docCategory, setDocCategory] = useState<DocumentCategory>('other')
  const [expiryDate, setExpiryDate] = useState('')

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

  return (
    <div className="max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">My Documents</h1>
          <p className="text-[#6b7a73]">Upload and manage your credentials. These will be visible to centers you work with.</p>
        </div>
        <button 
          onClick={() => setShowUpload(!showUpload)}
          className="inline-flex items-center justify-center gap-2 bg-[#157354] text-white font-semibold px-6 py-3 rounded-xl hover:bg-[#0f4a36] shadow-sm transition-colors"
        >
          <Upload className="w-5 h-5" /> {showUpload ? 'Cancel' : 'Upload New'}
        </button>
      </div>


      {showUpload && (
        <div className="bg-white border border-[#e2e8e4] rounded-2xl p-6 shadow-sm mb-8 animate-in fade-in slide-in-from-top-4">
          <h2 className="text-lg font-bold text-[#1a2e25] mb-4">Add Document</h2>
          <form onSubmit={handleUpload} className="grid sm:grid-cols-2 gap-4">
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
                value={docCategory}
                onChange={(e) => setDocCategory(e.target.value as DocumentCategory)}
                className="w-full px-5 py-4 rounded-2xl border-2 border-[#f0f4f2] bg-white focus:outline-none focus:ring-4 focus:ring-[#157354]/10 focus:border-[#157354] transition-all font-medium text-[#0b3828]"
              >
                {CATEGORIES.map(cat => <option key={cat.value} value={cat.value}>{cat.label}</option>)}
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
                disabled={uploading || !docName}
                className="w-full flex items-center justify-center gap-2 bg-[#157354] text-white font-semibold py-3 rounded-xl hover:bg-[#0f4a36] disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Document'}
              </button>
            </div>
          </form>
        </div>
      )}


      {documents.length === 0 ? (
        <div className="bg-[#edf7f3] border border-dashed border-[#a9dac9] rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
            <FileText className="w-8 h-8 text-[#157354]" />
          </div>
          <h2 className="text-xl font-bold text-[#0b3828] mb-2">No documents yet</h2>
          <p className="text-[#3d5a4f] max-w-sm mx-auto mb-6">
            Upload your certifications, background checks, and IDs so centers can verify you for shifts.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {documents.map((doc) => (
            <div key={doc.id} className="bg-white border border-[#e2e8e4] rounded-2xl p-6 shadow-sm hover:border-[#74c3a8] transition-colors flex items-center justify-between group">
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
      )}
    </div>
  )
}
