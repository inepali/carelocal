import type { ComplianceState } from '@/lib/compliance'

/** Square colours shared by the staff and child compliance grids */
export const CELL: Record<ComplianceState, string> = {
  current: 'bg-emerald-500',
  due_soon: 'bg-amber-400',
  overdue: 'bg-red-500',
  pending_review: 'bg-sky-500',
  rejected: 'bg-white ring-2 ring-inset ring-red-500',
  missing: 'bg-slate-200',
  not_applicable: 'bg-white ring-1 ring-inset ring-slate-300',
}

export const ATTENTION: ComplianceState[] = ['overdue', 'due_soon', 'pending_review', 'rejected']
