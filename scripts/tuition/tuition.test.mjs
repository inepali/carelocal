#!/usr/bin/env node
/**
 * Tests for the tuition helpers (src/lib/tuition.ts): money parsing and labels, the payer pre-check (which must refuse
 * what public.child_payment_plan_save() refuses) and the split preview (which must match public.tuition_split()).
 *
 *   npm run test:tuition
 * Database tests: scripts/tuition/tuition.test.sql
 */
import {
  money, parseMoney, discountLabel, shareLabel, methodDetail, nextMonday, nextFirstOfMonth, suggestedRateStart,
  checkPayers, previewSplit, checkDiscount, discountArgs, firstChargedOn,
} from '../../src/lib/tuition.ts'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('money')
check('formats dollars', money(1234.5) === '$1,234.50')
check('formats strings from the database', money('285.00') === '$285.00')
check('empty is a dash', money(null) === '—')
check('parse plain', parseMoney('285') === 285)
check('parse with $ and comma', parseMoney('$1,200.50') === 1200.5)
check('refuse 3 decimals', parseMoney('1.005') === null)
check('refuse text', parseMoney('abc') === null)
check('refuse negative', parseMoney('-5') === null)
check('empty is null', parseMoney('  ') === null)

console.log('labels')
check('percent discount', discountLabel({ discount_type: 'percent', discount_value: '10.00', discount_reason: 'Sibling' }) === '10% off (Sibling)')
check('amount discount', discountLabel({ discount_type: 'amount', discount_value: 20 }) === '$20.00 off')
check('locked-in price', discountLabel({ override_amount: '250' }) === 'Locked-in price $250.00')
check('no discount', discountLabel({}) === '')
check('fixed share', shareLabel({ share_type: 'fixed', share_value: 200, fixed_frequency: 'weekly' }) === '$200.00 / week')
check('percent share', shareLabel({ share_type: 'percent', share_value: '50.00' }) === '50%')
check('rest share', shareLabel({ share_type: 'remainder' }) === 'The rest')
check('ACH detail', methodDetail({ method: 'ach', account_type: 'checking', last4: '4417', bank_name: 'Wells Fargo' }) === 'ACH · Checking · ····4417 · Wells Fargo')
check('card detail', methodDetail({ method: 'credit_card', card_brand: 'Visa', last4: '1881' }) === 'Card · Visa · ····1881')
check('other detail', methodDetail({ method: 'other', other_details: 'Paid monthly by the state' }) === 'Other · Paid monthly by the state')

console.log('dates')
check('next Monday from Sunday', nextMonday('2026-11-15') === '2026-11-16')
check('next Monday from Monday is a week on', nextMonday('2026-11-16') === '2026-11-23')
check('next Monday from Wednesday', nextMonday('2026-11-18') === '2026-11-23')
check('1st of next month', nextFirstOfMonth('2026-12-15') === '2027-01-01')
check('suggested: monthly', suggestedRateStart('monthly', '2026-11-15') === '2026-12-01')
check('suggested: weekly', suggestedRateStart('weekly', '2026-11-15') === '2026-11-16')
check('first charged: weekly from Wednesday', firstChargedOn('weekly', '2026-11-18') === '2026-11-23')
check('first charged: weekly from Monday', firstChargedOn('weekly', '2026-11-16') === '2026-11-16')
check('first charged: monthly mid-month', firstChargedOn('monthly', '2026-11-18') === '2026-12-01')
check('first charged: monthly on the 1st', firstChargedOn('monthly', '2026-12-01') === '2026-12-01')
check('first charged: biweekly depends on the child', firstChargedOn('biweekly', '2026-11-18') === null)

