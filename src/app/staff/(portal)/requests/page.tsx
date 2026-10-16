'use client'

import { RequestInbox } from '@/components/staff/RequestInbox'

export default function StaffRequestsPage() {
  return (
    <div className="max-w-5xl pb-32">
      <div className="mb-10">
        <h1 className="text-4xl font-black text-[#0b3828] mb-2 tracking-tight">Document Requests</h1>
        <p className="text-[#6b7a73] text-lg font-medium">Documents your center has asked for. Send them from your library — only what you send is shared.</p>
      </div>
      <RequestInbox />
    </div>
  )
}
