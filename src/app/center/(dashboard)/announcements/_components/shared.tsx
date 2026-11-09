import { STATUS_LABEL, type AnnouncementStatus } from '@/lib/announcements'

export const STATUS_STYLE: Record<AnnouncementStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  scheduled: 'bg-slate-100 text-slate-700',
  sending: 'bg-[#fff0d1] text-[#7a4b00]',
  sent: 'bg-[#e2f2ea] text-[#17603f]',
  partial: 'bg-[#fff0d1] text-[#7a4b00]',
  failed: 'bg-[#fce4e2] text-[#a3221b]',
  canceled: 'bg-slate-100 text-slate-700',
}

export function StatusPill({ status }: { status: AnnouncementStatus }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
}

/** "3:40 PM" today, "Nov 5, 3:40 PM" before */
export function when(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return new Date().toDateString() === d.toDateString() ? `Today, ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

export const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm text-text-main'
