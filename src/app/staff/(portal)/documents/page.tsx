'use client'

import { useEffect, useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffDocument, DocumentCategory, Center, CenterDocumentRequirement, StaffType, CenterStaffDocumentStatus } from '@/lib/types'
import { FileText, Plus, Trash2, ArrowRight, Upload, Info, CheckCircle2, Loader2, AlertCircle, ShieldCheck, ChevronRight, X, Calendar, ExternalLink, Globe, Sparkles, Download, Eye } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { deleteVaultDocument } from '@/app/actions/storage.actions'
import { openStoredFile, uploadStoredFile, DOCUMENT_ACCEPT } from '@/lib/files'
import { useLookups } from '@/hooks/use-lookups'
import { ACADEMIC_CATEGORY } from '@/components/staff/AcademicQualificationsTab'
import { showAlert, showConfirm } from '@/lib/dialog'

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
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [expiryDate, setExpiryDate] = useState('')

  const { data: lookupDocTypes } = useLookups('Document Type')

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

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile) {
      showAlert('Please select a file first')
      return
    }

    setUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('staff_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single()
      if (!profile) return

      const { fileKey, bucketName } = await uploadStoredFile('vault', selectedFile)

      const { error } = await supabase
        .from('staff_documents')
        .insert({
          staff_id: profile.id,
          document_name: docName || selectedFile.name,
          document_category: docCategory,
          expiry_date: expiryDate || null,
          file_url: 'r2_private_access', // files are only reachable through signed links
          file_key: fileKey,
          bucket_name: bucketName,
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
        showAlert('Failed to save document info')
      }
    } catch (err) {
      console.error('Upload error:', err)
      showAlert(err instanceof Error ? err.message : 'File upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function deleteDoc(id: string) {
    if (!await showConfirm('Are you sure you want to delete this document?')) return

    const res = await deleteVaultDocument(id)
    if (res.success) {
      setDocuments(documents.filter(d => d.id !== id))
    } else {
      showAlert(res.error)
    }
  }

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-40 bg-white rounded-2xl border border-[#e2e8e4]"></div>
    </div>
  }

  // Active types, plus any type (inactive or unknown) that still has documents so nothing disappears
  const documentTypes = [
    ...lookupDocTypes.filter(t => t.is_active || documents.some(d => d.document_category === t.value)),
    ...[...new Set(documents.map(d => d.document_category))]
      .filter(value => !lookupDocTypes.some(t => t.value === value))
      .map(value => ({ value, label: value })),
  ]
  // Academic qualifications are managed on My Profile
  const categoryTypes = documentTypes.filter(t => t.value !== ACADEMIC_CATEGORY)
  const visibleDocuments = documents.filter(d => d.document_category !== ACADEMIC_CATEGORY)
  const categoryLabel = (value: string) => categoryTypes.find(t => t.value === value)?.label ?? value
  const filteredDocuments = categoryFilter === 'all'
    ? visibleDocuments
    : visibleDocuments.filter(d => d.document_category === categoryFilter)

  return (
    <div className="max-w-5xl pb-32">
      <div className="mb-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-[#0b3828] mb-2 tracking-tight">My Documents</h1>
          <p className="text-[#6b7a73] text-lg font-medium">Upload and manage your credentials. These will be visible to centers you work with.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDocCategory(categoryFilter !== 'all' ? categoryFilter : '')
            setShowUpload(true)
          }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#157354] px-5 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-[#0f4a36] shrink-0"
        >
          <Plus className="h-5 w-5" /> Add Document
        </button>
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
                  accept={DOCUMENT_ACCEPT}
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
                      value={docCategory}
                      onChange={(e) => setDocCategory(e.target.value as DocumentCategory)}
                      aria-label="Document type"
                      className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354]"
                    >
                      <option value="" disabled>Select Type</option>
                      {categoryTypes.map(c => (
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


      {visibleDocuments.length === 0 ? (
        <div className="bg-[#edf7f3] border border-dashed border-[#a9dac9] rounded-2xl p-8 text-center">
          <FileText className="w-10 h-10 text-[#157354] mx-auto mb-3" />
          <h2 className="text-xl font-bold text-[#0b3828] mb-2">No documents yet</h2>
          <p className="text-[#3d5a4f] max-w-sm mx-auto">
            Use Add Document to upload your first credential.
          </p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[#e2e8e4] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#e2e8e4] bg-[#f8faf9] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf7f3] text-[#157354]">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-[#1a2e25]">All Documents</h2>
                <p className="text-xs text-[#6b7a73]">
                  {filteredDocuments.length} document{filteredDocuments.length === 1 ? '' : 's'}
                  {categoryFilter !== 'all' && ` in ${categoryLabel(categoryFilter)}`}
                </p>
              </div>
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
              className="rounded-xl border border-[#e2e8e4] bg-white px-4 py-2.5 text-sm font-medium text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354]"
            >
              <option value="all">All categories</option>
              {categoryTypes.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {filteredDocuments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-[#e2e8e4] text-[15px] font-bold text-[#1a2e25]">
                    <th scope="col" className="px-6 py-4">Document</th>
                    <th scope="col" className="px-6 py-4">Category</th>
                    <th scope="col" className="px-6 py-4">Uploaded</th>
                    <th scope="col" className="px-6 py-4">Expires</th>
                    <th scope="col" className="px-6 py-4">Status</th>
                    <th scope="col" className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e2e8e4] text-sm font-normal text-[#3d5a4f]">
                  {filteredDocuments.map((doc: StaffDocument) => {
                    const isExpired = !!doc.expiry_date && new Date(doc.expiry_date) < new Date()
                    return (
                      <tr key={doc.id} className="transition-colors hover:bg-[#fbfcfb]">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <FileText className="h-4 w-4 shrink-0 text-[#157354]" />
                            <span className="text-[#1a2e25]">{doc.document_name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setCategoryFilter(doc.document_category)}
                            className="inline-flex items-center rounded-full border border-[#e2e8e4] bg-[#f8faf9] px-2.5 py-1 text-xs font-medium text-[#3d5a4f] hover:border-[#157354]/40 hover:text-[#157354]"
                            title="Show only this category"
                          >
                            {categoryLabel(doc.document_category)}
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                        <td className={`px-6 py-4 whitespace-nowrap ${isExpired ? 'text-red-600' : ''}`}>
                          {doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-6 py-4">
                          {isExpired ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-600">
                              <AlertCircle className="h-3 w-3" /> Expired
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-[#edf7f3] px-2.5 py-1 text-xs text-[#157354]">Valid</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openStoredFile('vault', doc.id)}
                              className="rounded-lg p-2 text-[#157354] transition-colors hover:bg-[#edf7f3]"
                              title="View Document"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => deleteDoc(doc.id)}
                              className="rounded-lg p-2 text-[#a8b5ae] transition-colors hover:bg-red-50 hover:text-red-500"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-6 text-sm text-[#6b7a73]">No documents in this category yet.</div>
          )}
        </section>
      )}
    </div>
  )
}
