/**
 * Parent billing: the words the Billing tab shows for each status, and the bill emails.
 *   npm run test:parent-billing
 */
import { billStatus, chargeStatus, paymentLabel, periodLabel, shareLabel, type ParentCharge } from '../../src/lib/parent-billing'
import { buildBillingEmail, howPaid, type BillingNotice } from '../../src/lib/server/billing-notice-send'

let passed = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}

const base: ParentCharge = { id: 'c1', status: 'open', method: 'check', amount: 150, paid: 0, due: 150, account_type: null, last4: null, return_code: null, draft_date: null, sent_at: null, settled_at: null }

console.log('statuses')
check('scheduled ACH', chargeStatus({ ...base, status: 'ach_scheduled', method: 'ach', due: 0, account_type: 'checking', last4: '1234', draft_date: '2026-11-23' }).label === 'ACH draft Mon, Nov 23 from Checking ••1234')
check('sent to the bank', chargeStatus({ ...base, status: 'ach_sent', method: 'ach', due: 0, last4: '9876', account_type: 'savings', sent_at: '2026-11-21T15:00:00Z' }).label === 'Sent to your bank Sat, Nov 21 (Savings ••9876)')
check('returned, with the reason in words', /R01: not enough funds\): \$150\.00 due/.test(chargeStatus({ ...base, status: 'returned', method: 'ach', return_code: 'R01' }).label))
check('unknown return code still shown', /R33\)/.test(chargeStatus({ ...base, status: 'returned', return_code: 'R33' }).label))
check('due at the center', chargeStatus(base).label === '$150.00 due: pay at the center' && chargeStatus(base).tone === 'due')
check('partial', chargeStatus({ ...base, status: 'partial', paid: 50, due: 100 }).label === '$100.00 due · $50.00 paid')
check('paid', chargeStatus({ ...base, status: 'paid', due: 0 }).tone === 'good')
check('a bill shows its most urgent charge', billStatus({ charges: [{ ...base, status: 'paid' }, { ...base, status: 'returned', return_code: 'R02' }] }).tone === 'bad')
check('weekly period', periodLabel({ frequency: 'weekly', period_start: '2026-11-23' }) === 'Week of Nov 23')
check('monthly period', periodLabel({ frequency: 'monthly', period_start: '2026-12-01' }) === 'December 2026')
check('shares', shareLabel({ share_type: 'percent', share_value: 50, fixed_frequency: null }) === 'Pays 50%'
  && shareLabel({ share_type: 'fixed', share_value: 100, fixed_frequency: 'weekly' }) === 'Pays $100.00 a week'
  && shareLabel({ share_type: 'remainder', share_value: null, fixed_frequency: null }) === 'Pays the rest')
check('payment labels', paymentLabel({ kind: 'receipt', date: '2026-11-19', method: 'credit_card', card_brand: 'Visa', last4: '4242', amount: 10, child: 'Ava' }) === 'Credit card Visa ••4242'
  && paymentLabel({ kind: 'ach', date: '2026-11-19', method: 'ach', last4: '1234', account_type: 'checking', amount: 10, child: 'Ava' }) === 'ACH draft (Checking ••1234)')

console.log('bill email')
const notice: BillingNotice = {
  notice_id: 'n1', kind: 'bill', email: 'maria@example.com', name: 'Maria Lopez', attempts: 1,
  center: { name: 'Sunny Days <Learning>', email: 'office@sunny.test', phone: '704-555-0100', domain_key: null, portal_key: 'abcd2345' },
  has_pin: true,
  run: { frequency: 'weekly', period_start: '2026-11-23', period_end: '2026-11-29', draft_date: '2026-11-23' },
  lines: [
    { child: 'Ava', bill_total: 300, share: 150, ach: 150, due: 0, paid: 0, last4: '1234', account_type: 'checking', draft_date: '2026-11-23' },
    { child: 'Ben', bill_total: 200, share: 200, ach: 150, due: 0, paid: 50, last4: '1234', account_type: 'checking', draft_date: '2026-11-23' },
  ],
}
const e = buildBillingEmail(notice)
check('subject names the week, no amounts', e.subject === 'Your bill for the week of Nov 23 · Sunny Days <Learning>' && !/\$/.test(e.subject), e.subject)
check('greets by first name', e.text.startsWith('Hi Maria,'))
check('a split bill says it’s their share', /Your share of \$300\.00/.test(e.text) && !/Your share of \$200\.00/.test(e.text))
check('says when and from where the draft comes', /\$150\.00 by ACH draft on Mon, Nov 23 from Checking ••1234/.test(e.text))
check('credit used is shown', /\$50\.00 paid from your credit/.test(e.text))
check('total of their shares', /Total: \$350\.00/.test(e.text))
check('button to the Billing tab via the center link', e.html.includes('https://carelocal.co/parent/abcd2345?to=billing') && /See your bill/.test(e.html))
check('HTML is escaped', e.html.includes('Sunny Days &lt;Learning&gt;') && !e.html.includes('<Learning>'))
check('how to reach the center', /704-555-0100 or office@sunny\.test/.test(e.text))
const noPin = buildBillingEmail({ ...notice, has_pin: false })
check('no PIN: no button, tells them to ask for one', !/See your bill/.test(noPin.html) && /Ask Sunny Days <Learning> for a parent page PIN/.test(noPin.text))
const noPortal = buildBillingEmail({ ...notice, center: { ...notice.center, portal_key: null } })
check('parent page off: no link at all', !/parent\//.test(noPortal.html) && !/PIN/.test(noPortal.text))
check('due at the center wording', howPaid({ child: 'A', bill_total: 100, share: 100, ach: 0, due: 100, paid: 0, last4: null, account_type: null, draft_date: null }) === '$100.00 to pay at the center')
check('monthly subject', buildBillingEmail({ ...notice, run: { ...notice.run, frequency: 'monthly', period_start: '2026-12-01' } }).subject.startsWith('Your bill for December 2026'))
const v = buildBillingEmail({ ...notice, kind: 'void', lines: [] })
check('canceled email', v.subject === 'Bill canceled: the week of Nov 23 · Sunny Days <Learning>' && /Nothing will be drafted or charged/.test(v.text))

console.log(`\n${passed} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
