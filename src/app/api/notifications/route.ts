import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import twilio from 'twilio'
import webpush from 'web-push'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:support@carelocal.co',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceRole)

interface StaffProfileRow {
  user_id: string
  email: string
  phone: string | null
  staff_type: string | string[] | null
}

interface CenterStaffRow {
  staff_id: string
  staff_profiles: StaffProfileRow | null
}

// Initialize optional providers
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const twilioClient = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null

export async function POST(req: Request) {
  try {
    const { centerId, shiftId, staffTypeNeeded, action, shiftDate, startTime, endTime } = await req.json()

    if (action === 'shift_posted') {
      // 1. Fetch the center name
      const { data: center } = await supabase
        .from('centers')
        .select('name')
        .eq('id', centerId)
        .single()
      
      const centerName = center?.name || 'A CareLocal Center'

      // 2. Fetch all active staff connected to this center
      const { data: centerStaff } = await supabase
        .from('center_staff')
        .select(`
          staff_id,
          staff_profiles (
            user_id,
            email,
            phone,
            staff_type
          )
        `)
        .eq('center_id', centerId)
        .eq('status', 'active')

      if (!centerStaff || centerStaff.length === 0) {
        return NextResponse.json({ success: true, message: 'No active staff to notify.' })
      }

      let eligibleStaff = centerStaff as unknown as CenterStaffRow[]
      if (staffTypeNeeded && staffTypeNeeded !== 'any') {
        eligibleStaff = (centerStaff as unknown as CenterStaffRow[]).filter((s) => {
          const profile = s.staff_profiles
          if (!profile || !profile.staff_type) return false
          // Check if profile.staff_type includes the needed role
          return profile.staff_type.includes(staffTypeNeeded) || profile.staff_type === staffTypeNeeded
        })
      }

      if (eligibleStaff.length === 0) {
        return NextResponse.json({ success: true, message: 'No eligible staff with the required role.' })
      }

      // 3. Fetch notification preferences for eligible staff (using user_id from profiles)
      const userIds = eligibleStaff
        .map(s => s.staff_profiles?.user_id)
        .filter((id): id is string => !!id)

      const { data: preferences } = await supabase
        .from('notification_preferences')
        .select('*')
        .in('user_id', userIds)
      
      const prefMap = new Map(preferences?.map(p => [p.user_id, p]))

      const notificationTitle = `New Shift Available at ${centerName}`
      const notificationMessage = `A new shift is available on ${new Date(shiftDate).toLocaleDateString()} from ${startTime.substring(0,5)} to ${endTime.substring(0,5)}.`

      for (const staff of eligibleStaff) {
        const profile = staff.staff_profiles
        if (!profile || !profile.user_id) continue

        const prefs = prefMap.get(profile.user_id) || {
          app_enabled: true,
          email_enabled: true,
          sms_enabled: false
        } // default fallback

        // A. App Notification
        if (prefs.app_enabled !== false) {
          const { error: appNotifError } = await supabase.from('app_notifications').insert({
            user_id: profile.user_id,
            title: notificationTitle,
            message: notificationMessage,
            type: 'shift_posted',
            reference_id: shiftId
          })
          if (appNotifError) {
            console.error(`Failed to insert app notification for user ${profile.user_id}:`, appNotifError)
          }

          // Send real-time Web Push notification to PWA devices
          try {
            const { data: subs } = await supabase
              .from('push_subscriptions')
              .select('*')
              .eq('user_id', profile.user_id)
            
            if (subs && subs.length > 0) {
              const payload = JSON.stringify({
                title: notificationTitle,
                body: notificationMessage,
                url: `/mobile/shifts`
              })

              for (const sub of subs) {
                const pushSubscription = {
                  endpoint: sub.endpoint,
                  keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth
                  }
                }
                try {
                  await webpush.sendNotification(pushSubscription, payload)
                } catch (pushSendErr: any) {
                  console.error(`Web Push notification send failed for user ${profile.user_id} endpoint ${sub.endpoint}:`, pushSendErr)
                  if (pushSendErr.statusCode === 410 || pushSendErr.statusCode === 404) {
                    // Clean up/delete expired subscription from DB
                    await supabase
                      .from('push_subscriptions')
                      .delete()
                      .eq('endpoint', sub.endpoint)
                    console.log(`Deleted expired push subscription for endpoint: ${sub.endpoint}`)
                  }
                }
              }
              console.log(`Web Push successfully processed for ${subs.length} devices of staff ${profile.user_id}`)
            }
          } catch (pushErr) {
            console.error(`Web Push notification querying/sending failed for staff ${profile.user_id}:`, pushErr)
          }
        }

        // B. Email Notification
        if (prefs.email_enabled !== false && profile.email && resend) {
          try {
            await resend.emails.send({
              from: 'CareLocal <updates@carelocal.co>', // Replace with verified domain
              to: profile.email,
              subject: notificationTitle,
              html: `
                <div style="font-family: sans-serif; max-w: 600px; margin: 0 auto;">
                  <h2>${notificationTitle}</h2>
                  <p>${notificationMessage}</p>
                  <a href="${process.env.NEXT_PUBLIC_APP_URL}/staff/shifts" style="display: inline-block; padding: 12px 24px; background-color: #157354; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 16px;">View Shift</a>
                </div>
              `
            })
          } catch (e) {
            console.error(`Email failed for ${profile.email}`, e)
          }
        }

        // C. SMS Notification
        if (prefs.sms_enabled === true && profile.phone && twilioClient) {
          try {
            await twilioClient.messages.create({
              body: `CareLocal: ${notificationTitle}. ${notificationMessage} View it here: ${process.env.NEXT_PUBLIC_APP_URL}/staff/shifts`,
              from: process.env.TWILIO_PHONE_NUMBER,
              to: profile.phone
            })
          } catch (e) {
            console.error(`SMS failed for ${profile.phone}`, e)
          }
        }
      }

      return NextResponse.json({ success: true, notifiedCount: eligibleStaff.length })
    }

    return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 })
  } catch (error: unknown) {
    console.error('Notification Error:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
