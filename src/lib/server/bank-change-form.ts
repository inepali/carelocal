import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

/**
 * The ACH debit authorization a parent signs on paper when they ask to change bank accounts (parent billing
 * phase 2). It stays a PPD authorization: the center keeps the signed copy in the child's file. The form names the
 * account by routing number and last 4 only; the full number was typed by the parent online and is stored encrypted.
 * Standard PDF fonts only cover plain Latin text, so everything is cleaned to that first.
 */

export interface BankChangeFormData {
  kind: 'new_account' | 'stop_ach'
  requester_name: string
  holder_name: string | null
  bank_name: string | null
  routing_number: string | null
  account_type: 'checking' | 'savings' | null
  last4: string | null
  created_at: string
  children: { id: string; name: string }[]
  center: { name: string; phone: string | null; email: string | null }
  company_name: string | null
}

/** Plain Latin-1 text: curly quotes and dashes straightened, anything else dropped */
export function pdfText(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/•/g, '*')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
}

function wrapLines(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  for (const para of pdfText(text).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word } else line = next
    }
    out.push(line)
  }
  return out
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

export function authorizationText(d: BankChangeFormData): string[] {
  const center = pdfText(d.center.name)
  const statement = d.company_name ? ` Drafts show on my bank statement as "${pdfText(d.company_name)}".` : ''
  if (d.kind === 'stop_ach') {
    return [
      `I ask ${center} to stop drafting my bank account for tuition and fees for the children named above. I will pay at the center instead, as my enrollment agreement allows.`,
      'I understand that a draft already scheduled before the center processes this request may still be made.',
    ]
  }
  return [
    `I authorize ${center} to make electronic (ACH) debits from the account below for tuition and fees for the children named above, as set out in my enrollment agreement. This replaces any earlier ACH authorization I gave ${center} for these children.${statement}`,
    'The amount may change from one bill to the next. Before each draft, I will get a bill by email showing the amount and the date it will be drafted. If a draft is returned, it may be made again as the rules of the ACH network allow, and the center may charge a returned-payment fee under my enrollment agreement.',
    `This authorization stays in effect until I tell ${center} in writing that I am ending it, in time for the center to act on it (at least 3 business days before the next draft). I can also stop a single draft by contacting my bank.`,
    'I confirm I am an owner of this account, or allowed to authorize drafts from it, and that the account is in the United States.',
  ]
}

export async function buildBankChangeForm(d: BankChangeFormData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(pdfText(`${d.kind === 'new_account' ? 'ACH authorization' : 'Stop ACH request'} - ${d.requester_name}`))
  pdf.setProducer('CareLocal')
  const page: PDFPage = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.09, 0.13, 0.16), muted = rgb(0.36, 0.4, 0.45), line = rgb(0.75, 0.78, 0.8)
  const left = 54, width = 612 - 108
  let y = 738

  const text = (s: string, o: { size?: number; f?: PDFFont; color?: typeof ink; x?: number } = {}) => {
    const size = o.size ?? 10.5
    for (const l of wrapLines(s, o.f ?? font, size, width - ((o.x ?? left) - left))) {
      page.drawText(l, { x: o.x ?? left, y, size, font: o.f ?? font, color: o.color ?? ink })
      y -= size * 1.45
    }
  }
  const gap = (n = 8) => { y -= n }
  const rule = () => { page.drawLine({ start: { x: left, y }, end: { x: left + width, y }, thickness: 0.7, color: line }); y -= 14 }
  const field = (label: string, value: string) => {
    page.drawText(pdfText(label), { x: left, y, size: 9.5, font, color: muted })
    page.drawText(pdfText(value) || '-', { x: left + 150, y, size: 10.5, font: bold, color: ink })
    y -= 17
  }

  text(d.center.name, { size: 11, f: bold, color: muted })
  const contact = [d.center.phone, d.center.email].filter(Boolean).join('  |  ')
  if (contact) text(contact, { size: 9.5, color: muted })
  gap(10)
  text(d.kind === 'new_account' ? 'Authorization for ACH Debits (PPD)' : 'Request to Stop ACH Debits', { size: 18, f: bold })
  text(`Requested online by ${d.requester_name} on ${fmtDate(d.created_at)}`, { size: 9.5, color: muted })
  gap(6); rule()

  field('Parent', d.requester_name)
  field(d.children.length === 1 ? 'Child' : 'Children', d.children.map(c => c.name).join(', '))
  if (d.kind === 'new_account') {
    field('Name on account', d.holder_name ?? '')
    field('Bank', d.bank_name ?? '')
    field('Account type', d.account_type === 'savings' ? 'Savings' : 'Checking')
    field('Routing number', d.routing_number ?? '')
    field('Account number', d.last4 ? `ending in ${d.last4} (entered online by the parent)` : '')
  }
  gap(4); rule()

  for (const p of authorizationText(d)) { text(p); gap(6) }
  gap(18)

  const sigLine = (label: string, x: number, w: number) => {
    page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.8, color: ink })
    page.drawText(pdfText(label), { x, y: y - 13, size: 9, font, color: muted })
  }
  sigLine('Signature of account holder', left, 300); sigLine('Date', left + 330, width - 330)
  y -= 44
  sigLine('Printed name', left, 300)
  y -= 52

  page.drawRectangle({ x: left, y: y - 52, width, height: 64, borderColor: line, borderWidth: 0.7 })
  page.drawText('For the center', { x: left + 10, y: y - 2, size: 9, font: bold, color: muted })
  page.drawText('Received by: ______________________    Date received: ____________    Upload to the child\'s file in CareLocal.',
    { x: left + 10, y: y - 22, size: 8.5, font, color: muted })
  page.drawText('Keep this signed form for 2 years after the authorization ends.', { x: left + 10, y: y - 38, size: 8.5, font, color: muted })

  page.drawText('Prepared with CareLocal', { x: left, y: 36, size: 8, font, color: muted })
  return pdf.save()
}
