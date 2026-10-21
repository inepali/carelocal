'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getDomainKey } from '@/lib/domain-config'
import { notifyUsers, sendEmail, escapeHtml } from '@/lib/server/notify'
import {
  TOUR_TIME_SLOTS, TOUR_TOPICS, formatSlot, formatTourDate, isWeekday,
  type ContactTime, type CenterTourRequest, type TourStatus, type TourType,
} from '@/lib/tours'

/**
 * Tour requests from the public center page. Visitors are not signed in, so submitTourRequest validates
 * everything on the server, refuses floods, and writes with the service role. Center admins manage requests
 * with updateTourRequest (RLS limits them to their own center).
 */
type Result<T = object> = ({ success: true } & T) | { success: false; error: string }
const fail = (error: string): { success: false; error: string } => ({ success: false, error })
const service = () => createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export interface TourRequestInput {
  firstName: string
  lastName: string
  email: string
  phone: string
  contactTime: ContactTime | ''
  tourType: TourType
  date: string          // YYYY-MM-DD, or '' when only availability is given
  time: string          // 'HH:MM' from TOUR_TIME_SLOTS
  alternateTimes: string
  children: { name: string; dob: string }[]
  startDate: string
  firstGroupCare: boolean | null
  topics: string[]
  message: string
  website: string       // honeypot: real visitors never fill it
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_PER_EMAIL_PER_HOUR = 3
const MAX_PER_CENTER_PER_DAY = 100

const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const validDate = (value: string) => ISO_DATE.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())

