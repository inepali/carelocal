'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { JobForm } from '../_components/JobForm'

export default function NewJobPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <Link href="/center/jobs" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#6b7a73] hover:text-[#157354]"><ArrowLeft className="h-4 w-4" /> Back to Jobs</Link>
      <h1 className="mb-1 text-3xl font-extrabold text-[#0b3828]">New job</h1>
      <p className="mb-8 text-[#6b7a73]">Save a draft any time; publishing makes it visible to staff.</p>
      <JobForm />
    </div>
  )
}
