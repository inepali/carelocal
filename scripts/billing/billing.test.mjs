#!/usr/bin/env node
/**
 * Tests for the Run Billing helpers (src/lib/billing.ts) and the Nacha / CSV file writer (src/lib/server/nacha.ts).
 *
 *   npm run test:billing
 * Database tests: scripts/billing/billing.test.sql
 */
import { mondayOf, addDays, monthStart, addMonths, billingWindow, defaultWindowDay, sumMoney, checkPayment, planPayment, checkReceipt } from '../../src/lib/billing.ts'
import { buildNachaFile, buildAchCsv, abaOk, NachaError } from '../../src/lib/server/nacha.ts'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}
const throws = (fn, pat) => { try { fn(); return false } catch (e) { return e instanceof NachaError && pat.test(e.message) } }

console.log('windows')
check('Monday of a Sunday', mondayOf('2026-11-15') === '2026-11-09')
check('Monday of a Monday', mondayOf('2026-11-16') === '2026-11-16')
check('Monday across a month', mondayOf('2026-12-02') === '2026-11-30')
check('add days across a year', addDays('2026-12-30', 3) === '2027-01-02')
check('month start', monthStart('2026-11-15') === '2026-11-01')
check('add months across a year', addMonths('2026-12-15', 1) === '2027-01-01')
check('weekly window', JSON.stringify(billingWindow('weekly', '2026-11-19')) === JSON.stringify({ start: '2026-11-16', end: '2026-11-22' }))
check('monthly window (February)', JSON.stringify(billingWindow('monthly', '2027-02-10')) === JSON.stringify({ start: '2027-02-01', end: '2027-02-28' }))
check('default week on Sunday = next week', defaultWindowDay('weekly', '2026-11-15') === '2026-11-16')
check('default week on Tuesday = this week', defaultWindowDay('weekly', '2026-11-17') === '2026-11-16')
check('default week on Thursday = next week', defaultWindowDay('weekly', '2026-11-19') === '2026-11-23')
check('default month early = this month', defaultWindowDay('monthly', '2026-11-05') === '2026-11-01')
check('default month late = next month', defaultWindowDay('monthly', '2026-11-25') === '2026-12-01')

console.log('money')
check('sum to the cent', sumMoney([0.1, 0.2, '285.00', null]) === 285.3)
check('payment ok', checkPayment({ amount: '42.50', method: 'check', received_on: '2026-11-15' }, 42.5, '2026-11-15') === null)
check('payment over balance', /more than/.test(checkPayment({ amount: '42.51', method: 'check', received_on: '2026-11-15' }, 42.5, '2026-11-15') ?? ''))
check('payment needs method', /how it was paid/.test(checkPayment({ amount: '1', method: 'ach', received_on: '2026-11-15' }, 5, '2026-11-15') ?? ''))
check('payment not in future', /future/.test(checkPayment({ amount: '1', method: 'cash', received_on: '2026-11-16' }, 5, '2026-11-15') ?? ''))
check('payment amount format', /amount/.test(checkPayment({ amount: '1.005', method: 'cash', received_on: '2026-11-15' }, 5, '2026-11-15') ?? ''))

console.log('payment card')
const open2 = [
  { id: 'a', label: 'week of Nov 9', period_start: '2026-11-09', amount: 375, paid: 0, balance: 375, status: 'open' },
  { id: 's', label: 'week of Nov 16', period_start: '2026-11-16', amount: 375, paid: 0, balance: 375, status: 'ach_sent' },
  { id: 'b', label: 'week of Nov 23', period_start: '2026-11-23', amount: 375, paid: 100, balance: 275, status: 'partial' },
]
const pp = (a) => JSON.stringify(planPayment(a, open2))
check('partial payment', pp(200) === JSON.stringify({ applied: 200, credit: 0, stillDue: 450, paidCharges: 1 }), pp(200))
check('oldest first, skips sent draft', pp(500) === JSON.stringify({ applied: 500, credit: 0, stillDue: 150, paidCharges: 2 }), pp(500))
check('over = credit', pp(1000.1) === JSON.stringify({ applied: 650, credit: 350.1, stillDue: 0, paidCharges: 2 }), pp(1000.1))
check('advance with nothing due', JSON.stringify(planPayment(375, [])) === JSON.stringify({ applied: 0, credit: 375, stillDue: 0, paidCharges: 0 }))
const rcpt = { payer_id: 'x', amount: '$1,200.50', method: 'credit_card', card_brand: 'Visa', last4: '4242', reference: '', received_on: '2026-11-16', note: '' }
check('receipt ok (with $ and comma)', checkReceipt(rcpt, '2026-11-16') === null)
check('receipt needs payer', /who is paying/.test(checkReceipt({ ...rcpt, payer_id: '' }, '2026-11-16') ?? ''))
check('receipt last 4 only', /last 4/.test(checkReceipt({ ...rcpt, last4: '42424' }, '2026-11-16') ?? ''))
check('receipt no future', /future/.test(checkReceipt({ ...rcpt, received_on: '2026-11-17' }, '2026-11-16') ?? ''))