console.log('payer pre-check')
const ach = { method: 'ach' }
check('ok: subsidy fixed + rest', checkPayers([
  { payer_name: 'Subsidy', share_type: 'fixed', share_value: '200', fixed_frequency: 'weekly', method: 'other' },
  { payer_guardian_id: 'g1', share_type: 'remainder', ...ach },
]) === null)
check('ok: 50/50', checkPayers([
  { payer_guardian_id: 'g1', share_type: 'percent', share_value: '50', ...ach },
  { payer_guardian_id: 'g2', share_type: 'percent', share_value: '50', method: 'credit_card' },
]) === null)
check('ok: no payers (clears)', checkPayers([]) === null)
check('percents short of 100 without the rest', /90%/.test(checkPayers([
  { payer_name: 'A', share_type: 'percent', share_value: '60', ...ach },
  { payer_name: 'B', share_type: 'percent', share_value: '30', ...ach },
]) ?? ''))
check('percents over 100', /more than 100/.test(checkPayers([
  { payer_name: 'A', share_type: 'percent', share_value: '60', ...ach },
  { payer_name: 'B', share_type: 'percent', share_value: '60', ...ach },
  { payer_name: 'C', share_type: 'remainder', ...ach },
]) ?? ''))
check('two "the rest"', /Only one/.test(checkPayers([
  { payer_name: 'A', share_type: 'remainder', ...ach }, { payer_name: 'B', share_type: 'remainder', ...ach },
]) ?? ''))
check('no payer named', /Pick a parent/.test(checkPayers([{ share_type: 'remainder', ...ach }]) ?? ''))
check('full account number refused', /last 4/.test(checkPayers([{ payer_name: 'A', share_type: 'remainder', method: 'ach', last4: '000123456789' }]) ?? ''))
check('fixed needs an amount', /fixed amount/.test(checkPayers([{ payer_name: 'A', share_type: 'fixed', share_value: '', method: 'check' }]) ?? ''))

console.log('split preview (matches public.tuition_split)')
const s1 = previewSplit(256.5, 'weekly', [
  { payer_name: 'Subsidy', share_type: 'fixed', share_value: '200', fixed_frequency: 'weekly', method: 'other' },
  { payer_name: 'Mom', share_type: 'remainder', method: 'ach' },
])
check('subsidy 200, Mom 56.50', eq(s1.amounts, [200, 56.5]) && s1.unassigned === 0, JSON.stringify(s1))
const s2 = previewSplit(250.75, 'weekly', [
  { payer_name: 'Mom', share_type: 'percent', share_value: '50', method: 'ach' },
  { payer_name: 'Dad', share_type: 'percent', share_value: '50', method: 'ach' },
])
check('50/50 odd cent to the first', eq(s2.amounts, [125.38, 125.37]), JSON.stringify(s2))
const s3 = previewSplit(180, 'monthly', [
  { payer_name: 'Subsidy', share_type: 'fixed', share_value: '200', fixed_frequency: 'weekly', method: 'other' },
  { payer_name: 'Mom', share_type: 'remainder', method: 'ach' },
])
check('a weekly fixed amount does not touch the monthly total', eq(s3.amounts, [null, 180]), JSON.stringify(s3))
const s4 = previewSplit(500, 'biweekly', [{ payer_name: 'Grant', share_type: 'fixed', share_value: '600', fixed_frequency: 'biweekly', method: 'check' }])
check('fixed cut down to the total, excess shown', eq(s4.amounts, [500]) && s4.over === 100, JSON.stringify(s4))
const s5 = previewSplit(500, 'biweekly', [{ payer_name: 'Grant', share_type: 'fixed', share_value: '450', fixed_frequency: 'biweekly', method: 'check' }])
check('fixed short of the total leaves money unassigned', s5.unassigned === 50, JSON.stringify(s5))
const s6 = previewSplit(100, 'weekly', [
  { payer_name: 'A', share_type: 'percent', share_value: '33.33', method: 'ach' },
  { payer_name: 'B', share_type: 'remainder', method: 'ach' },
])
check('percent then the rest', eq(s6.amounts, [33.33, 66.67]), JSON.stringify(s6))
const s7 = previewSplit(100, 'weekly', [
  { payer_name: 'Rest', share_type: 'remainder', method: 'ach' },
  { payer_name: 'Fix', share_type: 'fixed', share_value: '30', fixed_frequency: 'weekly', method: 'check' },
])
check('order on screen does not change the math', eq(s7.amounts, [70, 30]), JSON.stringify(s7))

console.log('discount form')
check('percent ok', checkDiscount({ discount_type: 'percent', discount_value: '10', discount_reason: '' }) === null)
check('percent over 100', /100/.test(checkDiscount({ discount_type: 'percent', discount_value: '150', discount_reason: '' }) ?? ''))
check('override $0 is allowed (free spot)', checkDiscount({ discount_type: 'override', discount_value: '0', discount_reason: '' }) === null)
check('none', checkDiscount({ discount_type: '', discount_value: '', discount_reason: '' }) === null)
check('args: override', eq(discountArgs({ discount_type: 'override', discount_value: '$250', discount_reason: 'x' }), { override_amount: '250' }))
check('args: percent', eq(discountArgs({ discount_type: 'percent', discount_value: '10%', discount_reason: ' Sibling ' }), { discount_type: 'percent', discount_value: '10', discount_reason: 'Sibling' }))

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
