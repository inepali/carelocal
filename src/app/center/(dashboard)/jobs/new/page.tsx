'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { JobForm } from '../_components/JobForm'

export default function NewJobPage() {
  return (
    <div className="max-w-6xl">
      <Link href="/center/jobs" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> Back to Jobs</Link>
      <h1 className="mb-1 text-3xl font-extrabold text-heading">New job</h1>
      <p className="mb-8 text-muted">Save a draft any time; publishing makes it visible to staff.</p>
      <JobForm />
    </div>
  )
}
