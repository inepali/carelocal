// Server only (it handles full account numbers). Self-contained on purpose so scripts/billing/billing.test.mjs can load it.

/**
 * A Nacha (ACH) file of tuition debits, the format banks take for ACH origination uploads. One PPD batch: a debit per
 * family draft, plus (optional) one offsetting credit to the center's account for banks that want a balanced file.
 *
 * Records are 94 characters, padded to a multiple of 10 with 9-filler lines. Field positions follow the Nacha
 * Operating Rules (file header 1, batch header 5, entry 6, batch control 8, file control 9).
 * The bank gives the center its Company ID (often "1" + EIN) when it sets up ACH origination.
 */

export interface NachaDebit {
  routing: string                     // 9 digits (the payer's bank)
  account: string                     // digits, up to 17
  accountType: 'checking' | 'savings'
  amount: number                      // dollars
  name: string                        // the payer
  id?: string                         // shows on the center's report (the child)
}
export interface NachaOptions {
  originRouting: string               // the center's bank (ODFI), 9 digits
  originBankName: string
  companyName: string                 // shows on the family's bank statement (16 characters)
  companyId: string                   // from the bank, up to 10 characters
  entryDescription?: string           // shows on the statement, 10 characters (default TUITION)
  effectiveDate: string               // YYYY-MM-DD, when the drafts settle
  balanced?: { account: string; accountType: 'checking' | 'savings'; name: string }   // offsetting credit to the center
  // File header values some banks set themselves (they say so in their ACH file specs). Defaults: the center's
  // routing number, the bank's name and the Company ID.
  immediateDestination?: string       // 9 digits
  immediateDestinationName?: string   // 23 characters
  immediateOrigin?: string            // up to 10 letters or digits
  lineEnding?: 'lf' | 'crlf'          // most banks take LF; some ask for CRLF
  now?: Date
}

export class NachaError extends Error {}

const ABA = /^\d{9}$/
export function abaOk(p: string): boolean {
  if (!ABA.test(p) || p === '000000000') return false
  const n = p.split('').map(Number)
  return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0
}

