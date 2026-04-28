import Link from 'next/link'
import { ShieldCheck, Scale, Users, HeartHandshake, AlertTriangle, FileText } from 'lucide-react'

export const metadata = {
  title: 'Terms & Conditions | Carelocal',
  description: 'Carelocal Terms & Conditions for Centers and Staff',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#f8faf9] py-20 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-12 text-center">
          <ShieldCheck className="w-16 h-16 text-[#157354] mx-auto mb-6" />
          <h1 className="text-4xl md:text-5xl font-black text-[#0b3828] mb-4 tracking-tight">Terms & Conditions</h1>
          <p className="text-[#6b7a73] text-lg font-medium">Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>

        <div className="bg-white rounded-[2rem] border-2 border-[#e6ece9] p-8 md:p-12 shadow-xl shadow-[#157354]/5">
          
          <div className="prose prose-green max-w-none">
            <div className="flex items-center gap-3 mb-4">
              <FileText className="w-6 h-6 text-[#157354]" />
              <h2 className="text-2xl font-black text-[#0b3828] m-0">1. Introduction</h2>
            </div>
            <p className="text-[#3d5a4f] mb-10 leading-relaxed text-lg">
              Welcome to Carelocal. These Terms & Conditions govern your use of our platform, which serves as a marketplace connecting childcare centers ("Centers") with qualified childcare professionals ("Staff"). By accessing or using Carelocal, you agree to be bound by these terms.
            </p>

            <div className="flex items-center gap-3 mb-4">
              <Users className="w-6 h-6 text-[#157354]" />
              <h2 className="text-2xl font-black text-[#0b3828] m-0">2. For Childcare Centers</h2>
            </div>
            <ul className="list-none pl-0 space-y-4 text-[#3d5a4f] mb-10">
              <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#edf7f3] text-[#157354] flex items-center justify-center font-black text-xs">A</span>
                <div>
                  <strong className="text-[#0b3828] block mb-1">Accuracy of Listings</strong>
                  <span className="leading-relaxed">Centers must provide accurate and complete information regarding available shifts, including requirements, location, hourly rates, and necessary staff qualifications.</span>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#edf7f3] text-[#157354] flex items-center justify-center font-black text-xs">B</span>
                <div>
                  <strong className="text-[#0b3828] block mb-1">Compliance</strong>
                  <span className="leading-relaxed">Centers are fully responsible for ensuring that they operate in compliance with all local, state, and federal childcare regulations, including staff-to-child ratio requirements, background check mandates, and safety standards.</span>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#edf7f3] text-[#157354] flex items-center justify-center font-black text-xs">C</span>
                <div>
                  <strong className="text-[#0b3828] block mb-1">Payment Obligations</strong>
                  <span className="leading-relaxed">Centers agree to compensate Staff for completed shifts in a timely manner according to the terms and payment method agreed upon during the shift booking process.</span>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#edf7f3] text-[#157354] flex items-center justify-center font-black text-xs">D</span>
                <div>
                  <strong className="text-[#0b3828] block mb-1">Work Environment</strong>
                  <span className="leading-relaxed">Centers must provide a safe, respectful, and legally compliant working environment for all Carelocal Staff.</span>
                </div>
              </li>
            </ul>

            <div className="flex items-center gap-3 mb-4">
              <HeartHandshake className="w-6 h-6 text-[#157354]" />
              <h2 className="text-2xl font-black text-[#0b3828] m-0">3. For Childcare Staff</h2>
            </div>
            <ul className="list-none pl-0 space-y-4 text-[#3d5a4f] mb-10">
               <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#fefce8] text-[#854d0e] flex items-center justify-center font-black text-xs">A</span>
                <div>
                  <strong className="text-[#0b3828] block mb-1">Credentials & Qualifications</strong>
                  <span className="leading-relaxed">Staff must provide accurate information regarding their experience, certifications, and background checks. You are responsible for maintaining valid credentials required for the shifts you claim.</span>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#fefce8] text-[#854d0e] flex items-center justify-center font-black text-xs">B</span>
                <div>
                  <strong className="text-[#0b3828] block mb-1">Commitment & Punctuality</strong>
                  <span className="leading-relaxed">By claiming and being confirmed for a shift, Staff commits to arriving on time and completing the full duration of the agreed-upon shift.</span>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#fefce8] text-[#854d0e] flex items-center justify-center font-black text-xs">C</span>
                <div>
                  <strong className="text-[#0b3828] block mb-1">Professional Conduct</strong>
                  <span className="leading-relaxed">Staff must adhere to the policies and procedures of the Centers they work at and maintain a high standard of professional behavior and quality childcare.</span>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#fefce8] text-[#854d0e] flex items-center justify-center font-black text-xs">D</span>
                <div>
                  <strong className="text-[#0b3828] block mb-1">Cancellations</strong>
                  <span className="leading-relaxed">Staff must provide reasonable notice if unable to attend a confirmed shift. Frequent or sudden cancellations severely impact center operations and may result in account suspension.</span>
                </div>
              </li>
            </ul>

            <div className="flex items-center gap-3 mb-4">
              <Scale className="w-6 h-6 text-[#157354]" />
              <h2 className="text-2xl font-black text-[#0b3828] m-0">4. Platform Role & Limitations</h2>
            </div>
            <p className="text-[#3d5a4f] mb-10 leading-relaxed">
              Carelocal acts solely as a technology marketplace to facilitate connections between Centers and Staff. We do not directly employ the Staff, nor do we manage the daily operations of the Centers. We are not responsible for the actions, omissions, or conduct of any User, whether online or offline. Both Centers and Staff are independent entities using the platform.
            </p>

            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-[#157354]" />
              <h2 className="text-2xl font-black text-[#0b3828] m-0">5. Account Termination</h2>
            </div>
            <p className="text-[#3d5a4f] mb-10 leading-relaxed">
              We reserve the right to suspend or terminate accounts that violate these Terms, provide false documentation, repeatedly cancel shifts without notice, or engage in behavior detrimental to the Carelocal community.
            </p>

            <h2 className="text-2xl font-black text-[#0b3828] mb-4">6. Liability</h2>
            <p className="text-[#3d5a4f] mb-10 leading-relaxed">
              To the maximum extent permitted by law, Carelocal shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the platform, the relationships formed through it, or any childcare services provided.
            </p>
          </div>
          
          <div className="mt-12 pt-8 border-t border-[#e6ece9] flex justify-center">
            <Link 
              href="/"
              className="px-8 py-4 bg-[#f8faf9] text-[#157354] font-black text-xs uppercase tracking-widest rounded-xl hover:bg-[#edf7f3] transition-all border border-[#d4ede4] flex items-center gap-2"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
