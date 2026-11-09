import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Camera, ChevronLeft, ChevronRight, Clock, ImageOff, MessageSquarePlus, Phone } from 'lucide-react'
import { reportDate, reportSections, reportTime } from '@/lib/daily-report'
import {
  loadPortalDay, loadPortalHome, loadPortalPhotos, loadPortalThread, loadPortalThreads, parentTokenHash, rememberedCenterKey, signPortalPhotos, type PortalHome,
} from '@/lib/server/parent-portal'
import { NoCenterLink } from './_components/SignInForm'
import { SignOutButton } from './_components/SignOutButton'
import { Conversation, NewMessageForm } from './_components/Messages'
import { MenuView } from './_components/MenuView'

/**
 * /parent: a parent's view of their child's day, opened with a 6-digit PIN on the center’s link (no account). Server rendered;
 * every read goes through the parent_portal_* database functions with this device's session.
 *   ?child=<id>  which child (siblings share one code)   ?tab=today|photos|messages   ?day=YYYY-MM-DD
 *   ?before=<iso> (photos)   ?thread=<id> | ?compose=1 (messages)   ?tab=menu&week=YYYY-MM-DD (the center's menu, Sunday–Saturday)
 */

type Search = { child?: string; tab?: string; day?: string; before?: string; thread?: string; compose?: string; week?: string }
type Tab = 'today' | 'photos' | 'messages' | 'menu'
const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Activities' }, { id: 'photos', label: 'Photos' }, { id: 'messages', label: 'Messages' }, { id: 'menu', label: 'Menu' },
]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** "3:40 PM" today, "Nov 5" before (in the center's time zone) */
function shortWhen(iso: string, timeZone: string) {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  return day(new Date(iso)) === day(new Date())
    ? reportTime(iso, timeZone)
    : new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(new Date(iso))
}

function href(params: Record<string, string | null | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `/parent?${s}` : '/parent'
}

export default async function ParentPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const tokenHash = await parentTokenHash()
  const home = tokenHash ? await loadPortalHome(tokenHash) : null
  if (!tokenHash || !home) {
    // Signed out: back to the center link this phone used before, or ask for it
    const key = await rememberedCenterKey()
    if (key) redirect(`/parent/${key}${tokenHash ? '?expired=1' : ''}`)
    return <NoCenterLink />
  }

  const child = home.children.find(c => sp.child && UUID.test(sp.child) && c.id === sp.child) ?? home.children[0]
  const menuOn = home.center.menu === true
  const tabs = TABS.filter(t => t.id !== 'menu' || menuOn)
  const tab: Tab = tabs.find(t => t.id === sp.tab)?.id ?? 'today'
  const [faces, threads] = await Promise.all([
    signPortalPhotos(home.center.id, home.children.map(c => c.photo_key)),
    loadPortalThreads(tokenHash, child.id),
  ])
  const unread = (threads ?? []).reduce((n, t) => n + t.unread, 0)

  return (
    <>
      <header className="flex items-center justify-between gap-3 py-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted">{home.center.name}</p>
          <p className="truncate text-sm text-text-muted">{home.parent.name ? `Hi, ${home.parent.name.split(' ')[0]}` : 'Welcome'}</p>
        </div>
        <SignOutButton />
      </header>

      {home.children.length > 1 && (
        <nav aria-label="Children" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {home.children.map(c => {
            const on = c.id === child.id
            return (
              <Link key={c.id} href={href({ child: c.id, tab })} aria-current={on ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-4 text-sm font-semibold ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-white text-text-main'}`}>
                <Face name={c.first_name} url={c.photo_key ? faces[c.photo_key] : null} size={28} />
                {c.first_name}
              </Link>
            )
          })}
        </nav>
      )}

      <div className="mb-5 flex items-center gap-3">
        <Face name={child.first_name} url={child.photo_key ? faces[child.photo_key] : null} size={52} />
        <h1 className="text-2xl font-bold">{child.first_name}</h1>
      </div>

      <nav aria-label="Sections" className={`mb-5 grid gap-1 rounded-2xl border border-border bg-white p-1 font-semibold ${tabs.length > 3 ? 'grid-cols-4 text-[13px]' : 'grid-cols-3 text-sm'}`}>
        {tabs.map(t => (
          <Link key={t.id} href={href({ child: child.id, tab: t.id === 'today' ? null : t.id })} aria-current={tab === t.id ? 'page' : undefined}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 ${tab === t.id ? 'bg-brand-50 text-brand-700' : 'text-text-muted'}`}>
            {t.label}
            {t.id === 'messages' && unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] leading-5 text-white" aria-label={`${unread} unread`}>{unread}</span>}
          </Link>
        ))}
      </nav>

      {tab === 'today' && <TodayView tokenHash={tokenHash} home={home} childId={child.id} day={sp.day && DAY.test(sp.day) ? sp.day : null} />}
      {tab === 'photos' && <PhotosView tokenHash={tokenHash} childId={child.id} firstName={child.first_name} before={sp.before && !Number.isNaN(Date.parse(sp.before)) ? sp.before : null} />}
      {tab === 'messages' && (
        threads === null
          ? <Card><p className="text-sm text-text-muted">Messages are not turned on for you. Please call {home.center.name}.</p></Card>
          : sp.thread && UUID.test(sp.thread)
            ? <ThreadView tokenHash={tokenHash} threadId={sp.thread} childId={child.id} />
            : sp.compose
              ? <NewMessageForm childId={child.id} childName={child.first_name} centerName={home.center.name} />
              : <ThreadList threads={threads} childId={child.id} childName={child.first_name} tz={home.center.timezone} />
      )}

      {tab === 'menu' && <MenuView tokenHash={tokenHash} childId={child.id} week={sp.week && DAY.test(sp.week) ? sp.week : null} />}

      <footer className="mt-10 text-center text-xs text-muted">
        {home.center.phone && (
          <a href={`tel:${home.center.phone}`} className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 font-semibold text-text-main">
            <Phone className="h-3.5 w-3.5" /> Call {home.center.name}
          </a>
        )}
        <p>Shared by your child’s teachers with CareLocal.</p>
      </footer>
    </>
  )
}

function Face({ name, url, size }: { name: string; url: string | null | undefined; size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-bold text-brand-700"
      style={{ width: size, height: size, fontSize: Math.round(size / 2.6) }}>
      {url
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable
        ? <img src={url} alt="" className="h-full w-full object-cover" />
        : (name[0] ?? '?').toUpperCase()}
    </span>
  )
}

async function TodayView({ tokenHash, home, childId, day }: { tokenHash: string; home: PortalHome; childId: string; day: string | null }) {
  const data = await loadPortalDay(tokenHash, childId, day)
  if (!data) {
    return (
      <Card>
        <p className="text-sm text-text-muted">That day is not available. You can see the last 60 days.</p>
        <Link href={href({ child: childId })} className="mt-3 inline-block text-sm font-semibold text-brand-600">Go to today</Link>
      </Card>
    )
  }
  const tz = data.center.timezone
  const sections = reportSections(data)
  const photos = data.entries.filter(e => e.kind === 'photo' && e.details.photo_key)
  const urls = await signPortalPhotos(home.center.id, photos.map(p => p.details.photo_key))
  const isToday = data.day === data.today
  const oldest = addDays(data.today, -60)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {data.day > oldest
          ? <Link href={href({ child: childId, day: addDays(data.day, -1) })} aria-label="Previous day" className="rounded-xl border border-border bg-white p-2"><ChevronLeft className="h-5 w-5" /></Link>
          : <span className="w-10" />}
        <div className="text-center">
          <p className="text-base font-bold">{isToday ? 'Today' : reportDate(data.day)}</p>
          {isToday && <p className="text-xs text-muted">{reportDate(data.day)}</p>}
        </div>
        {!isToday
          ? <Link href={href({ child: childId, day: addDays(data.day, 1) === data.today ? null : addDays(data.day, 1) })} aria-label="Next day" className="rounded-xl border border-border bg-white p-2"><ChevronRight className="h-5 w-5" /></Link>
          : <span className="w-10" />}
      </div>

      {(data.arrived_at || data.left_at) && (
        <Card>
          <div className="flex items-center gap-3 text-sm">
            <Clock className="h-5 w-5 text-brand-600" />
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {data.arrived_at && <span><span className="text-muted">Arrived</span> <b>{reportTime(data.arrived_at, tz)}</b></span>}
              {data.left_at && <span><span className="text-muted">Picked up</span> <b>{reportTime(data.left_at, tz)}</b></span>}
            </div>
          </div>
        </Card>
      )}

      {sections.map(s => (
        <Card key={s.title}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{s.title}</h2>
          <ul className="space-y-1.5 text-[15px] leading-snug">
            {s.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </Card>
      ))}

      {photos.length > 0 && (
        <Card>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Photos</h2>
          <PhotoGrid items={photos.map(p => ({ id: p.id, url: urls[p.details.photo_key!], caption: p.details.caption ?? null }))} />
        </Card>
      )}

      {sections.length === 0 && photos.length === 0 && !data.arrived_at && (
        <Card><p className="text-sm text-text-muted">{isToday ? 'Nothing recorded yet today. Check back later.' : 'Nothing was recorded this day.'}</p></Card>
      )}
    </div>
  )
}

async function PhotosView({ tokenHash, childId, firstName, before }: { tokenHash: string; childId: string; firstName: string; before: string | null }) {
  const data = await loadPortalPhotos(tokenHash, childId, before)
  if (!data) return <Card><p className="text-sm text-text-muted">Photos are not available.</p></Card>
  const urls = await signPortalPhotos(data.center_id, data.photos.map(p => p.photo_key))
  if (data.photos.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-text-muted">
          {before ? <ImageOff className="h-8 w-8 text-subtle" /> : <Camera className="h-8 w-8 text-subtle" />}
          {before ? 'No older photos. You can see the last 60 days.' : `No photos of ${firstName} yet.`}
        </div>
      </Card>
    )
  }
  const byDay = new Map<string, typeof data.photos>()
  for (const p of data.photos) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p])
  const last = data.photos[data.photos.length - 1]

  return (
    <div className="space-y-4">
      {[...byDay.entries()].map(([day, list]) => (
        <Card key={day}>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">{reportDate(day)}</h2>
          <PhotoGrid items={list.map(p => ({ id: p.id, url: urls[p.photo_key], caption: p.caption }))} />
        </Card>
      ))}
      {data.photos.length >= 30 && (
        <Link href={href({ child: childId, tab: 'photos', before: last.at })} className="block rounded-2xl border border-border bg-white py-3 text-center text-sm font-semibold text-brand-600">
          Older photos
        </Link>
      )}
    </div>
  )
}

async function ThreadView({ tokenHash, threadId, childId }: { tokenHash: string; threadId: string; childId: string }) {
  const thread = await loadPortalThread({ tokenHash }, threadId)
  if (!thread || thread.child.id !== childId) {
    return <Card><p className="text-sm text-text-muted">This conversation is not available.</p>
      <Link href={href({ child: childId, tab: 'messages' })} className="mt-3 inline-block text-sm font-semibold text-brand-600">All messages</Link></Card>
  }
  return (
    <div className="space-y-3">
      <Link href={href({ child: childId, tab: 'messages' })} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600"><ChevronLeft className="h-4 w-4" /> All messages</Link>
      <Conversation thread={thread} />
    </div>
  )
}

function ThreadList({ threads, childId, childName, tz }: { threads: NonNullable<Awaited<ReturnType<typeof loadPortalThreads>>>; childId: string; childName: string; tz: string }) {
  return (
    <div className="space-y-3">
      <Link href={href({ child: childId, tab: 'messages', compose: '1' })}
        className="flex items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700">
        <MessageSquarePlus className="h-4 w-4" /> Message {childName}’s teachers
      </Link>
      {threads.length === 0 ? (
        <Card><p className="text-sm text-text-muted">No messages in the last 60 days.</p></Card>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          {threads.map(t => (
            <li key={t.id}>
              <Link href={href({ child: childId, tab: 'messages', thread: t.id })} className="flex items-start gap-3 px-4 py-3 hover:bg-surface">
                <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${t.unread > 0 ? 'bg-brand-600' : 'bg-transparent'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-[15px] ${t.unread > 0 ? 'font-bold' : 'font-semibold'}`}>{t.subject}</span>
                    <span className="shrink-0 text-xs text-muted">{shortWhen(t.last_at, tz)}</span>
                  </span>
                  <span className="block truncate text-sm text-text-muted">{t.last_from}: {t.preview}</span>
                  {t.needs_ack && <span className="mt-1 inline-block rounded-full bg-amber-50 px-2 text-[11px] font-semibold text-amber-800">Please acknowledge</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PhotoGrid({ items }: { items: { id: string; url: string | undefined; caption: string | null }[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(p => p.url ? (
        <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="group block overflow-hidden rounded-xl bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable */}
          <img src={p.url} alt={p.caption ?? 'Photo'} loading="lazy" className="aspect-square w-full object-cover transition group-hover:opacity-90" />
          {p.caption && <span className="block truncate px-1.5 py-1 text-[11px] text-text-muted">{p.caption}</span>}
        </a>
      ) : (
        <div key={p.id} className="flex aspect-square items-center justify-center rounded-xl bg-surface"><ImageOff className="h-5 w-5 text-subtle" /></div>
      ))}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-border bg-white p-4 shadow-sm">{children}</section>
}
