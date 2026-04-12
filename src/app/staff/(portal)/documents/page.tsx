'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffDocument, DOCUMENT_CATEGORY_LABELS, DocumentCategory } from '@/lib/types'
import { FileText, Upload, Trash2, ExternalLink, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react'

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
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [documents, setDocuments] = useState<StaffDocument[]>([])
  
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

    const { data: profile } = await supabase
      .from('staff_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (profile) {
      const { data } = await supabase
        .from('staff_documents')
        .select('*')
        .eq('staff_id', profile.id)
        .order('uploaded_at', { ascending: false })
      
      setDocuments(data || [])
    }
    setLoading(false)
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    setUploading(true)

    const { data: { user } } = await supabase.auth.getUser()
    const { data: profile } = await supabase
      .from('staff_profiles')
      .select('id')
      .eq('user_id', user.id!)
      .single()

    // Mocking the R2 upload for now - in reality, we'd get a signed URL
    const mockFileUrl = `https://storage.carelocal.io/mock-uuid-for-${docName.replace(/\s+/g, '-').toLowerCase()}.pdf`

    const { error } = await supabase
      .from('staff_documents')
      .insert({
        staff_id: profile.id,
        document_name: docName,
        document_category: docCategory,
        expiry_date: expiryDate || null,
        file_url: mockFileUrl,
        file_name: docName + '.pdf'
      })

    if (!error) {
      setDocName('')
      setExpiryDate('')
      setShowUpload(false)
      loadDocuments()
    }
    setUploading(false)
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
              <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Document Name</label>
              <input 
                type="text" 
                required
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="e.g. CPR Certification Card"
                className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1a2e25] mb-1.5">Category</label>
              <select 
                value={docCategory}
                onChange={(e) => setDocCategory(e.target.value as DocumentCategory)}
                className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
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
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <a 
                  href={doc.file_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="p-2 text-[#6b7a73] hover:text-[#157354] hover:bg-[#edf7f3] rounded-lg transition-colors"
                  title="View Document"
                >
                  <ExternalLink className="w-5 h-5" />
                </a>
                <button 
                  onClick={() => deleteDoc(doc.id)}
                  className="p-2 text-[#6b7a73] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete Document"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
