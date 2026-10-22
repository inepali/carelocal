import { headers } from 'next/headers'
import type { Metadata } from 'next'
import {
  ShieldCheck, Scale, Users, HeartHandshake, AlertTriangle, FileText, Briefcase, Globe, FolderLock, CreditCard,
  MessageSquare, Ban, KeyRound, Copyright, RefreshCw, Mail,
} from 'lucide-react'
import { getDomainConfig, getDomainKey } from '@/lib/domain-config'
import { legalVocab } from '@/lib/legal'
import { LegalPage, LegalSection, LegalP, LegalItems } from '@/components/legal/LegalPage'

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const domainKey = getDomainKey(host)
  const config = getDomainConfig(domainKey)

  return {
    title: 'Terms & Conditions',
    alternates: { canonical: '/terms' },
    description: `Terms and Conditions governing the use of ${config.appName}: staffing, hiring, staff records, public center pages, tour requests and messaging.`,
  }
}

export default async function TermsPage() {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const domainKey = getDomainKey(host)
  const config = getDomainConfig(domainKey)
  const v = legalVocab(domainKey)
  const app = config.appName

  return (
    <LegalPage config={config} title="Terms & Conditions" Icon={ShieldCheck}>

      <LegalSection Icon={FileText} title="1. Introduction & Acceptance">
        <LegalP>
          Welcome to {app}. These Terms & Conditions (the “Terms”) govern your use of our websites, apps and tools (the “Platform”). The Platform connects {v.providers.toLowerCase()} (“{v.providers}”) with qualified {v.professionals} (“Staff”) for shift coverage and regular hiring, and gives {v.providers} tools to keep staff records, track compliance, publish a public page and respond to families who ask for a tour.
        </LegalP>
        <LegalP>
          By creating an account, using the Platform, or submitting a tour request, you agree to these Terms and to our Privacy Policy. If you use the Platform on behalf of {v.an} {v.provider.toLowerCase()}, you confirm that you have authority to bind it. You must be at least 18 years old to hold an account.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={KeyRound} title="2. Your Account">
        <LegalP>
          Give us accurate information and keep it up to date. Keep your sign-in details private; you are responsible for activity under your account, and you must tell us promptly if you think someone else has used it. An account works on the {app} site where it was created.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={Users} title={`3. For ${v.providers}`}>
        <LegalItems items={[
          { title: 'Accuracy of Listings', body: `${v.providers} must provide accurate and complete information about shifts and jobs, including requirements, location, pay, schedule and necessary qualifications.` },
          { title: 'Compliance', body: `${v.providers} are fully responsible for operating in compliance with all local, state and federal ${v.regulation} rules, including ${domainKey === 'childcare' ? 'staff-to-child ratio' : 'credential'} requirements, background check mandates, employment law and safety standards. The Platform does not make you compliant (see section 7).` },
          { title: 'Payment of Staff', body: `${v.providers} agree to compensate Staff for completed work promptly, on the terms agreed when the shift was booked or the offer was accepted. ${app} does not process or guarantee wages.` },
          { title: 'Work Environment', body: `${v.providers} must provide a safe, respectful and legally compliant workplace for all Staff.` },
          { title: 'Your Records', body: `You decide what records you keep about your Staff and how you use them. You are responsible for limiting access to confidential records, such as medical files, to people who are authorized to see them.` },
        ]} />
      </LegalSection>

      <LegalSection Icon={HeartHandshake} title={`4. For ${v.professionals.charAt(0).toUpperCase()}${v.professionals.slice(1)} (Staff)`}>
        <LegalItems tone="amber" items={[
          { title: 'Credentials & Qualifications', body: 'Staff must provide accurate information about their experience, certifications and background checks, and upload only genuine documents. You are responsible for keeping valid the credentials required for the shifts you claim and the jobs you apply for.' },
          { title: 'Commitment & Punctuality', body: 'By claiming and being confirmed for a shift, Staff commits to arriving on time and completing the full duration of the agreed shift.' },
          { title: 'Professional Conduct', body: `Staff must follow the policies and procedures of the ${v.providers} they work for and maintain a high standard of professional behavior.` },
          { title: 'Cancellations', body: `Staff must give reasonable notice if unable to attend a confirmed shift. Frequent or sudden cancellations seriously affect ${v.provider.toLowerCase()} operations and may result in account suspension.` },
          { title: 'References', body: 'If you list a professional reference, you confirm that the person agrees to be contacted. Their contact details are shared with the centers you join or apply to.' },
        ]} />
      </LegalSection>

      <LegalSection Icon={Briefcase} title="5. Jobs, Applications & Offers">
        <LegalItems items={[
          { title: 'Job postings', body: `${v.providers} may post regular full-time and part-time positions. Postings must be truthful, lawful and non-discriminatory, and may be seen by the public and by search engines. We may remove a posting that is misleading, unlawful or otherwise breaks these Terms.` },
          { title: 'Applying', body: `When you apply, the ${v.provider.toLowerCase()} can see your profile, resume, cover note, experience, credentials, references and the documents you choose to share. Applying does not guarantee an interview or an offer.` },
          { title: 'Offers', body: `${v.An} ${v.provider.toLowerCase()} may send an offer through the Platform, with an optional offer letter. If a letter is attached, you must open it before you can accept. Accepting an offer creates an employment relationship directly between you and the ${v.provider.toLowerCase()}; ${app} is not your employer, does not set the terms of employment, and does not verify that an offer meets legal requirements.` },
          { title: 'One regular position', body: `A regular employee works at one ${v.provider.toLowerCase()} at a time. To accept a regular offer you may need to leave your other centers first, and the Platform may stop you from leaving while you have upcoming confirmed shifts, an open application there, or an administrator role there.` },
        ]} />
      </LegalSection>

      <LegalSection Icon={Globe} title="6. Public Pages & Tour Requests">
        <LegalP>
          <strong className="text-brand-900">Public pages.</strong> {v.An} {v.provider.toLowerCase()} may choose to publish a public page. You control whether the page is on and whether your phone number, email, license number, capacity and Care Score are shown. Everything you publish must be accurate, including license and capacity details, and you must have the right to publish it. Public pages and job listings can be indexed, cached and shared by search engines and other sites, and removing them may not immediately remove copies held elsewhere. We may disable a page that is inaccurate, misleading or breaks these Terms.
        </LegalP>
        <LegalP>
          <strong className="text-brand-900">Tour requests.</strong> A visitor can ask {v.an} {v.provider.toLowerCase()} for a tour through its public page. {app} passes the request to the {v.provider.toLowerCase()}; we do not schedule, guarantee or attend tours, and a request is not an enrollment, admission or contract. The {v.provider.toLowerCase()} is responsible for responding promptly, honoring times it confirms, and keeping the visitor informed of changes.
        </LegalP>
        <LegalP>
          {v.An} {v.provider.toLowerCase()} may use the details in a tour request only to respond to the request, arrange the tour and communicate about enrollment, and must protect them. It may not sell them or use them for unrelated marketing without the visitor’s consent. Visitors should only submit information about {v.tourSubject} that they are entitled to share, and should not include medical or other sensitive details.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={FolderLock} title="7. Documents, Records & Compliance Tools">
        <LegalP>
          The Platform lets {v.providers} collect staff documents, record completion dates, set due dates, review submissions and track what is current, due soon or overdue. These are record-keeping tools. Due dates are calculated from the rules {v.an} {v.provider.toLowerCase()} configures and can be changed by the {v.provider.toLowerCase()}, so what the Platform shows is only as accurate as the rules and records entered. The Platform is not legal advice and does not guarantee that you meet any licensing, inspection or employment requirement. You remain responsible for your own compliance and for checking that records are correct.
        </LegalP>
        <LegalP>
          Do not upload {domainKey === 'childcare' ? 'children’s records' : 'patient or resident records'} or other health information about the people you care for. Access to uploaded documents is logged.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={CreditCard} title="8. Plans, Fees & Payments">
        <LegalItems items={[
          { title: 'Plans and free trial', body: `${v.providers} may start with a free trial; the length is shown in your account. After the trial, paid plans are available, billed monthly or yearly in advance until cancelled. Prices and plan limits are shown in your account before you subscribe, and we will give notice before a price change takes effect.` },
          { title: 'Payment processing', body: 'Payments are processed by Stripe. We do not store full card numbers. You can update your payment method, change your plan or cancel from the billing portal in your account. If a payment fails or a subscription is past due, we may limit paid features, such as posting jobs, until it is resolved. Taxes may apply.' },
          { title: 'Platform maintenance fee (Staff)', body: `A platform maintenance fee may apply to Staff. When a Staff member checks in to a confirmed shift, a fee set for the ${v.provider.toLowerCase()}’s metro area is added to that Staff member’s account balance, which is shown in the account. No fee is added for a shift that is not checked in to. The fee is a charge for use of the Platform and is not wages.` },
        ]} />
      </LegalSection>

      <LegalSection id="sms" Icon={MessageSquare} title="9. Notifications & Text Messages">
        <LegalP>
          We send notifications by email, push notification and in the app about shifts, applications, offers, document requests, tour requests and your account. These are part of the service.
        </LegalP>
        <LegalP>
          <strong className="text-brand-900">Text messages (SMS).</strong> We send texts only to people who have agreed to receive them. Texts may include shift alerts, job offers and other updates, tour confirmations, and verification codes. Message frequency varies with your activity. Message and data rates may apply. Reply STOP to any message to unsubscribe, or HELP for help, or contact {config.supportEmail}. You can also turn texts off in your account settings. Agreeing to receive texts is not a condition of using the Platform or of any purchase, and carriers are not liable for delayed or undelivered messages.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={Ban} title="10. Acceptable Use">
        <LegalP>You agree not to:</LegalP>
        <ul className="list-disc pl-6 space-y-2 text-brand-700 mb-4 leading-relaxed">
          <li>provide false information or documents, or impersonate another person or organization;</li>
          <li>post or send anything unlawful, discriminatory, harassing or misleading;</li>
          <li>use another person’s information, including tour request details, for purposes other than those it was given for;</li>
          <li>scrape, copy or bulk-download Platform data, or interfere with its security or operation; or</li>
          <li>upload malicious files or records about {v.recipients} in your care.</li>
        </ul>
      </LegalSection>

      <LegalSection Icon={Scale} title="11. Platform Role & Limitations">
        <LegalP>
          {app} is a technology platform that facilitates connections and provides record-keeping tools. We do not employ Staff, do not manage the daily operations of any {v.provider.toLowerCase()}, and do not verify credentials, backgrounds, offers or public page content on {v.an} {v.provider.toLowerCase()}’s or Staff member’s behalf unless we say so expressly. We are not responsible for the actions, omissions or conduct of any user, online or offline. {v.providers}, Staff and visitors are independent of {app} and of each other.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={Copyright} title="12. Your Content">
        <LegalP>
          You keep ownership of what you upload or publish, such as documents, profile details, programs, descriptions and job postings. You give us a limited license to host, process, display and transmit it to operate the Platform, including showing it to the people you choose to share it with and, for public pages and job listings, to the public.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={AlertTriangle} title="13. Account Termination">
        <LegalP>
          You can stop using the Platform and ask us to close your account at any time. We may suspend or terminate accounts that violate these Terms, provide false documentation, repeatedly cancel shifts without notice, or harm the {app} community. We may also disable a public page or a job posting without closing the account.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={Scale} title="14. Disclaimers & Liability">
        <LegalP>
          The Platform is provided “as is” and “as available.” To the maximum extent permitted by law, {app} will not be liable for any indirect, incidental, special, consequential or punitive damages resulting from your use of the Platform, the relationships formed through it, or any services provided by users.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={RefreshCw} title="15. Changes to These Terms">
        <LegalP>
          We may update these Terms. The date at the top shows when they were last revised. For material changes we will notify you by email or in the Platform. If you keep using the Platform after a change takes effect, you accept the updated Terms.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={Mail} title="16. Contact">
        <LegalP>
          Questions about these Terms? Contact us at <a href={`mailto:${config.supportEmail}`} className="text-brand-600 hover:underline font-semibold">{config.supportEmail}</a>.
        </LegalP>
      </LegalSection>

    </LegalPage>
  )
}
