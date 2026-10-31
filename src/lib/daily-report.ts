// Self-contained on purpose (relative, type-only imports) so the tests can load it with plain node.
import { AMOUNTS, BATHROOM_RESULTS, BATHROOM_TYPES, BOTTLE_CONTENTS, DIAPER_RESULTS, MEALS, type DailyDetails, type DailyKind } from './daily'

/**
 * The parent daily report: what daily_report_data() returns, turned into an email (subject, HTML and plain text).
 * Only what parents should see is in the data already (no removed entries, no staff names, no care alert,
 * approved photos only); this file decides how it reads. Times are shown in the center's time zone.
 */

export interface ReportEntry {
  kind: DailyKind
  at: string
  ends_at: string | null
  details: DailyDetails
  /** Naps: how many sleep checks were recorded */
  checks: number | null
}

export interface ReportData {
  child: { id: string; first_name: string }
  center: { id: string; name: string; email: string | null; phone: string | null; timezone: string; domain_key: string | null }
  day: string
  arrived_at: string | null
  left_at: string | null
  entries: ReportEntry[]
  recipients: string[]
}

const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const label = (list: { value: string; label: string }[], v: string | undefined) => list.find(x => x.value === v)?.label ?? ''

export function reportTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso))
}

export function reportDate(day: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))
}

function minutes(from: string, to: string) {
  const m = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000))
  const h = Math.floor(m / 60)
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`
}

/** One line per entry, grouped the way parents read a day */
export function reportSections(data: ReportData): { title: string; lines: string[] }[] {
  const tz = data.center.timezone
  const t = (iso: string) => reportTime(iso, tz)
  const of = (k: DailyKind) => data.entries.filter(e => e.kind === k)
  const withNote = (line: string, d: DailyDetails) => (d.note ? `${line} (${d.note})` : line)
  const sections: { title: string; lines: string[] }[] = []
  const add = (title: string, lines: string[]) => { if (lines.length) sections.push({ title, lines }) }
  // Entries are already in time order; keep that order when two kinds share a group
  const inOrder = (kinds: DailyKind[], line: (e: ReportEntry) => string) => data.entries.filter(e => kinds.includes(e.kind)).map(line)

  add('Naps', of('nap').map(n => n.ends_at
    ? `${t(n.at)} – ${t(n.ends_at)} · ${minutes(n.at, n.ends_at)}${n.checks ? ` · checked ${n.checks} ${n.checks === 1 ? 'time' : 'times'}` : ''}`
    : `Fell asleep ${t(n.at)}`))
  add('Meals and bottles', inOrder(['meal', 'bottle'], e => e.kind === 'meal'
    ? withNote(`${t(e.at)} · ${label(MEALS, e.details.meal) || 'Meal'}: ${e.details.amount === 'other' ? (e.details.other ?? 'other') : label(AMOUNTS, e.details.amount).toLowerCase()}`, e.details)
    : withNote(`${t(e.at)} · Bottle: ${e.details.oz} oz ${e.details.contents === 'other' ? (e.details.other ?? '') : label(BOTTLE_CONTENTS, e.details.contents).toLowerCase()}`.trim(), e.details)))
  add('Diapers and bathroom', inOrder(['diaper', 'bathroom'], e => e.kind === 'diaper'
    ? withNote(`${t(e.at)} · Diaper: ${label(DIAPER_RESULTS, e.details.result)}${e.details.cream ? ', cream' : ''}`, e.details)
    : withNote(`${t(e.at)} · Bathroom: ${label(BATHROOM_RESULTS, e.details.result)}${e.details.type ? ` (${label(BATHROOM_TYPES, e.details.type).toLowerCase()})` : ''}`, e.details)))
  add('Medicine', of('medicine').map(e => withNote(`${t(e.at)} · ${[e.details.name, e.details.dose].filter(Boolean).join(', ')}`, e.details)))
  add('Activities', of('activity').map(e => `${t(e.at)} · ${e.details.text ?? ''}`))
  add('Notes from the classroom', of('note').map(e => e.details.text ?? ''))
  return sections
}

/** The email: subject, HTML (inline styles for mail apps) and plain text. photoUrls maps photo_key to a link. */
export function buildDailyReport(data: ReportData, photoUrls: Record<string, string>) {
  const tz = data.center.timezone
  const name = data.child.first_name
  const subject = `${name}'s day at ${data.center.name} · ${reportDate(data.day)}`
  const times = [data.arrived_at ? `Arrived ${reportTime(data.arrived_at, tz)}` : '', data.left_at ? `Picked up ${reportTime(data.left_at, tz)}` : ''].filter(Boolean).join(' · ')
  const sections = reportSections(data)
  const photos = data.entries.filter(e => e.kind === 'photo' && e.details.photo_key && photoUrls[e.details.photo_key])
  const replyLine = data.center.email ? 'Reply to this email to reach the center.' : data.center.phone ? `Questions? Call the center at ${data.center.phone}.` : ''

  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16202a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="padding:24px 24px 8px">
