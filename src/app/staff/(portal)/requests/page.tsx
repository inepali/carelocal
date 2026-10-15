'use client'

import { RequestInbox } from '@/components/staff/RequestInbox'

export default function StaffRequestsPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#0b3828] mb-1.5 tracking-tight">Document Requests</h1>
        <p className="text-[#6b7a73]">Documents your center has asked for. Send them from your library — only what you send is shared.</p>
      </div>
      <RequestInbox />
    </div>
  )
}
