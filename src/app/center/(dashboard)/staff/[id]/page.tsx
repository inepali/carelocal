'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StaffProfile, CenterDocumentRequirement, StaffDocument, CenterStaffDocumentStatus, DocReviewStatus, STAFF_TYPE_LABELS, StaffType } from '@/lib/types'
import { ArrowLeft, CheckCircle2, XCircle, Clock, FileText, ExternalLink, MessageSquare, AlertCircle, Loader2, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

export default function StaffReviewPage() {
  const { id: staffId } = useParams()
  const router = useRouter()
  const supabase = createClient()
  
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<StaffProfile | null>(null)
  const [requirements, setRequirements] = useState<CenterDocumentRequirement[]>([])
  const [uploads, setUploads] = useState<StaffDocument[]>([])
  const [statuses, setStatuses] = useState<CenterStaffDocumentStatus[]>([])
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')

  useEffect(() => {
    loadData()
  }, [staffId])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user.id)
      .single()

    if (!admin) return

    // 1. Fetch Staff Profile
    const { data: staffProfile } = await supabase
      .from('staff_profiles')
      .select('*')
      .eq('id', staffId)
      .single()
    
    setProfile(staffProfile)

    if (staffProfile) {
      // 2. Fetch Center Requirements
      const { data: reqs } = await supabase
        .from('center_document_requirements')
        .select('*')
        .eq('center_id', admin.center_id)
        .order('sort_order', { ascending: true })
      
      setRequirements(reqs || [])

      // 3. Fetch Staff Uploads
      const { data: staffDocs } = await supabase
        .from('staff_documents')
        .select('*')
        .eq('staff_id', staffId)
      
      setUploads(staffDocs || [])

      // 4. Fetch/Init Review Statuses
      const { data: reviewStatuses } = await supabase
        .from('center_staff_document_status')
        .select('*')
        .eq('center_id', admin.center_id)
        .eq('staff_id', staffId)
      
      setStatuses(reviewStatuses || [])
    }
    
    setLoading(false)
  }

  async function handleReview(requirementId: string, matchedDocId: string | null, status: DocReviewStatus) {
    setReviewingId(requirementId)
    
    const { data: { user } } = await supabase.auth.getUser()
    const { data: admin } = await supabase
      .from('center_admins')
      .select('center_id')
      .eq('user_id', user!.id)
      .single()

    const payload = {
      center_id: admin!.center_id,
      staff_id: staffId,
      requirement_id: requirementId,
      matched_document_id: matchedDocId,
      status: status,
      center_reviewed: true,
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes
    }

    // Upsert the status
    const existing = statuses.find(s => s.requirement_id === requirementId)
    
    const { error } = existing 
      ? await supabase.from('center_staff_document_status').update(payload).eq('id', existing.id)
      : await supabase.from('center_staff_document_status').insert(payload)

    if (!error) {
      setReviewNotes('')
      setReviewingId(null)
      loadData()
    } else {
      console.error(error)
      alert("Failed to save review.")
      setReviewingId(null)
    }
  }

  if (loading) return <div className="p-8">Loading staff profile...</div>
  if (!profile) return <div className="p-8">Staff member not found.</div>

  return (
    <div className="max-w-5xl mx-auto pb-20">
      <div className="mb-8 flex items-center justify-between">
        <Link 
          href="/center/dashboard/staff" 
          className="inline-flex items-center gap-2 text-sm text-[#6b7a73] hover:text-[#157354] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Staff Pool
        </Link>
      </div>

      <div className="bg-white border border-[#e2e8e4] rounded-3xl overflow-hidden shadow-sm mb-8">
        <div className="p-8 bg-[#f8faf9] border-b border-[#e2e8e4] flex items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-[#157354] text-white flex items-center justify-center text-3xl font-bold">
            {profile.first_name[0]}{profile.last_name[0]}
          </div>
          <div className="flex-1">
            <h1 className="text-3xl font-extrabold text-[#0b3828] mb-1">
              {profile.first_name} {profile.last_name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm font-medium">
              <span className="bg-[#edf7f3] text-[#157354] px-2.5 py-1 rounded-md uppercase tracking-wide">
                {STAFF_TYPE_LABELS[profile.staff_type as StaffType] || profile.staff_type}
              </span>
              <span className="text-[#a8b5ae]">•</span>
              <span className="text-[#6b7a73]">{profile.email}</span>
              {profile.phone && (
                <>
                  <span className="text-[#a8b5ae]">•</span>
                  <span className="text-[#6b7a73]">{profile.phone}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="p-8">
          <h2 className="text-xl font-bold text-[#1a2e25] mb-6 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-[#157354]" /> Compliance Review
          </h2>

          <div className="grid gap-6">
            {requirements.map((req) => {
              const status = statuses.find(s => s.requirement_id === req.id)
              const matchedDoc = uploads.find(u => u.id === status?.matched_document_id)
              
              // Find any potential matches by name if not linked yet
              const potentialMatches = uploads.filter(u => 
                u.document_name.toLowerCase().includes(req.document_name.toLowerCase()) ||
                req.document_name.toLowerCase().includes(u.document_name.toLowerCase())
              )

              return (
                <div key={req.id} className="border border-[#e2e8e4] rounded-2xl overflow-hidden">
                  <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#f8faf9] border-b border-[#e2e8e4]">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-[#1a2e25]">{req.document_name}</span>
                        {req.is_required && (
                          <span className="text-[10px] bg-[#157354] text-white px-2 py-0.5 rounded-full uppercase tracking-tighter">Required</span>
                        )}
                      </div>
                      <p className="text-xs text-[#6b7a73]">{req.notes || "No specific instructions provided."}</p>
                    </div>

                    <div className="flex items-center gap-3">
                      {status?.status === 'accepted' ? (
                        <div className="flex items-center gap-1.5 text-[#16a34a] bg-[#f0fdf4] px-3 py-1.5 rounded-full text-sm font-bold border border-[#bbf7d0]">
                          <CheckCircle2 className="w-4 h-4" /> Accepted
                        </div>
                      ) : status?.status === 'rejected' ? (
                        <div className="flex items-center gap-1.5 text-red-600 bg-red-50 px-3 py-1.5 rounded-full text-sm font-bold border border-red-100">
                          <XCircle className="w-4 h-4" /> Rejected
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full text-sm font-bold border border-amber-100">
                          <Clock className="w-4 h-4" /> Pending
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-5 bg-white">
                    {/* ── Document Matching Section ── */}
                    {matchedDoc ? (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-xl bg-[#edf7f3] flex items-center justify-center shrink-0">
                            <FileText className="w-6 h-6 text-[#157354]" />
                          </div>
                          <div>
                            <div className="font-bold text-[#1a2e25]">{matchedDoc.document_name}</div>
                            <div className="text-xs text-[#6b7a73] flex items-center gap-2 mt-0.5">
                              <span>Uploaded {new Date(matchedDoc.uploaded_at).toLocaleDateString()}</span>
                              {matchedDoc.expiry_date && (
                                <>
                                  <span>•</span>
                                  <span className={new Date(matchedDoc.expiry_date) < new Date() ? 'text-red-500 font-bold' : ''}>
                                    Expires {new Date(matchedDoc.expiry_date).toLocaleDateString()}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <a 
                            href={matchedDoc.file_url} 
                            target="_blank" 
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#edf7f3] text-[#157354] font-bold text-sm hover:bg-[#d4ede4] transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" /> View PDF
                          </a>
                          <button 
                            onClick={() => {
                              // Unlink doc for re-selection
                              handleReview(req.id, null, 'missing')
                            }}
                            className="text-xs text-[#a8b5ae] hover:text-red-500 underline"
                          >
                            Change Match
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 text-[#6b7a73] text-sm">
                          <AlertCircle className="w-4 h-4" /> No document linked to this requirement yet.
                        </div>
                        
                        {potentialMatches.length > 0 && (
                          <div className="bg-[#f8faf9] p-4 rounded-xl border border-dashed border-[#e2e8e4]">
                            <p className="text-xs font-bold text-[#0b3828] uppercase tracking-widest mb-3">Potential Matches found:</p>
                            <div className="space-y-3">
                              {potentialMatches.map(pm => (
                                <div key={pm.id} className="flex items-center justify-between bg-white p-3 rounded-lg border border-[#e2e8e4]">
                                  <div className="text-sm font-medium">{pm.document_name}</div>
                                  <button 
                                    onClick={() => handleReview(req.id, pm.id, 'pending_review')}
                                    className="text-xs bg-[#157354] text-white px-3 py-1 rounded-md font-bold"
                                  >
                                    Link This Doc
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="text-xs text-[#a8b5ae]">
                          Staff can upload this document to their profile, or you can link it if they've already uploaded it under a different name.
                        </div>
                      </div>
                    )}

                    {/* ── Review Actions ── */}
                    {(matchedDoc || status?.status === 'rejected') && (
                      <div className="mt-6 pt-6 border-t border-[#e2e8e4]">
                        <div className="flex flex-col gap-4">
                          <div className="flex-1">
                            <label className="block text-xs font-bold text-[#0b3828] uppercase tracking-widest mb-2 flex items-center gap-1.5">
                              <MessageSquare className="w-3.5 h-3.5" /> Internal Review Notes
                            </label>
                            <textarea 
                              value={reviewNotes || status?.review_notes || ''}
                              onChange={(e) => setReviewNotes(e.target.value)}
                              placeholder="e.g. Looks good, valid state license."
                              className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#157354]/30"
                              rows={2}
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <button 
                              onClick={() => handleReview(req.id, matchedDoc?.id || null, 'accepted')}
                              disabled={reviewingId === req.id || !matchedDoc}
                              className="flex-1 flex items-center justify-center gap-2 bg-[#157354] text-white font-bold py-3 rounded-xl hover:bg-[#0f4a36] disabled:opacity-50 transition-all shadow-sm"
                            >
                              {reviewingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Accept Document'}
                            </button>
                            <button 
                              onClick={() => handleReview(req.id, matchedDoc?.id || null, 'rejected')}
                              disabled={reviewingId === req.id || !matchedDoc}
                              className="flex-1 flex items-center justify-center gap-2 bg-white text-red-600 border border-red-200 font-bold py-3 rounded-xl hover:bg-red-50 disabled:opacity-50 transition-all shadow-sm"
                            >
                              {reviewingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Reject / Flag'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
