'use client'

import { useState } from 'react'
import { Megaphone } from 'lucide-react'
import { useCenterContext } from '../context'
import { AnnouncementList } from './_components/AnnouncementList'
import { ComposeAnnouncement } from './_components/ComposeAnnouncement'
import { AnnouncementDetailView } from './_components/AnnouncementDetail'

type View = { kind: 'list' } | { kind: 'compose' } | { kind: 'detail'; id: string }

/** Center owners and administrators: email one note to all parents, chosen classes' parents, or staff */
export default function CenterAnnouncementsPage() {
  const { centerId, domainKey, role, announcementsEnabled } = useCenterContext()
  const [view, setView] = useState<View>({ kind: 'list' })
  const canSend = role === 'owner' || role === 'admin'

  return (
    <div className="max-w-5xl pb-24">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-heading mb-2 flex items-center gap-3">
          <Megaphone className="w-8 h-8 text-brand-600" /> Announcements
        </h1>
        <p className="text-muted">
          {domainKey === 'childcare'
            ? 'Write one note and email it to every family, the families in chosen classes, or your staff.'
            : 'Write one note and email it to your staff.'}
        </p>
      </div>

      {!announcementsEnabled ? (
        <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">
          Announcements aren&apos;t turned on for this center. Contact CareLocal support to try it.
        </div>
      ) : !canSend ? (
        <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center text-muted shadow-sm">
          Only the center owner and administrators can send announcements.
        </div>
      ) : centerId && (
        view.kind === 'compose'
          ? <ComposeAnnouncement centerId={centerId} childcare={domainKey === 'childcare'}
              onCancel={() => setView({ kind: 'list' })} onSent={id => setView({ kind: 'detail', id })} />
          : view.kind === 'detail'
            ? <AnnouncementDetailView centerId={centerId} id={view.id} onBack={() => setView({ kind: 'list' })} />
            : <AnnouncementList centerId={centerId} onNew={() => setView({ kind: 'compose' })} onOpen={id => setView({ kind: 'detail', id })} />
      )}
    </div>
  )
}
