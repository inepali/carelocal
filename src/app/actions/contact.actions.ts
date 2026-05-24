'use server'

import { Resend } from 'resend'

export async function submitContactForm(data: {
  name: string
  email: string
  contactType: string
  subject: string
  message: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { error: 'Resend API key is not configured.' }
  }

  const resend = new Resend(apiKey)

  try {
    const { error } = await resend.emails.send({
      // Sandbox domains require sending from onboarding@resend.dev
      from: 'CareLocal Contact <onboarding@resend.dev>',
      to: 'sanjayaghimire@gmail.com',
      replyTo: data.email,
      subject: `[${data.contactType}] ${data.subject}`,
      html: `
        <div style="font-family: sans-serif; max-w: 600px; margin: 0 auto; border: 1px solid #e2e8e4; border-radius: 12px; padding: 24px; background-color: #f8faf9;">
          <h2 style="color: #0b3828; margin-top: 0; border-bottom: 2px solid #157354; padding-bottom: 12px;">New Contact Submission</h2>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
            <tr>
              <td style="padding: 8px 0; font-weight: bold; color: #0b3828; width: 120px;">Name:</td>
              <td style="padding: 8px 0; color: #3d5a4f;">${data.name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold; color: #0b3828;">Email:</td>
              <td style="padding: 8px 0; color: #3d5a4f;"><a href="mailto:${data.email}" style="color: #157354; text-decoration: none;">${data.email}</a></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold; color: #0b3828;">Contact Type:</td>
              <td style="padding: 8px 0; color: #3d5a4f;">${data.contactType}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold; color: #0b3828;">Subject:</td>
              <td style="padding: 8px 0; color: #3d5a4f;">${data.subject}</td>
            </tr>
          </table>
          
          <div style="margin-top: 24px; padding: 16px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e6ece9;">
            <h3 style="margin-top: 0; color: #0b3828; font-size: 14px;">Message:</h3>
            <p style="color: #3d5a4f; white-space: pre-wrap; line-height: 1.6; margin-bottom: 0;">${data.message}</p>
          </div>
          
          <div style="margin-top: 24px; text-align: center; font-size: 12px; color: #6b7a73; border-top: 1px solid #e2e8e4; padding-top: 16px;">
            Sent from the CareLocal Contact Form
          </div>
        </div>
      `
    })

    if (error) {
      console.error('Resend API Error:', error)
      return { error: error.message }
    }

    return { success: true }
  } catch (err: any) {
    console.error('Submit Contact Form Error:', err)
    return { error: err.message || 'An unexpected error occurred.' }
  }
}
