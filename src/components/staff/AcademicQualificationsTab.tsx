'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { StaffDocument } from '@/lib/types'
import { GraduationCap, Plus, Trash2, Eye, Upload, CheckCircle2, Loader2, AlertCircle, X } from 'lucide-react'
import { deleteVaultDocument } from '@/app/actions/storage.actions'
import { openStoredFile, uploadStoredFile, DOCUMENT_ACCEPT } from '@/lib/files'

export const ACADEMIC_CATEGORY = 'academic_qualification'

const FIELD = 'w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-sm text-[#1a2e25] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354]'

/** Degrees, diplomas and transcripts: the staff member's "Academic Qualification" vault documents. */
export function AcademicQualificationsTab({ staffId }: { staffId: string }) {
  const supabase = createClient()
  const [docs, setDocs] = useState<StaffDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('staff_documents').select('*')
      .eq('staff_id', staffId).eq('document_category', ACADEMIC_CATEGORY)
      .order('uploaded_at', { ascending: false })
    setDocs(data || [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId])

  useEffect(() => { load() }, [load])

  function closeForm() {
    setShowForm(false); setFile(null); setName(''); setExpiry('')
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { alert('Please select a file first'); return }
    setSaving(true)
    try {
      const { fileKey, bucketName } = await uploadStoredFile('vault', file)
      const { error } = await supabase.from('staff_documents').insert({
        staff_id: staffId,
        document_name: name.trim() || file.name,
        document_category: ACADEMIC_CATEGORY,
        expiry_date: expiry || null,
        file_url: 'r2_private_access', // files are only reachable through signed links
        file_key: fileKey,
        bucket_name: bucketName,
        file_name: file.name,
      })
      if (error) { alert('Failed to save document info'); return }
      closeForm()
      load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'File upload failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this document?')) return
    const res = await deleteVaultDocument(id)
    if (res.success) setDocs(prev => prev.filter(d => d.id !== id))
    else alert(res.error)
  }

  if (loading) return <div className="h-40 animate-pulse rounded-2xl border border-[#e2e8e4] bg-white" />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-[#1a2e25]"><GraduationCap className="h-5 w-5 text-[#157354]" /> Academic Qualifications</h2>
          <p className="text-xs text-[#6b7a73]">Degrees, diplomas and transcripts. Visible to centers you work with.</p>
        </div>
        <button type="button" onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#157354] px-4 py-2 text-xs font-bold text-white hover:bg-[#0f4a36]">
          <Plus className="h-4 w-4" /> Add New
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b3828]/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="academic-title">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#e2e8e4] bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 id="academic-title" className="text-lg font-bold text-[#1a2e25]">Add Academic Qualification</h3>
              <button type="button" onClick={closeForm} className="rounded-lg p-1.5 text-[#6b7a73] hover:bg-[#f8faf9]" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <label className={`flex h-28 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all ${file ? 'border-[#157354] bg-[#f0fdf4]' : 'border-[#e2e8e4] hover:bg-[#f8faf9]'}`}>
                <input type="file" className="hidden" accept={DOCUMENT_ACCEPT} onChange={e => setFile(e.target.files?.[0] || null)} />
                {file ? (
                  <><CheckCircle2 className="mb-1 h-7 w-7 text-[#157354]" /><span className="max-w-[240px] truncate text-xs font-bold text-[#0b3828]">{file.name}</span></>
                ) : (
                  <><Upload className="mb-1 h-7 w-7 text-[#a8b5ae]" /><span className="text-xs text-[#6b7a73]">Click to choose a PDF or image</span></>
                )}
              </label>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#1a2e25]">Label</label>
                <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. B.A. Early Childhood Education" className={FIELD} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#1a2e25]">Expiry Date (Optional)</label>
                <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className={FIELD} />
              </div>
              <button type="submit" disabled={saving || !file || !name.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#157354] py-3 font-semibold text-white hover:bg-[#0f4a36] disabled:opacity-50">
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Save Document'}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[#e2e8e4] bg-white shadow-sm">
        {docs.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-[#6b7a73]">No academic qualifications added yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-b border-[#e2e8e4] text-[15px] font-bold text-[#1a2e25]">
                  <th scope="col" className="px-6 py-4">Document</th>
                  <th scope="col" className="px-6 py-4">Uploaded</th>
                  <th scope="col" className="px-6 py-4">Expires</th>
                  <th scope="col" className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2e8e4] text-sm text-[#3d5a4f]">
                {docs.map(doc => {
                  const expired = !!doc.expiry_date && new Date(doc.expiry_date) < new Date()
                  return (
                    <tr key={doc.id} className="hover:bg-[#fbfcfb]">
                      <td className="px-6 py-4 text-[#1a2e25]">{doc.document_name}</td>
                      <td className="whitespace-nowrap px-6 py-4">{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                      <td className={`whitespace-nowrap px-6 py-4 ${expired ? 'text-red-600' : ''}`}>
                        {doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString() : '—'}
                        {expired && <AlertCircle className="ml-1 inline h-3.5 w-3.5" aria-label="Expired" />}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openStoredFile('vault', doc.id)} className="rounded-lg p-2 text-[#157354] hover:bg-[#edf7f3]" title="View Document"><Eye className="h-4 w-4" /></button>
                          <button onClick={() => handleDelete(doc.id)} className="rounded-lg p-2 text-[#a8b5ae] hover:bg-red-50 hover:text-red-500" title="Delete"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