<p style="margin:0;font-size:13px;color:#5b6773">${esc(data.center.name)} · ${esc(reportDate(data.day))}</p>
<h1 style="margin:6px 0 4px;font-size:24px;line-height:1.25">${esc(name)}&#39;s day</h1>
${times ? `<p style="margin:0;font-size:15px;color:#33404d">${esc(times)}</p>` : ''}
</td></tr>
${sections.map(s => `<tr><td style="padding:14px 24px 0">
<h2 style="margin:0 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#5b6773">${esc(s.title)}</h2>
${s.lines.map(l => `<p style="margin:0 0 4px;font-size:15px;line-height:1.45">${esc(l)}</p>`).join('')}
</td></tr>`).join('\n')}
${photos.length ? `<tr><td style="padding:14px 24px 0">
<h2 style="margin:0 0 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#5b6773">Photos</h2>
${photos.map(p => `<a href="${esc(photoUrls[p.details.photo_key!])}" style="display:inline-block;margin:0 6px 8px 0;text-decoration:none"><img src="${esc(photoUrls[p.details.photo_key!])}" width="160" alt="${esc(p.details.caption ?? `Photo of ${name}`)}" style="display:block;width:160px;max-width:100%;border-radius:10px;border:0"></a>`).join('')}
<p style="margin:2px 0 0;font-size:12px;color:#5b6773">Photo links work for 7 days. Save any you want to keep.</p>
</td></tr>` : ''}
${sections.length === 0 && photos.length === 0 ? `<tr><td style="padding:14px 24px 0"><p style="margin:0;font-size:15px">No activities were recorded today.</p></td></tr>` : ''}
<tr><td style="padding:20px 24px 24px"><p style="margin:0;font-size:12px;color:#5b6773">From ${esc(name)}&#39;s teachers at ${esc(data.center.name)}, sent with CareLocal. ${esc(replyLine)}</p></td></tr>
</table></td></tr></table></body></html>`

  const text = [
    `${name}'s day at ${data.center.name}`,
    reportDate(data.day),
    times,
    ...sections.flatMap(s => ['', s.title.toUpperCase(), ...s.lines]),
    ...(photos.length ? ['', 'PHOTOS (links work for 7 days)', ...photos.map(p => `${p.details.caption ? `${p.details.caption}: ` : ''}${photoUrls[p.details.photo_key!]}`)] : []),
    '',
    `From ${name}'s teachers at ${data.center.name}, sent with CareLocal. ${replyLine}`.trim(),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')

  return { subject, html, text }
}

/** "Kiddie Academy of Huntersville via CareLocal", safe for an email From name */
export function reportSenderName(centerName: string) {
  const clean = centerName.replace(/["<>\\\r\n]/g, '').trim().slice(0, 60)
  return `${clean || 'Your child care center'} via CareLocal`
}
