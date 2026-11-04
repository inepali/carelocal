'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { CenterProgram, WorkArea } from '@/lib/types'
import { ArrowLeft, BookOpen, Home, Loader2, Target, AlertTriangle, CalendarDays } from 'lucide-react'
import { useCenterContext } from '../context'
import CurriculumPanel from './_components/CurriculumPanel'

type ProgramRow = Pick<CenterProgram, 'id' | 'name' | 'age_range' | 'is_active'>
type ClassRow = Pick<WorkArea, 'id' | 'name' | 'program_id' | 'is_active'>

/**
 * Manage Subjects & Goals (lesson plan setup) for center admins.
 *  - Programs and their classes: a class's program is set in About → Manage Data → Classrooms.
 *  - Learning areas, subjects and goals: managed here (CurriculumPanel).
 */
export default function LessonPlansPage() {
  const supabase = createClient()
  const { centerId, workAreaTerm } = useCenterContext()
  const [programs, setPrograms] = useState<ProgramRow[]>([])
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!centerId) return
    let ignore = false
    Promise.all([
      supabase.from('center_programs').select('id, name, age_range, is_active')
        .eq('center_id', centerId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('work_areas').select('id, name, program_id, is_active')
        .eq('center_id', centerId).order('sort_order', { ascending: true }).order('name', { ascending: true }),
    ]).then(([p, c]) => {
      if (ignore) return
      if (p.error || c.error) setError((p.error ?? c.error)!.message)
      setPrograms(p.data || [])
      setClasses(c.data || [])
      setLoading(false)
    })
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId])

  const term = workAreaTerm.toLowerCase()
  const unassigned = classes.filter(c => c.is_active && !c.program_id)

  return (
    <div className="max-w-6xl pb-24">
      <Link href="/center/about#programs" className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-brand-600 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Programs
      </Link>
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-heading mb-2 flex items-center gap-3">
          <Target className="w-8 h-8 text-brand-600" /> Subjects &amp; Goals
        </h1>
        <p className="text-muted">Set up the learning areas, subjects and goals your teachers build weekly lesson plans from, and see which {term} each program covers.</p>
      </div>

      {error && <div className="mb-6 px-4 py-3 rounded-xl text-sm border bg-red-50 text-red-700 border-red-200">{error}</div>}

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-brand-600" /></div>
      ) : (
        <div className="space-y-8">
          <section className="bg-white border border-border rounded-3xl overflow-hidden">
            <div className="p-6 border-b border-border bg-surface/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-text-main flex items-center gap-2"><BookOpen className="w-5 h-5 text-brand-600" /> Programs &amp; {term}</h2>
                <p className="text-sm font-medium text-muted">Lesson plans are made per {term.replace(/s$/, '')}, using its program&apos;s goals.</p>
              </div>
              <Link href="/center/about#data" className="text-sm font-bold text-brand-600 hover:underline shrink-0">Assign {term} to programs →</Link>
            </div>

            {programs.length === 0 ? (
              <div className="p-10 text-center">
                <p className="font-bold text-muted mb-1">No programs yet</p>
                <Link href="/center/about#programs" className="text-sm font-bold text-brand-600 hover:underline">Add your programs first →</Link>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {programs.map(p => {
                  const mine = classes.filter(c => c.program_id === p.id)
                  return (
                    <li key={p.id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="sm:w-64 shrink-0">
                        <div className={`font-bold ${p.is_active ? 'text-text-main' : 'text-subtle'}`}>{p.name}</div>
                        <div className="text-xs text-subtle">{p.age_range || 'Any age'}{p.is_active ? '' : ' · Inactive'}</div>
                      </div>
                      <div className="flex flex-1 flex-wrap gap-1.5">
                        {mine.length === 0 ? (
                          <span className="text-xs font-semibold text-subtle">No {term} yet</span>
                        ) : mine.map(c => (
                          <span key={c.id} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border ${c.is_active ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-slate-50 text-subtle border-slate-200'}`}>
                            <Home className="w-3 h-3" /> {c.name}
                          </span>
                        ))}
                      </div>
                      {mine.length > 0 && (
                        <Link href={`/center/lesson-plans/weekly?program=${p.id}`} className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:underline shrink-0">
                          <CalendarDays className="w-3.5 h-3.5" /> Weekly Lesson Plan
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {unassigned.length > 0 && (
              <div className="px-6 py-4 border-t border-amber-200 bg-amber-50 text-sm text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  <strong>{unassigned.length} {unassigned.length === 1 ? term.replace(/s$/, '') : term} with no program:</strong>{' '}
                  {unassigned.map(c => c.name).join(', ')}. They can&apos;t get lesson plans until they have one.
                </span>
              </div>
            )}
          </section>

          {centerId && <CurriculumPanel centerId={centerId} />}
        </div>
      )}
    </div>
  )
}
