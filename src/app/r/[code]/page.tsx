import Link from 'next/link'
import { Building2, LinkIcon, Star, UserRound } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getReviewLinkInfo, getReviewLinkOptions } from '@/app/actions/review-links.actions'
import { LinkReviewForm } from './LinkReviewForm'

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
          <h2 className="font-bold text-heading">Sign in to leave your review</h2>
          <p className="mt-1 text-sm text-text-muted">Only people who work or worked with {info.name} can review, so we need to know who you are.</p>
          <Link href={`/login?redirect=${encodeURIComponent(`/r/${code}`)}`} className="mt-4 flex w-full items-center justify-center rounded-xl bg-brand-600 py-3 font-semibold text-white">
            Sign in to CareLocal
          </Link>
          {info.parents && <ParentLink code={code} />}
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
          <h2 className="font-bold text-heading">You can&apos;t review {info.name} yet</h2>
          <p className="mt-1 text-sm text-text-muted">
            {info.subject_type === 'center'
              ? 'Reviews are for people who work at this center or worked a shift there in the last 6 months.'
              : 'Reviews are for centers and coworkers who work, or worked in the last 6 months, at the same center.'}
          </p>
          {info.parents && <ParentLink code={code} />}
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

function ParentLink({ code }: { code: string }) {
  return (
    <a href={`/r/${code}/parent`} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-semibold text-text-main">
      <Star className="h-4 w-4 text-amber-400" /> I&apos;m a parent here
    </a>
  )
}
