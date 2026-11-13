import Link from 'next/link'
import { Briefcase, Building2, LinkIcon, Star, UserRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getReviewLinkInfo, getReviewLinkOptions } from '@/app/actions/review-links.actions'
import { LinkReviewForm } from './LinkReviewForm'
import { SwitchAccountButton } from './SwitchAccountButton'
import { linkIneligibleReason } from '@/lib/care-score'

/**
 * /r/<code>: someone asked for a review. Anyone can open it and see who is asking; only people with a real working
 * relationship can submit (checked in the database). Parents of a center are sent to the parent portal.
 */
export default async function ReviewLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params
  const code = raw.toLowerCase()
  const info = await getReviewLinkInfo(code)

  if (!info) {
    return (
      <Card>
        <LinkIcon className="mb-3 h-8 w-8 text-subtle" />
        <h1 className="text-lg font-bold text-heading">This review link is not working</h1>
        <p className="mt-1 text-sm text-text-muted">It may have been replaced or expired. Ask the person who sent it for a new one.</p>
      </Card>
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const options = user ? await getReviewLinkOptions(code) : null
  const Icon = info.subject_type === 'center' ? Building2 : UserRound

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><Icon className="h-6 w-6" /></div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Care Score review</p>
            <h1 className="truncate text-xl font-bold text-heading">{info.name}</h1>
            {info.line && <p className="text-sm text-text-muted">{info.line}</p>}
          </div>
        </div>
        <p className="mt-4 text-sm text-text-muted">
          {info.name} asked you for a review on CareLocal. Reviews show your name and role, and help {info.subject_type === 'center' ? 'staff and families choose where to work and enroll' : 'centers know who to book'}.
        </p>
      </Card>

      {!user && (
        <Card>
          <h2 className="font-bold text-heading">{info.subject_type === 'center' ? `Who are you at ${info.name}?` : 'Sign in to leave your review'}</h2>
          <div className="mt-3 grid gap-2">
            <Choice icon={Briefcase} title={info.subject_type === 'center' ? 'I work here' : 'I work with them'}
              text={info.subject_type === 'center'
                ? 'Staff and teachers: sign in to your CareLocal account.'
                : 'Centers and coworkers: sign in to your CareLocal account.'}>
              <Link href={`/login?redirect=${encodeURIComponent(`/r/${code}`)}`} className="mt-3 flex w-full items-center justify-center rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white">
                Sign in to CareLocal
              </Link>
            </Choice>
            {info.parents && <ParentChoice code={code} />}
          </div>
        </Card>
      )}

      {user && options && options.is_self && (
        <Card>
          <h2 className="font-bold text-heading">This is your own review link</h2>
          <p className="mt-1 text-sm text-text-muted">Share it with people you work with. You cannot review yourself.</p>
        </Card>
      )}

      {user && options && !options.is_self && options.options.length === 0 && (
        <Card>
          <h2 className="font-bold text-heading">{info.subject_type === 'center' ? `Who are you at ${info.name}?` : `You can't review ${info.name} yet`}</h2>
          <div className="mt-3 grid gap-2">
            <Choice icon={Briefcase} title={info.subject_type === 'center' ? 'I work here' : 'I work with them'}
              text={linkIneligibleReason(info.subject_type, info.name, options) ?? ''}>
              <SwitchAccountButton code={code} label={info.subject_type === 'center' ? 'Sign in with my staff account' : 'Use a different account'} />
            </Choice>
            {info.parents && <ParentChoice code={code} />}
          </div>
        </Card>
      )}

      {user && options && !options.is_self && options.options.length > 0 && (
        <Card><LinkReviewForm code={code} subjectName={info.name} options={options.options} /></Card>
      )}

      {user && !options && (
        <Card><p className="text-sm text-text-muted">Something went wrong loading this link. Please try again.</p></Card>
      )}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">{children}</section>
}

function Choice({ icon: Icon, title, text, children }: { icon: typeof Star; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 font-semibold text-text-main"><Icon className="h-4 w-4 text-brand-600" /> {title}</div>
      {text && <p className="mt-1 text-sm text-text-muted">{text}</p>}
      {children}
    </div>
  )
}

function ParentChoice({ code }: { code: string }) {
  return (
    <Choice icon={Star} title="I'm a parent here" text="Parents rate the center through the parent portal, with the PIN your center gave you.">
      <a href={`/r/${code}/parent`} className="mt-3 flex w-full items-center justify-center rounded-xl border border-border py-3 text-sm font-semibold text-text-main">
        Go to the parent portal
      </a>
    </Choice>
  )
}
