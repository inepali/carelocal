'use client'

import { LayoutGrid } from 'lucide-react'
import { canOpenRoster, useCenterContext } from '../context'
import { RosterBoard } from './_components/RosterBoard'

/** Owner and admin: where every child and teacher is right now, room by room, with live ratio checks. */
export default function RosterPage() {
  const ctx = useCenterContext()

  if (!canOpenRoster(ctx) || !ctx.centerId) {
    return (
      <div className="max-w-2xl rounded-2xl border border-border bg-white p-10 text-center shadow-sm">
        <LayoutGrid className="mx-auto mb-3 h-10 w-10 text-brand-200" />
        <h1 className="mb-2 text-xl font-bold text-heading">Live roster</h1>
        <p className="text-muted">
          {ctx.domainKey !== 'childcare' ? 'The live roster is available for child care centers.'
            : !ctx.childFilesEnabled ? 'The live roster needs Child Files, which is not turned on for your center yet. Contact CareLocal support to join the pilot.'
            : !ctx.rosterEnabled ? 'The live roster is not turned on for your center yet. Contact CareLocal support to join the pilot.'
            : 'Only the owner and administrators can open the live roster here.'}
        </p>
      </div>
    )
  }

  return <RosterBoard centerId={ctx.centerId} />
}
