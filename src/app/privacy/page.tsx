import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { Lock, FileText, Database, Eye, Users, ShieldAlert, UserCheck, Mail, Server, Cookie, RefreshCw } from 'lucide-react'
import { getDomainConfig, getDomainKey } from '@/lib/domain-config'
import { legalVocab } from '@/lib/legal'
import { LegalPage, LegalSection, LegalP, LegalItems } from '@/components/legal/LegalPage'

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const domainKey = getDomainKey(host)
  const config = getDomainConfig(domainKey)

  return {
    title: 'Privacy Policy',
    alternates: { canonical: '/privacy' },
    description: `Privacy Policy for ${config.appName}, describing what we collect and how we protect staff records, hiring information, public pages and tour requests.`,
  }
}

export default async function PrivacyPage() {
  const headersList = await headers()
  const host = headersList.get('host') || ''
  const domainKey = getDomainKey(host)
  const config = getDomainConfig(domainKey)
  const v = legalVocab(domainKey)
  const app = config.appName
  const provider = v.provider.toLowerCase()

  return (
    <LegalPage config={config} title="Privacy Policy" Icon={Lock}>

      <LegalSection Icon={FileText} title="1. Introduction">
        <LegalP>
          Welcome to {app} (“we,” “our,” or “us”). We are committed to protecting your privacy. This Privacy Policy explains how we collect, use, share and protect information when you use our platform (the “Platform”), which connects {v.providers.toLowerCase()} (“{v.providers}”) with qualified {v.professionals} (“Staff”), supports hiring and staff records, publishes optional public {provider} pages, and lets visitors ask {v.an} {provider} for a tour. By using the Platform you accept this policy.
        </LegalP>
        <LegalP>
          {v.providers} decide what they ask Staff to provide and how they use records after they receive them. Once information is shared with {v.an} {provider}, that {provider}’s own practices also apply to the copy it holds.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={Database} title="2. Information We Collect">
        <LegalItems items={[
          { title: `${v.professionals.charAt(0).toUpperCase()}${v.professionals.slice(1)} (Staff)`, body: 'Profile details (name, email, phone number, address), experience, credentials and certifications, availability, uploaded documents and photos, a resume, applications and cover notes, job alert preferences, the professional references you list (their name, title, business, email and phone, which you confirm they have agreed to share), and ratings and feedback from the centers you work with.' },
          { title: v.providers, body: `Administrator name, email and phone, ${provider} name, address, phone, email, license number and capacity, programs, team bios and other About information, work areas, subscription and billing details (card details are handled by Stripe; we do not store full card numbers), and the staff records you create: documents, completion and due dates, notes, hours, job postings, applications, interview and offer details and offer letters.` },
          { title: 'Visitors who request a tour', body: `Your name, email address, phone number, best time to contact, the tour date and time you pick (or when you are free), your answers to the optional questions (such as preferred start date and topics of interest), any message you write, and the names and ${v.childcare ? 'dates of birth or due dates of your children' : 'details you give about the person the tour is for'}.` },
          { title: 'Usage & Device Data', body: 'Logs of notifications and their delivery status, IP address, browser type, operating system, pages viewed, and a record of who viewed which uploaded document and when.' },
          { title: 'Notification Data', body: 'Your email address, push notification tokens, and, if you opt in to text messages, your mobile number with a record of when and how you agreed, and any request to stop.' },
        ]} />
      </LegalSection>

      <LegalSection Icon={Eye} title="3. How We Use Your Information">
        <LegalItems tone="amber" items={[
          { title: 'Shift Matching, Hiring & Verification', body: `Letting ${v.providers.toLowerCase()} review and verify Staff credentials before shifts are claimed, process applications, schedule interviews and send offers.` },
          { title: 'Records & Compliance Tools', body: `Storing documents and tracking completion and due dates so ${v.providers.toLowerCase()} can manage their ${v.regulation} records.` },
          { title: 'Public Pages & Tour Requests', body: `Showing the information ${v.an} ${provider} chooses to publish, and delivering tour requests to that ${provider}, with confirmation emails to the person who asked.` },
          { title: 'Notifications', body: 'Sending shift alerts, application and offer updates, document requests, tour updates and administrative messages by email, push notification, in the app and, with your consent, text message.' },
          { title: 'Billing, Security & Improvement', body: 'Processing subscription and fee payments, preventing spam, fraud and abuse (for example by limiting repeated submissions), keeping an access log of document views, fixing problems and improving the Platform.' },
        ]} />
      </LegalSection>

      <LegalSection Icon={Users} title="4. Sharing Your Information">
        <LegalP>
          We do not sell your personal information, and we do not share it for advertising. We share information only in these situations:
        </LegalP>
        <LegalItems items={[
          { title: `Between Staff and ${v.providers}`, body: `When you join ${v.an} ${provider}’s pool, claim a shift or apply for a job, that ${provider}’s administrators can see your name, contact details, profile, resume, references and the credentials and documents you choose to share with it. ${v.An} ${provider} can also record ratings and feedback about you, and Staff can rate ${v.providers.toLowerCase()}. When an application closes, the ${provider}’s access that came from it ends after about 30 days.` },
          { title: 'On public pages', body: `If ${v.an} ${provider} turns on its public page, it publishes its name, address, programs, team names, titles and bios, open jobs and a short description, and, if it chooses, its phone, email, license number, capacity and an average Care Score with the number of ratings. Team email addresses and individual reviews are never shown. Published jobs and pages can be indexed and cached by search engines.` },
          { title: 'Tour requests', body: `A tour request goes to the ${provider} you sent it to and its administrators. We do not share it with other ${v.providers.toLowerCase()} or use it for marketing.` },
          { title: 'Service providers', body: 'We use providers that process data for us: Supabase (database and sign-in), Vercel (hosting and analytics), Cloudflare (file storage), Stripe (payments), Twilio (text messages and verification), Resend (email), and Google Firebase and browser push services (push notifications). They may use the information only to provide their service to us.' },
          { title: 'Legal and safety', body: 'We may disclose information if the law requires it, or to protect the safety, rights or property of our users, the public or the Platform. If we are involved in a merger or sale, information may transfer under this policy.' },
        ]} />
      </LegalSection>

      <LegalSection Icon={Server} title="5. Security & Data Retention">
        <LegalP>
          We use administrative, technical and physical safeguards. Documents are stored privately and opened through short-lived secure links; one-time phone upload links expire after 10 minutes and can only receive a file. Access is limited by role, and views of uploaded documents are logged. No system can be guaranteed completely secure.
        </LegalP>
        <LegalP>
          We keep your information while your account is active and as needed to provide the Platform and meet legal and record-keeping obligations. Tour requests stay with the {provider} while its account is active unless deleted. You can ask us to delete your information (section 8); we may keep what the law requires us to keep, and {v.providers.toLowerCase()} may keep their own copies of records you shared with them.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={ShieldAlert} title="6. Children’s Information">
        <LegalP>
          The Platform is for adult {v.professionals} and {provider} administrators, and for adults who ask {v.an} {provider} for a tour. We do not knowingly collect personal information directly from children under 13, and we do not allow children to create accounts. If we learn that a child under 13 has given us personal information directly, we will delete it.
        </LegalP>
        {v.childcare ? (
          <LegalP>
            When a parent or guardian requests a tour, they may give a child’s name and date of birth or due date. We collect this only so the {provider} can prepare for the tour, and share it only with that {provider}. We do not use it for advertising or marketing. A parent or guardian can ask us to delete it by contacting us. Please do not include medical or other sensitive details about a child in a tour request.
          </LegalP>
        ) : (
          <LegalP>
            When someone requests a tour for {v.tourSubject}, they may give that person’s name or date of birth. We collect this only so the {provider} can prepare for the tour, and share it only with that {provider}. Please do not include medical details in a tour request.
          </LegalP>
        )}
      </LegalSection>

      <LegalSection Icon={Cookie} title="7. Cookies & Analytics">
        <LegalP>
          We use essential cookies to keep you signed in and to protect your session. We use Vercel Web Analytics to understand how pages are used; before analytics data is sent we remove sign-in codes and one-time tokens from page addresses. We do not use advertising or cross-site tracking tools.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={UserCheck} title="8. Your Choices & Rights">
        <LegalP>
          You can view, correct or update your profile and documents by signing in. You can leave {v.an} {provider} you have joined, withdraw an application, and delete a job alert. {v.An} {provider} can turn its public page or its tour button off at any time.
        </LegalP>
        <LegalP>
          <strong className="text-brand-900">Text messages.</strong> We text you only if you agree. Reply STOP to any message to stop, or HELP for help. Stopping texts means you will not get immediate shift offers by text, but you can still receive them in the app, by email and by push notification. You can also unsubscribe from emails using the link in them, or by contacting us.
        </LegalP>
        <LegalP>
          Depending on where you live, you may have the right to know what we hold about you and to ask us to correct, delete or give you a copy of it. To make a request, contact us below. We may need to verify who you are first.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={RefreshCw} title="9. Changes to This Policy">
        <LegalP>
          We may update this policy. The date at the top shows when it was last revised. For material changes we will notify you by email or in the Platform.
        </LegalP>
      </LegalSection>

      <LegalSection Icon={Mail} title="10. Contact Us">
        <LegalP>
          If you have questions, concerns or requests about this Privacy Policy or your data, contact us:
        </LegalP>
        <p className="text-brand-700 leading-relaxed">
          <strong className="text-brand-900">{app} Privacy Team</strong><br />
          Email: <a href={`mailto:${config.privacyEmail}`} className="text-brand-600 hover:underline font-semibold">{config.privacyEmail}</a>
        </p>
      </LegalSection>

    </LegalPage>
  )
}
