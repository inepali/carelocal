'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { JobPosting, NeededAt } from '@/lib/jobs'
import { JobForm } from '../../_components/JobForm'

export default function EditJobPage() {
  const { id } = useParams<{ id: string }>()
  const [job, setJob] = useState<JobPosting | null>(null)
  const [items, setItems] = useState<{ requirement_id: string; needed_at: NeededAt }[] | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const [{ data: jobRow }, { data: reqs }] = await Promise.all([
        supabase.from('job_postings').select('*').eq('id', id).maybeSingle(),
        supabase.from('job_posting_requirements').select('requirement_id, needed_at').eq('job_id', id),
      ])
      if (!jobRow) { setMissing(true); return }
      setJob(jobRow as JobPosting)
      setItems((reqs ?? []) as { requirement_id: string; needed_at: NeededAt }[])
    })()
  }, [id])

  return (
    <div className="max-w-6xl mx-auto">
      <Link href={`/center/jobs/${id}`} className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> Back to the job</Link>
      <h1 className="mb-8 text-3xl font-extrabold text-heading">Edit job</h1>
      {missing ? <p className="text-muted">Job not found.</p>
        : job && items ? <JobForm job={job} jobItems={items} />
        : <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>}
    </div>
  )
}