console.log('nacha')
check('ABA ok', abaOk('021000021') && abaOk('011000015'))
check('ABA bad checksum', !abaOk('021000022'))
const debits = [
  { routing: '021000021', account: '123456789', accountType: 'checking', amount: 91.5, name: 'Priya Sharma', id: 'Ava A' },
  { routing: '011000015', account: '000987654321', accountType: 'savings', amount: 142.5, name: 'Bené O’Neil', id: 'Ben B' },
]
const opts = { originRouting: '053000196', originBankName: 'Truist', companyName: 'Kiddie Academy', companyId: '1123456789', effectiveDate: '2026-11-16', now: new Date(2026, 10, 15, 21, 5) }
const file = buildNachaFile(debits, opts)
const lines = file.trimEnd().split('\n')
check('every record is 94 characters', lines.every(l => l.length === 94), lines.map(l => l.length).join(','))
check('padded to blocks of 10', lines.length % 10 === 0)
check('record order', lines.slice(0, 6).map(l => l[0]).join('') === '156689')
check('file header destination', lines[0].slice(3, 13) === ' 053000196')
check('file header origin', lines[0].slice(13, 23) === '1123456789')
check('file creation date', lines[0].slice(23, 29) === '261115' && lines[0].slice(29, 33) === '2105')
check('debits-only service class', lines[1].slice(1, 4) === '225')
check('PPD', lines[1].slice(50, 53) === 'PPD')
check('entry description', lines[1].slice(53, 63) === 'TUITION   ')
check('effective date', lines[1].slice(69, 75) === '261116')
check('checking debit code 27', lines[2].slice(1, 3) === '27')
check('savings debit code 37', lines[3].slice(1, 3) === '37')
check('RDFI + check digit', lines[2].slice(3, 12) === '021000021')
check('account left-justified', lines[2].slice(12, 29) === '123456789        ')
check('amount in cents', lines[2].slice(29, 39) === '0000009150')
check('name cleaned and upper-cased', lines[3].slice(54, 76) === "BENE O'NEIL           ", JSON.stringify(lines[3].slice(54, 76)))
check('trace number', lines[3].slice(79, 94) === '053000190000002')
check('batch control count', lines[4].slice(4, 10) === '000002')
check('entry hash', lines[4].slice(10, 20) === String(2100002 + 1100001).padStart(10, '0'))
check('batch debit total', lines[4].slice(20, 32) === '000000023400')
check('file control blocks', lines[5].slice(7, 13) === '000001')
check('file control debit total', lines[5].slice(31, 43) === '000000023400')
check('filler lines', lines.slice(6).every(l => l === '9'.repeat(94)))

const bal = buildNachaFile(debits, { ...opts, balanced: { account: '5555', accountType: 'checking', name: 'Center A LLC' } }).trimEnd().split('\n')
check('balanced service class', bal[1].slice(1, 4) === '200')
check('offset credit code 22', bal[4].slice(1, 3) === '22' && bal[4].slice(29, 39) === '0000023400')
check('balanced totals', bal[5].slice(20, 32) === '000000023400' && bal[5].slice(32, 44) === '000000023400')

check('refuses bad company id', throws(() => buildNachaFile(debits, { ...opts, companyId: '12-34' }), /Company ID/))
check('refuses bad payer routing', throws(() => buildNachaFile([{ ...debits[0], routing: '123456789' }], opts), /routing number for/))
check('refuses bad account', throws(() => buildNachaFile([{ ...debits[0], account: '12' }], opts), /account number for/))
check('refuses an empty batch', throws(() => buildNachaFile([], opts), /No drafts/))

console.log('csv')
const csv = buildAchCsv([{ ...debits[0], name: '=HYPERLINK("x")' }], '2026-11-16')
check('header row', csv.startsWith('"Draft date","Name","Child","Routing number","Account number","Account type","Amount"'))
check('formula defused', csv.includes(`"'=HYPERLINK(""x"")"`))
check('amount two decimals', csv.includes('"91.50"'))

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