/** Letters, digits and plain punctuation only, upper case, cut or padded to the width */
function alpha(s: string, width: number): string {
  const clean = (s ?? '').replace(/[\u2018\u2019]/g, "'").normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/[^A-Za-z0-9 .,&'/()-]/g, ' ').toUpperCase()
  return clean.slice(0, width).padEnd(width, ' ')
}
function num(n: number | string, width: number): string {
  const s = String(n)
  if (!/^\d+$/.test(s)) throw new NachaError(`Not a number: ${s}`)
  if (s.length > width) throw new NachaError(`Too long for ${width} digits: ${s}`)
  return s.padStart(width, '0')
}
const cents = (dollars: number) => Math.round(dollars * 100)
function yymmdd(isoDate: string) { return isoDate.slice(2, 4) + isoDate.slice(5, 7) + isoDate.slice(8, 10) }

function check(line: string, what: string) {
  if (line.length !== 94) throw new NachaError(`${what} record is ${line.length} characters, not 94`)
  return line
}

export function buildNachaFile(debits: NachaDebit[], o: NachaOptions): string {
  if (!debits.length) throw new NachaError('No drafts to put in the file')
  if (!abaOk(o.originRouting)) throw new NachaError('The center’s bank routing number isn’t valid')
  const companyId = (o.companyId ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9]{1,10}$/.test(companyId)) throw new NachaError('The Company ID should be up to 10 letters or digits (your bank gives it to you)')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.effectiveDate)) throw new NachaError('Bad draft date')
  for (const d of debits) {
    if (!abaOk(d.routing)) throw new NachaError(`The routing number for ${d.name} isn’t valid`)
    if (!/^\d{4,17}$/.test(d.account)) throw new NachaError(`The account number for ${d.name} isn’t valid`)
    if (!(cents(d.amount) > 0) || cents(d.amount) > 99_999_999_99) throw new NachaError(`Bad amount for ${d.name}`)
  }
  if (o.balanced && !/^\d{4,17}$/.test(o.balanced.account)) throw new NachaError('The center’s account number isn’t valid')
  const destination = o.immediateDestination?.trim() || o.originRouting
  if (!/^\d{9}$/.test(destination)) throw new NachaError('The immediate destination should be 9 digits (from your bank)')
  const origin = (o.immediateOrigin?.trim() || companyId).toUpperCase()
  if (!/^[A-Z0-9]{1,10}$/.test(origin)) throw new NachaError('The immediate origin should be up to 10 letters or digits (from your bank)')

  const now = o.now ?? new Date()
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const created = `${String(now.getFullYear()).slice(2)}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}`
  const odfi8 = o.originRouting.slice(0, 8)
  const serviceClass = o.balanced ? '200' : '225'
  const batchNo = num(1, 7)

  const lines: string[] = []
  lines.push(check('1' + '01' + ' ' + destination + origin.padStart(10, ' ') + created + time + 'A' + '094' + '10' + '1'
    + alpha(o.immediateDestinationName?.trim() || o.originBankName, 23) + alpha(o.companyName, 23) + ' '.repeat(8), 'File header'))
  lines.push(check('5' + serviceClass + alpha(o.companyName, 16) + ' '.repeat(20) + companyId.padEnd(10, ' ') + 'PPD'
    + alpha(o.entryDescription || 'TUITION', 10) + ' '.repeat(6) + yymmdd(o.effectiveDate) + '   ' + '1' + odfi8 + batchNo, 'Batch header'))

  let seq = 0, hash = 0, debitCents = 0, creditCents = 0
  const entry = (code: string, routing: string, account: string, amountCents: number, id: string, name: string) => {
    seq += 1
    hash += Number(routing.slice(0, 8))
    lines.push(check('6' + code + routing.slice(0, 8) + routing[8] + account.padEnd(17, ' ') + num(amountCents, 10)
      + alpha(id, 15) + alpha(name, 22) + '  ' + '0' + odfi8 + num(seq, 7), 'Entry'))
  }
  for (const d of debits) {
    const c = cents(d.amount)
    debitCents += c
    entry(d.accountType === 'savings' ? '37' : '27', d.routing, d.account, c, d.id ?? '', d.name)
  }
  if (o.balanced) {
    creditCents = debitCents
    entry(o.balanced.accountType === 'savings' ? '32' : '22', o.originRouting, o.balanced.account, creditCents, 'OFFSET', o.balanced.name)
  }
  const hash10 = num(hash % 10_000_000_000, 10)
  lines.push(check('8' + serviceClass + num(seq, 6) + hash10 + num(debitCents, 12) + num(creditCents, 12)
    + companyId.padEnd(10, ' ') + ' '.repeat(19) + ' '.repeat(6) + odfi8 + batchNo, 'Batch control'))
  const blocks = Math.ceil((lines.length + 1) / 10)
  lines.push(check('9' + num(1, 6) + num(blocks, 6) + num(seq, 8) + hash10 + num(debitCents, 12) + num(creditCents, 12)
    + ' '.repeat(39), 'File control'))
  while (lines.length % 10 !== 0) lines.push('9'.repeat(94))
  const eol = o.lineEnding === 'crlf' ? '\r\n' : '\n'
  return lines.join(eol) + eol
}

/**
 * The file name for the bank. Some banks pick up files by name, so the pattern comes from the center's ACH settings.
 * Tokens: {companyId} {date} (YYYYMMDD of the draft) {created} (YYYYMMDDHHMMSS now) {seq} (export count).
 * Only letters, digits, dot, dash and underscore survive.
 */
export function nachaFileName(pattern: string | null | undefined, v: { companyId: string; draftDate: string; seq?: number; now?: Date }): string {
  const now = v.now ?? new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  const created = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
  const name = (pattern?.trim() || 'ach-drafts-{date}-{created}.ach')
    .replaceAll('{companyId}', v.companyId.trim().toUpperCase())
    .replaceAll('{date}', v.draftDate.replaceAll('-', ''))
    .replaceAll('{created}', created)
    .replaceAll('{seq}', String(v.seq ?? 1))
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/^\.+/, '')
  if (!name || name.length > 120) throw new NachaError('The file name pattern makes an empty or too long name')
  return name
}

/** The same drafts as a spreadsheet, for banks that take CSV uploads */
export function buildAchCsv(debits: NachaDebit[], effectiveDate: string): string {
  // Quoted, and a leading = + - @ is defused so a name can't run as a spreadsheet formula
  const q = (s: string) => { const v = String(s ?? ''); return `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"` }
  const rows = [['Draft date', 'Name', 'Child', 'Routing number', 'Account number', 'Account type', 'Amount'].map(q).join(',')]
  for (const d of debits) {
    rows.push([effectiveDate, d.name, d.id ?? '', d.routing, d.account, d.accountType, (cents(d.amount) / 100).toFixed(2)].map(q).join(','))
  }
  return rows.join('\r\n') + '\r\n'
}
