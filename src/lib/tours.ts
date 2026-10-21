/** Shared by the public "Schedule a Tour" modal, the server action and the center's Tours page. */

export type TourStatus = 'new' | 'confirmed' | 'completed' | 'cancelled'
export type TourType = 'in_person' | 'virtual'
export type ContactTime = 'morning' | 'afternoon' | 'evening'

export interface TourChild { name: string; dob: string | null }

export interface CenterTourRequest {
  id: string
  center_id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  contact_time: ContactTime | null
  tour_type: TourType
  preferred_date: string | null
  preferred_time: string | null
  alternate_times: string | null
  children: TourChild[]
  start_date: string | null
  first_group_care: boolean | null
  topics: string[]
  message: string | null
  status: TourStatus
  confirmed_date: string | null
  confirmed_time: string | null
  center_note: string | null
  created_at: string
}

export const TOUR_TOPICS: { key: string; label: string }[] = [
  { key: 'schedule', label: 'How your schedule fits my family' },
  { key: 'safety', label: 'How health and safety are handled' },
  { key: 'day', label: 'What a typical day looks like' },
  { key: 'staff', label: 'How the staff care for and interact with each person' },
  { key: 'community', label: 'How we become part of the community' },
  { key: 'budget', label: 'Pricing and budget' },
  { key: 'other', label: 'Other' },
]
export const topicLabel = (key: string) => TOUR_TOPICS.find(t => t.key === key)?.label ?? key

export const CONTACT_TIMES: { key: ContactTime; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
]

export const TOUR_TYPES: { key: TourType; label: string }[] = [
  { key: 'in_person', label: 'In person' },
  { key: 'virtual', label: 'Virtual' },
]

export const TOUR_STATUS_LABELS: Record<TourStatus, string> = { new: 'New', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' }
export const TOUR_STATUS_STYLE: Record<TourStatus, string> = {
  new: 'bg-amber-50 text-amber-700 border-amber-200',
  confirmed: 'bg-brand-50 text-brand-600 border-brand-100',
  completed: 'bg-surface text-muted border-border',
  cancelled: 'bg-red-50 text-red-600 border-red-100',
}

/** Tour times offered in the form: 9:00 AM to 4:30 PM every 30 minutes ("09:00" … "16:30") */
export const TOUR_TIME_SLOTS: string[] = Array.from({ length: 16 }, (_, i) => {
  const minutes = 9 * 60 + i * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

/** "13:30" -> "1:30 PM" */
export function formatSlot(time: string | null | undefined) {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return time
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** "2026-11-04" -> "Wed, Nov 4, 2026" */
export function formatTourDate(date: string | null | undefined, withYear = true) {
  if (!date) return ''
  const d = new Date(`${date}T12:00:00`)
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
}

/** The next `count` weekdays (Mon–Fri) starting tomorrow, as local YYYY-MM-DD */
export function upcomingWeekdays(count = 30, from: Date = new Date()): string[] {
  const out: string[] = []
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  while (out.length < count) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
  }
  return out
}

/** Weekday (Mon–Fri) check for a YYYY-MM-DD string, independent of time zone */
export function isWeekday(date: string) {
  const d = new Date(`${date}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.getUTCDay() >= 1 && d.getUTCDay() <= 5
}