export async function submitTourRequest(handle: string, input: TourRequestInput): Promise<Result> {
  // Spam trap: pretend it worked
  if (input.website?.trim()) return { success: true }

  const firstName = input.firstName?.trim() ?? ''
  const lastName = input.lastName?.trim() ?? ''
  const email = input.email?.trim().toLowerCase() ?? ''
  const phone = input.phone?.trim() ?? ''
  const alternateTimes = input.alternateTimes?.trim() ?? ''
  const message = input.message?.trim() ?? ''

  if (!firstName || firstName.length > 60 || !lastName || lastName.length > 60) return fail('Enter your first and last name.')
  if (!EMAIL.test(email) || email.length > 254) return fail('Enter a valid email address.')
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15 || phone.length > 30) return fail('Enter a valid phone number.')
  if (alternateTimes.length > 500) return fail('Your availability note is too long (500 characters at most).')
  if (message.length > 1000) return fail('Your message is too long (1,000 characters at most).')

  const tourType: TourType = input.tourType === 'virtual' ? 'virtual' : 'in_person'
  const contactTime = ['morning', 'afternoon', 'evening'].includes(input.contactTime) ? input.contactTime : null

  // A tour time, or a note about when you are free
  let preferredDate: string | null = null
  let preferredTime: string | null = null
  if (input.date) {
    if (!validDate(input.date) || !isWeekday(input.date)) return fail('Tours are Monday to Friday. Choose a weekday.')
    if (input.date < dayOffset(-1) || input.date > dayOffset(180)) return fail('Choose a date within the next few months.')
    if (!TOUR_TIME_SLOTS.includes(input.time)) return fail('Choose a time for your tour.')
    preferredDate = input.date
    preferredTime = input.time
  } else if (!alternateTimes) {
    return fail('Choose a date and time, or tell us when you are free.')
  }

  const children = (input.children ?? []).slice(0, 6).flatMap(c => {
    const name = c.name?.trim() ?? ''
    if (!name) return []
    const dob = c.dob && validDate(c.dob) && c.dob > '1900-01-01' && c.dob < dayOffset(550) ? c.dob : null
    return [{ name: name.slice(0, 80), dob }]
  })
  const startDate = input.startDate && validDate(input.startDate) ? input.startDate : null
  const allowedTopics = new Set(TOUR_TOPICS.map(t => t.key))
  const topics = [...new Set((input.topics ?? []).filter(t => allowedTopics.has(t)))]

  const domain = getDomainKey((await headers()).get('host') || '')
  const db = service()
  const { data: center } = await db.from('centers')
    .select('id, name, domain_key, address, city, state, public_tours_enabled')
    .eq('public_handle', (handle ?? '').toLowerCase()).eq('public_enabled', true).eq('is_active', true).eq('domain_key', domain)
    .maybeSingle()
  if (!center || center.public_tours_enabled === false) return fail('This center is not taking tour requests right now.')

  // Flood limits: per email per hour, and per center per day
  const [{ count: recentByEmail }, { count: recentAtCenter }] = await Promise.all([
    db.from('center_tour_requests').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', new Date(Date.now() - 3_600_000).toISOString()),
    db.from('center_tour_requests').select('id', { count: 'exact', head: true }).eq('center_id', center.id).gte('created_at', new Date(Date.now() - 86_400_000).toISOString()),
  ])
  if ((recentByEmail ?? 0) >= MAX_PER_EMAIL_PER_HOUR) return fail('You have sent several requests already. The center will be in touch soon.')
  if ((recentAtCenter ?? 0) >= MAX_PER_CENTER_PER_DAY) return fail('This center has received many requests today. Please try again tomorrow.')

  const { data: row, error } = await db.from('center_tour_requests').insert({
    center_id: center.id, first_name: firstName, last_name: lastName, email, phone,
    contact_time: contactTime, tour_type: tourType,
    preferred_date: preferredDate, preferred_time: preferredTime, alternate_times: alternateTimes || null,
    children, start_date: startDate, first_group_care: input.firstGroupCare ?? null, topics,
    message: message || null,
  }).select('id').single()
  if (error || !row) {
    console.error('[tours] insert failed:', error)
    return fail('We could not send your request. Please try again.')
  }

  // Follow-ups (each can fail without losing the request)
  const when = preferredDate ? `${formatTourDate(preferredDate, false)} at ${formatSlot(preferredTime)}` : null
  try {
    const { data: admins } = await db.from('center_admins').select('user_id').eq('center_id', center.id)
    await notifyUsers((admins ?? []).map(a => a.user_id as string), {
      title: `New tour request: ${firstName} ${lastName}`,
      message: `${firstName} ${lastName} asked for ${tourType === 'virtual' ? 'a virtual' : 'an in-person'} tour${when ? ` on ${when}` : ' and shared when they are free'}. Confirm it from Tours.`,
      type: 'tour_request', referenceId: row.id, url: '/center/tours', emailCta: 'View tour request',
    }, center.domain_key)
  } catch (err) {
    console.error('[tours] admin notification failed:', err)
  }
  await sendEmail({
    to: email,
    domainKey: center.domain_key,
    subject: `Your tour request at ${center.name}`,
    html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Thanks, ${escapeHtml(firstName)}. We got your tour request.</h2>
      <p>${escapeHtml(center.name)} will contact you to confirm your tour.</p>
      <p><strong>${tourType === 'virtual' ? 'Virtual' : 'In-person'} tour</strong><br>${when ? `Requested time: ${escapeHtml(when)}` : 'You shared when you are free, and the center will suggest a time.'}</p>
    </div>`,
  })
  return { success: true }
}

// ─── Center admin ────────────────────────────────────────────────────────────

export async function updateTourRequest(id: string, input: {
  status: TourStatus
  confirmedDate?: string | null
  confirmedTime?: string | null
  note?: string
}): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return fail('Please sign in again.')

  // RLS: only the signed-in admin's own center
  const { data: before } = await supabase.from('center_tour_requests').select('*').eq('id', id).maybeSingle()
  if (!before) return fail('Tour request not found.')
  const request = before as CenterTourRequest

  const note = input.note?.trim() ?? ''
  if (note.length > 1000) return fail('The note is too long (1,000 characters at most).')
  if (!['new', 'confirmed', 'completed', 'cancelled'].includes(input.status)) return fail('Unknown status.')

  let confirmedDate = request.confirmed_date
  let confirmedTime = request.confirmed_time
  if (input.status === 'confirmed') {
    confirmedDate = input.confirmedDate || request.preferred_date
    confirmedTime = input.confirmedTime || request.preferred_time
    if (!confirmedDate || !validDate(confirmedDate)) return fail('Choose the date of the tour to confirm it.')
    if (!confirmedTime || !/^[0-2][0-9]:[0-5][0-9]$/.test(confirmedTime)) return fail('Choose the time of the tour to confirm it.')
  }

  const { error } = await supabase.from('center_tour_requests').update({
    status: input.status, confirmed_date: confirmedDate, confirmed_time: confirmedTime, center_note: note || null,
  }).eq('id', id)
  if (error) return fail(error.message)

  // Tell the family when the tour is confirmed, or cancelled after it was confirmed
  const confirmedNow = input.status === 'confirmed'
  const cancelledAfterConfirm = input.status === 'cancelled' && request.status === 'confirmed'
  if (confirmedNow || cancelledAfterConfirm) {
    const { data: center } = await service().from('centers').select('name, domain_key, address, city, state, zip').eq('id', request.center_id).maybeSingle()
    if (center) {
      const when = `${formatTourDate(confirmedDate)} at ${formatSlot(confirmedTime)}`
      const place = [center.address, [center.city, center.state].filter(Boolean).join(', '), center.zip].filter(Boolean).join(', ')
      await sendEmail({
        to: request.email,
        domainKey: center.domain_key,
        subject: confirmedNow ? `Your tour at ${center.name} is confirmed` : `Your tour at ${center.name} was cancelled`,
        html: confirmedNow
          ? `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Your tour is confirmed</h2>
              <p>Hi ${escapeHtml(request.first_name)}, ${escapeHtml(center.name)} looks forward to meeting you.</p>
              <p><strong>${escapeHtml(when)}</strong><br>${request.tour_type === 'virtual' ? 'Virtual tour. The center will send you the link.' : escapeHtml(place)}</p>
              ${note ? `<p>${escapeHtml(note)}</p>` : ''}
            </div>`
          : `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Your tour was cancelled</h2>
              <p>Hi ${escapeHtml(request.first_name)}, ${escapeHtml(center.name)} had to cancel your tour on ${escapeHtml(when)}.${note ? ` ${escapeHtml(note)}` : ''} They will contact you to find another time.</p>
            </div>`,
      })
    }
  }
  revalidatePath('/center/tours')
  return { success: true }
}
