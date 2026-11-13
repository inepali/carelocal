#!/usr/bin/env node
/**
 * Tests for the Care Score helpers (src/lib/care-score.ts). The numbers match the database checks in
 * scripts/care-score/care-score.db.test.sql, so the TypeScript mirror and public.recompute_care_score() agree.
 *
 *   npm run test:care-score
 */
import {
  computeCareScore, starWeight, recencyWeight, buildHistogram, histogramRows, hasEnoughReviews, formatScore,
  attributionLine, reviewerTypeFor, reviewWindow, reviewErrorMessage, MIN_REVIEWS_FOR_SCORE,
  personalInfoWarnings, personalInfoMessage, REPORT_REASONS, HOLD_REASON_LABELS,
} from '../../src/lib/care-score.ts'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const many = (n, rating, opts = {}) => Array.from({ length: n }, (_, i) => ({ rating, reviewerId: opts.reviewer ?? `r-${rating}-${i}`, ageDays: opts.age ?? 0 }))

console.log('weights')
check('star weights', starWeight(1) === 1.5 && starWeight(2) === 1.25 && starWeight(3) === 1 && starWeight(4) === 1 && starWeight(5) === 0.9)
check('recency half-life', recencyWeight(0) === 1 && Math.abs(recencyWeight(365) - 0.5) < 1e-9 && recencyWeight(-5) === 1)

console.log('score')
check('no reviews → null', computeCareScore([]) === null)
check('worked example 9×5★ + 1×1★ = 4.25', computeCareScore([...many(9, 5), ...many(1, 1)]) === 4.25, String(computeCareScore([...many(9, 5), ...many(1, 1)])))
check('single 5★ pulled toward prior', computeCareScore(many(1, 5)) === 4.15)
check('single 1★ does not sink a profile', computeCareScore(many(1, 1)) === 3.31)
const heavy = [...many(4, 5), ...many(20, 1, { reviewer: 'same-center' })]
check('one reviewer counts once (3.91)', computeCareScore(heavy) === 3.91, String(computeCareScore(heavy)))
const heavyOld = [...many(4, 5), ...many(20, 1, { reviewer: 'same-center', age: 365 })]
check('old reviews weigh less (4.14)', computeCareScore(heavyOld) === 4.14, String(computeCareScore(heavyOld)))
check('trust scales weight', computeCareScore([{ rating: 1, reviewerId: 'a', ageDays: 0, trust: 0.5 }]) < 4 &&
  computeCareScore([{ rating: 1, reviewerId: 'a', ageDays: 0, trust: 0.5 }]) > computeCareScore(many(1, 1)))
check('many 5★ approach but stay under 5', computeCareScore(many(200, 5)) > 4.95 && computeCareScore(many(200, 5)) < 5)

console.log('display')
check('histogram', eq(buildHistogram([5, 5, 4, 1, 9]), { 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 }))
const rows = histogramRows({ 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 })
check('rows 5→1 with shares', eq(rows.map(r => r.star), [5, 4, 3, 2, 1]) && rows[0].share === 0.5 && rows[3].share === 0)
check('rows on empty', histogramRows(null).every(r => r.count === 0 && r.share === 0))
check('enough reviews', !hasEnoughReviews(null) && !hasEnoughReviews({ review_count: MIN_REVIEWS_FOR_SCORE - 1 }) && hasEnoughReviews({ review_count: MIN_REVIEWS_FOR_SCORE }))
check('formatScore', formatScore(4.246) === '4.2' && formatScore(null) === '–')
check('attribution', attributionLine({ author_name: 'Priya S.', author_role: 'Owner', author_org: 'Sunrise KA' }) === 'Priya S. · Owner · Sunrise KA' &&
  attributionLine({ author_name: 'Maria G.', author_role: 'Teacher', author_org: null }) === 'Maria G. · Teacher')
check('reviewer side', reviewerTypeFor('staff') === 'center' && reviewerTypeFor('center') === 'staff')

console.log('review window')
const ended = new Date('2026-11-10T17:00:00Z')
check('before end closed', !reviewWindow(ended, new Date('2026-11-10T16:00:00Z')).open)
check('day after open', reviewWindow(ended, new Date('2026-11-11T17:00:00Z')).open)
check('after 7 days closed', !reviewWindow(ended, new Date('2026-11-17T17:00:01Z')).open)

console.log('errors')
check('duplicate', reviewErrorMessage('duplicate key value violates unique constraint "shift_reviews_shift_pair_key"') === 'You have already reviewed this shift.')
check('locked', /48 hours/.test(reviewErrorMessage('This review can no longer be edited')))
check('passthrough', reviewErrorMessage('boom') === 'boom' && reviewErrorMessage(null).length > 0)

console.log('personal info (same cases as care-score-v1-1.db.test.sql)')
check('phone', eq(personalInfoWarnings('Call me at (704) 555-0199 anytime'), ['phone']) && eq(personalInfoWarnings('704.555.0199'), ['phone']) && eq(personalInfoWarnings('+1 704-555-0199'), ['phone']))
check('email', eq(personalInfoWarnings('Email me: maria@example.com'), ['email']))
check('address', eq(personalInfoWarnings('Lovely team at 123 Main Street'), ['address']) && eq(personalInfoWarnings('4500 park rd'), ['address']))
check('clean text', eq(personalInfoWarnings('Great with toddlers, 5 stars, 3 rooms covered'), []) && eq(personalInfoWarnings(null), []))
check('several', eq(personalInfoWarnings('maria@example.com or 704-555-0199'), ['phone', 'email']))
check('message', /phone number, email address/.test(personalInfoMessage(['phone', 'email'])) && /children's names/.test(personalInfoMessage(['child_name'])) && personalInfoMessage([]) === '')
check('report reasons match database', eq(REPORT_REASONS.map(r => r.value), ['retaliation', 'false_information', 'child_info', 'harassment', 'other']))
check('hold labels cover database reasons', ['phone', 'email', 'address', 'child_name', 'reported_child_info'].every(k => HOLD_REASON_LABELS[k]))

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
