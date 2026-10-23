'use client'

import type { ChildAuditEntry } from '@/lib/child-types'

/**
 * The child's audit trail: who changed pick-up, custody, status or files, and when. Entries are written by the
 * database and cannot be edited. They name people and flags, never health details.
 */
export function ActivityPanel({ audit, userId }: { audit: ChildAuditEntry[]; userId: string | null }) {
  const who = (entry: ChildAuditEntry) => entry.changed_by === null ? 'System' : entry.changed_by === userId ? 'You' : 'Another administrator'
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="border-b border-border bg-surface px-6 py-4">
        <h2 className="text-lg font-bold text-text-main">Activity</h2>
        <p className="text-xs text-muted">A permanent record of changes to this child&apos;s file. It cannot be edited.</p>
      </div>
      {audit.length === 0 ? <div className="px-6 py-8 text-sm text-muted">No activity yet.</div> : (
        <ol className="divide-y divide-border text-sm">
          {audit.map(entry => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-6 py-3">
              <span className="w-44 shrink-0 text-xs text-subtle">{new Date(entry.changed_at).toLocaleString()}</span>
              <span className="min-w-0 flex-1 text-text-main">{entry.summary ?? `${entry.action} ${entry.table_name}`}</span>
              <span className="text-xs text-muted">{who(entry)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
