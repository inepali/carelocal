'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  Mail, 
  Phone, 
  MapPin, 
  Clock, 
  Send, 
  CheckCircle2, 
  MessageSquare, 
  HelpCircle, 
  Loader2 
} from 'lucide-react'
import { submitContactForm } from '@/app/actions/contact.actions'
import { getDomainConfig } from '@/lib/domain-config'

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    contactType: '',
    subject: '',
    message: ''
  })
  
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  // Resolve domain vertical configuration dynamically
  const [domainKey, setDomainKey] = useState<'childcare' | 'healthcare'>('childcare')
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const host = window.location.host
      if (host.includes('carelocalhealth.com') || host.includes('3001')) {
        setDomainKey('healthcare')
      }
    }
  }, [])

  const config = getDomainConfig(domainKey)
  const isHealthcare = domainKey === 'healthcare'

  const contactTypes = [
    { value: 'Customer Support', label: 'Customer Support' },
    { value: 'Billing', label: 'Billing' },
    { value: 'Partnership', label: 'Partnership' },
    { value: 'Sales', label: 'Sales' },
    { value: 'Others', label: 'Others' }
  ]

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    if (errors[name]) {
      setErrors(prev => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
  }

  const validate = () => {
    const newErrors: Record<string, string> = {}
    
    if (!formData.name.trim()) {
      newErrors.name = 'Full name is required'
    }
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email address is required'
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address'
    }
    
    if (!formData.contactType) {
      newErrors.contactType = 'Please select a contact type'
    }
    
    if (!formData.subject.trim()) {
      newErrors.subject = 'Subject is required'
    }
    
    if (!formData.message.trim()) {
      newErrors.message = 'Message is required'
    } else if (formData.message.trim().length < 10) {
      newErrors.message = 'Message must be at least 10 characters long'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    
    setIsSubmitting(true)
    try {
      const result = await submitContactForm(formData)
      if (result.error) {
        setErrors({ form: result.error })
      } else {
        setIsSuccess(true)
      }
    } catch (err) {
      setErrors({ form: 'An unexpected error occurred. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReset = () => {
    setFormData({
      name: '',
      email: '',
      contactType: '',
      subject: '',
      message: ''
    })
    setErrors({})
    setIsSuccess(false)
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-between">
      
      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 glass border-b border-brand-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">{config.logoShort}</span>
            </div>
            <span className="font-bold text-brand-900 text-lg">{config.appName}</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-brand-700">
            <Link href="/#how-it-works" className="hover:text-brand-600 transition-colors">How it works</Link>
            <Link href="/#features" className="hover:text-brand-600 transition-colors">Features</Link>
            <Link href="/#pricing" className="hover:text-brand-600 transition-colors">Pricing</Link>
            <Link href="/contact" className="hover:text-brand-600 transition-colors">Contact</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-brand-600 hover:text-brand-800 transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="text-sm font-semibold bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-800 transition-colors shadow-sm"
            >
              Get started free
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Main Content Area ── */}
      <main className="flex-grow py-16 px-6">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="mb-12 text-center">
            <Mail className="w-16 h-16 text-brand-600 mx-auto mb-6 animate-pulse" />
            <h1 className="text-4xl md:text-5xl font-black text-brand-900 mb-4 tracking-tight">
              Contact Our Team
            </h1>
            <p className="text-brand-700 text-lg font-medium max-w-xl mx-auto">
              Have questions about {config.appName}? We are here to help {isHealthcare ? 'healthcare facilities and medical staff' : 'childcare centers and staff'}. Get in touch with us today.
            </p>
          </div>

          {/* Main Content Box */}
          <div className="bg-white rounded-[2rem] border-2 border-brand-100 shadow-xl shadow-brand-600/5 overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-12">
              
              {/* Sidebar Contact Info */}
              <div className="md:col-span-5 bg-brand-900 p-8 md:p-12 text-white flex flex-col justify-between relative overflow-hidden">
                <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-brand-600 rounded-full blur-3xl opacity-30 pointer-events-none" />
                
                <div>
                  <h3 className="text-2xl font-black mb-6 text-white tracking-tight">Contact Information</h3>
                  <p className="text-brand-300 mb-8 leading-relaxed">
                    Fill out the form and our support team will reach out to you as quickly as possible.
                  </p>
                  
                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <Mail className="w-6 h-6 text-brand-300 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-brand-300 font-bold uppercase tracking-wider">Email Us</p>
                        <a href={`mailto:${config.supportEmail}`} className="text-white font-semibold hover:text-brand-300 transition-colors">
                          {config.supportEmail}
                        </a>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <Phone className="w-6 h-6 text-brand-300 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-brand-300 font-bold uppercase tracking-wider">Call Us</p>
                        <span className="text-white font-semibold">
                          {isHealthcare ? '+1 (704) 555-0155' : '+1 (704) 555-0199'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <MapPin className="w-6 h-6 text-brand-300 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-brand-300 font-bold uppercase tracking-wider">Office</p>
                        <span className="text-white font-medium leading-relaxed block">
                          201 S Tryon St, Suite 1500<br />
                          Charlotte, NC 28202
                        </span>
                      </div>
                    </div>

                    <div className="flex items-start gap-4">
                      <Clock className="w-6 h-6 text-brand-300 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-brand-300 font-bold uppercase tracking-wider">Support Hours</p>
                        <span className="text-white font-medium leading-relaxed">
                          Monday – Friday<br />
                          7:00 AM – 7:00 PM EST
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-12 bg-white/5 border border-white/10 rounded-2xl p-5 relative z-10">
                  <div className="flex gap-3">
                    <HelpCircle className="w-5 h-5 text-brand-300 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-bold text-white mb-1">Looking for shifts?</h4>
                      <p className="text-xs text-brand-200 leading-relaxed">
                        {isHealthcare ? 'Healthcare staff' : 'Childcare staff'} accounts are completely free. Register to start claiming shifts instantly.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact Form or Success Screen */}
              <div className="md:col-span-7 p-8 md:p-12 flex flex-col justify-center bg-white">
                {!isSuccess ? (
                  <div>
                    <div className="flex items-center gap-3 mb-6">
                      <MessageSquare className="w-6 h-6 text-brand-600" />
                      <h2 className="text-2xl font-black text-brand-900">Send us a Message</h2>
                    </div>

                    {errors.form && (
                      <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl font-medium">
                        {errors.form}
                      </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                      {/* Name */}
                      <div>
                        <label htmlFor="name" className="block text-sm font-bold text-brand-905 mb-1.5">
                          Full Name
                        </label>
                        <input
                          type="text"
                          id="name"
                          name="name"
                          value={formData.name}
                          onChange={handleChange}
                          disabled={isSubmitting}
                          className={`w-full px-4 py-3 rounded-xl border bg-surface text-brand-900 font-medium transition-all outline-none ${
                            errors.name 
                              ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200' 
                              : 'border-brand-100 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/10'
                          }`}
                          placeholder={isHealthcare ? 'Jane Doe, RN' : 'Sarah Jenkins'}
                        />
                        {errors.name && <p className="mt-1 text-xs text-red-600 font-bold">{errors.name}</p>}
                      </div>

                      {/* Email */}
                      <div>
                        <label htmlFor="email" className="block text-sm font-bold text-brand-900 mb-1.5">
                          Email Address
                        </label>
                        <input
                          type="email"
                          id="email"
                          name="email"
                          value={formData.email}
                          onChange={handleChange}
                          disabled={isSubmitting}
                          className={`w-full px-4 py-3 rounded-xl border bg-surface text-brand-900 font-medium transition-all outline-none ${
                            errors.email 
                              ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200' 
                              : 'border-brand-100 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/10'
                          }`}
                          placeholder={isHealthcare ? 'admin@mercyhealth.com' : 'sarah@example.com'}
                        />
                        {errors.email && <p className="mt-1 text-xs text-red-600 font-bold">{errors.email}</p>}
                      </div>

                      {/* Contact Type Dropdown */}
                      <div>
                        <label htmlFor="contactType" className="block text-sm font-bold text-brand-900 mb-1.5">
                          Contact Type
                        </label>
                        <div className="relative">
                          <select
                            id="contactType"
                            name="contactType"
                            value={formData.contactType}
                            onChange={handleChange}
                            disabled={isSubmitting}
                            className={`w-full px-4 py-3 rounded-xl border bg-surface text-brand-900 font-medium transition-all outline-none appearance-none cursor-pointer ${
                              errors.contactType 
                                ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200' 
                                : 'border-brand-100 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/10'
                            }`}
                          >
                            <option value="" disabled>Select reasons for contact...</option>
                            {contactTypes.map(type => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-brand-600">
                            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                              <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                            </svg>
                          </div>
                        </div>
                        {errors.contactType && <p className="mt-1 text-xs text-red-600 font-bold">{errors.contactType}</p>}
                      </div>

                      {/* Subject */}
                      <div>
                        <label htmlFor="subject" className="block text-sm font-bold text-brand-900 mb-1.5">
                          Subject
                        </label>
                        <input
                          type="text"
                          id="subject"
                          name="subject"
                          value={formData.subject}
                          onChange={handleChange}
                          disabled={isSubmitting}
                          className={`w-full px-4 py-3 rounded-xl border bg-surface text-brand-900 font-medium transition-all outline-none ${
                            errors.subject 
                              ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200' 
                              : 'border-brand-100 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/10'
                          }`}
                          placeholder="How can we help you?"
                        />
                        {errors.subject && <p className="mt-1 text-xs text-red-600 font-bold">{errors.subject}</p>}
                      </div>

                      {/* Message */}
                      <div>
                        <label htmlFor="message" className="block text-sm font-bold text-brand-900 mb-1.5">
                          Message
                        </label>
                        <textarea
                          id="message"
                          name="message"
                          value={formData.message}
                          onChange={handleChange}
                          disabled={isSubmitting}
                          rows={4}
                          className={`w-full px-4 py-3 rounded-xl border bg-surface text-brand-900 font-medium transition-all outline-none resize-none ${
                            errors.message 
                              ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200' 
                              : 'border-brand-100 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/10'
                          }`}
                          placeholder="Write details about your request..."
                        />
                        {errors.message && <p className="mt-1 text-xs text-red-600 font-bold">{errors.message}</p>}
                      </div>

                      {/* Submit Button */}
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white font-bold py-3.5 px-6 rounded-xl hover:bg-brand-850 transition-all shadow-md active:translate-y-px disabled:opacity-70 disabled:cursor-not-allowed text-base cursor-pointer hover:bg-brand-800"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Sending Message...
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            Send Message
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="text-center py-8 px-4 flex flex-col items-center">
                    <div className="w-20 h-20 rounded-full bg-brand-50 flex items-center justify-center mb-6 animate-bounce">
                      <CheckCircle2 className="w-12 h-12 text-brand-600" />
                    </div>
                    <h2 className="text-3xl font-black text-brand-900 mb-3">Message Sent!</h2>
                    <p className="text-brand-700 text-base leading-relaxed max-w-md mb-8">
                      Thank you, <strong className="text-brand-900">{formData.name}</strong>. Your inquiry regarding <strong className="text-brand-900">{formData.contactType}</strong> has been successfully received. We will respond to your email at <strong className="text-brand-900">{formData.email}</strong> shortly.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
                      <button
                        onClick={handleReset}
                        className="px-6 py-3 border border-brand-200 text-brand-600 bg-brand-50 hover:bg-brand-100 transition-colors rounded-xl font-bold text-sm cursor-pointer"
                      >
                        Send Another Message
                      </button>
                      <Link
                        href="/"
                        className="px-6 py-3 bg-brand-600 hover:bg-brand-800 text-white transition-colors rounded-xl font-bold text-sm text-center"
                      >
                        Back to Home
                      </Link>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="py-12 px-6 bg-brand-900">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-brand-300">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">{config.logoShort}</span>
            </div>
            <span className="font-semibold text-white">{config.appName}</span>
          </div>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link href="/contact" className="hover:text-white transition-colors">Contact</Link>
          </div>
          <span>© {new Date().getFullYear()} {config.appName}. All rights reserved.</span>
        </div>
      </footer>

    </div>
  )
}
