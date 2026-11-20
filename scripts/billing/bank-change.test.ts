/**
 * Parent bank change requests: labels, the authorization form PDF, and the emails.
 *   npm run test:bank-change
 */
import { PDFDocument } from 'pdf-lib'
import { bankChangeLabel, bankChangeStatus, checkRouting } from '../../src/lib/parent-billing'
import { authorizationText, buildBankChangeForm, pdfText, type BankChangeFormData } from '../../src/lib/server/bank-change-form'
import { bankChangeDecisionEmail, bankChangeReceivedEmail } from '../../src/lib/server/bank-change-emails'

let passed = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}

console.log('labels')
check('new account', bankChangeLabel({ kind: 'new_account', account_type: 'savings', last4: '9876', bank_name: 'Wells Fargo' }) === 'ACH from Wells Fargo Savings ••9876')
check('stop ACH', bankChangeLabel({ kind: 'stop_ach', account_type: null, last4: null }) === 'Stop ACH drafts, pay at the center')
check('waiting', bankChangeStatus({ status: 'pending', effective_from: null }).tone === 'due')
check('approved with a date', bankChangeStatus({ status: 'approved', effective_from: '2026-11-21' }).label === 'Done, from Sat, Nov 21')
check('routing numbers', checkRouting('121000248') && checkRouting('053000196') && !checkRouting('123456789') && !checkRouting('000000000') && !checkRouting('12100024'))

console.log('the form')
const data: BankChangeFormData = {
  kind: 'new_account', requester_name: 'María López', holder_name: 'María López', bank_name: 'Wells Fargo', routing_number: '121000248',
  account_type: 'savings', last4: '9876', created_at: '2026-11-20T15:00:00Z', children: [{ id: 'a', name: 'Ava' }, { id: 'b', name: 'Ben' }],
  center: { name: 'Sunny Day’s – Matthews', phone: '704-555-0100', email: 'office@sunny.test' }, company_name: 'SUNNY DAYS',
}
check('plain text for PDF fonts', pdfText('Sunny Day’s – “A” •') === 'Sunny Day\'s - "A" *' && pdfText('María 😀') === 'María ')
const words = authorizationText(data).join(' ')
check('the authorization names the center and varying amounts', words.includes("Sunny Day's - Matthews") && /amount may change/.test(words) && /in writing/.test(words))
check('the statement name is on the form', words.includes('"SUNNY DAYS"'))
check('stop ACH wording', /stop drafting/.test(authorizationText({ ...data, kind: 'stop_ach' }).join(' ')))
async function main() {
const bytes = await buildBankChangeForm(data)
const doc = await PDFDocument.load(bytes)
check('a one-page PDF', doc.getPageCount() === 1 && Buffer.from(bytes.slice(0, 5)).toString() === '%PDF-')
check('the PDF has no full account number field', !Buffer.from(bytes).toString('latin1').includes('newcipher'))
const stop = await buildBankChangeForm({ ...data, kind: 'stop_ach', holder_name: null, routing_number: null, last4: null, account_type: null, company_name: null })
check('stop ACH form builds', (await PDFDocument.load(stop)).getPageCount() === 1)

console.log('emails')
const got = bankChangeReceivedEmail({ center: 'Sunny Days', name: 'Maria Lopez', kind: 'new_account', account_type: 'checking', last4: '1111' })
check('received: last 4 and next step', got.subject === 'We got your bank change request · Sunny Days' && got.html.includes('Checking ••1111') && got.html.includes('sign an authorization form'))
const ok = bankChangeDecisionEmail({ center: 'Sunny Days', name: 'Maria Lopez', kind: 'new_account', approved: true, account_type: 'savings', last4: '9876', effective_from: '2026-11-21' })
check('approved: date and account', ok.html.includes('Saturday, Nov 21') && ok.html.includes('Savings ••9876') && ok.subject.includes('is done'))
const no = bankChangeDecisionEmail({ center: 'Sunny Days', name: 'Maria Lopez', kind: 'stop_ach', approved: false, reason: '<b>Call us</b>' })
check('declined: the reason, escaped', no.html.includes('&lt;b&gt;Call us&lt;/b&gt;') && !no.html.includes('<b>Call us'))
check('first name greeting', no.html.includes('Hi Maria,'))
}

main().then(() => {
console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) { console.log('Failed:\n  ' + failures.join('\n  ')); process.exit(1) }
})
