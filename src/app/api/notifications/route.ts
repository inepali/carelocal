import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { Resend } from 'resend'
import twilio from 'twilio'
import webpush from 'web-push'
import { notifyCenterGroupMe, shiftPostedText } from '@/lib/server/groupme'
import { JWT } from 'google-auth-library'

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

// Initialize Google JWT client for FCM v1 API
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT
let jwtClient: JWT | null = null
let fcmProjectId = ''

if (serviceAccountJson) {
  try {
    const creds = JSON.parse(serviceAccountJson)
    fcmProjectId = creds.project_id
    jwtClient = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    })
  } catch (err) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT:', err)
  }
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export async function POST(req: Request) {
  try {
    const { shiftId, action } = await req.json()

    if (action === 'shift_posted') {
      // Only an admin of the shift's own center may alert staff. The shift details come from the
      // database, never from the request, so callers cannot choose the audience or the message.
      const session = await createSessionClient()
      const { data: { user } } = await session.auth.getUser()
      if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

      const { data: shift } = typeof shiftId === 'string'
        ? await supabase
            .from('shifts')
            .select('center_id, shift_date, start_time, end_time, staff_type_needed, hourly_rate')
            .eq('id', shiftId)
            .maybeSingle()
        : { data: null }
      if (!shift) return NextResponse.json({ success: false, error: 'Shift not found' }, { status: 404 })

      const { data: adminRow } = await supabase
        .from('center_admins')
        .select('user_id')
        .eq('center_id', shift.center_id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!adminRow) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })

      const centerId = shift.center_id as string
      const staffTypeNeeded = shift.staff_type_needed as string | null
      const shiftDate = shift.shift_date as string
      const startTime = shift.start_time as string
      const endTime = shift.end_time as string

      // 1. Fetch the center name and domain key
      const { data: center } = await supabase
        .from('centers')
        .select('name, domain_key')
        .eq('id', centerId)
        .single()
      
      const centerName = center?.name || 'A CareLocal Center'

      const domainKey = center?.domain_key || 'childcare'
      const senderName = domainKey === 'healthcare' ? 'CareLocal Health' : domainKey === 'senior' ? 'CareLocal Senior' : 'CareLocal'
      const senderEmail = domainKey === 'healthcare' ? 'updates@carelocal.net' : domainKey === 'senior' ? 'updates@carelocalsenior.com' : 'updates@carelocal.co'
      let appUrl = domainKey === 'healthcare' ? 'https://carelocal.net' : domainKey === 'senior' ? 'https://carelocalsenior.com' : 'https://carelocal.co'
      if (process.env.NEXT_PUBLIC_APP_URL && process.env.NEXT_PUBLIC_APP_URL.includes('localhost')) {
        appUrl = domainKey === 'healthcare' ? 'http://localhost:3001' : domainKey === 'senior' ? 'http://localhost:3002' : 'http://localhost:3000'
      }

      // GroupMe: one post to the center's group, if connected. Before the staff lookup, because the group can
      // include people who have no CareLocal profile yet. Never throws.
      // The post names the site to visit rather than a link, so it reads the same in dev and production
      const siteName = domainKey === 'healthcare' ? 'carelocal.net' : domainKey === 'senior' ? 'carelocalsenior.com' : 'carelocal.co'
      await notifyCenterGroupMe(centerId, shiftPostedText({
        centerName, shiftDate, startTime, endTime, role: staffTypeNeeded, hourlyRate: shift.hourly_rate as number | null, site: siteName,
      }))

      // 2. Fetch all active substitute staff connected to this center
      //    (regular employees are out of scope for shift notifications)
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
        .eq('employment_class', 'substitute')

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

              const pushOptions = {
                headers: {
                  'Urgency': 'high'
                },
                TTL: 24 * 60 * 60 // 24 hours
              }

              for (const sub of subs) {
                const pushSubscription = {
                  endpoint: sub.endpoint,
                  keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth
                  }
                }
                try {
                  await webpush.sendNotification(pushSubscription, payload, pushOptions)
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

          // Send real-time Native Push notification to Capacitor devices via FCM HTTP v1
          try {
            const { data: nativeTokens } = await supabase
              .from('native_push_tokens')
              .select('*')
              .eq('user_id', profile.user_id)

            if (nativeTokens && nativeTokens.length > 0 && jwtClient && fcmProjectId) {
              const authRes = await jwtClient.getAccessToken()
              const accessToken = authRes.token

              if (accessToken) {
                for (const nativeToken of nativeTokens) {
                  try {
                    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${fcmProjectId}/messages:send`
                    const payload = {
                      message: {
                        token: nativeToken.token,
                        notification: {
                          title: notificationTitle,
                          body: notificationMessage,
                        },
                        data: {
                          url: '/mobile/shifts'
                        },
                        android: {
                          notification: {
                            sound: 'default',
                            click_action: 'FCM_PLUGIN_ACTIVITY'
                          }
                        },
                        apns: {
                          payload: {
                            aps: {
                              sound: 'default',
                              badge: 1,
                              alert: {
                                title: notificationTitle,
                                body: notificationMessage
                              }
                            }
                          }
                        }
                      }
                    }

                    const response = await fetch(fcmUrl, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(payload),
                    })

                    const resJson = await response.json()
                    if (!response.ok) {
                      console.error(`FCM send failed for token ${nativeToken.token}:`, resJson)
                      // Clean up expired/invalid token
                      if (resJson.error?.status === 'UNREGISTERED' || resJson.error?.message?.includes('not registered') || response.status === 404 || response.status === 410) {
                        await supabase
                          .from('native_push_tokens')
                          .delete()
                          .eq('token', nativeToken.token)
                        console.log(`Deleted unregistered/invalid native push token: ${nativeToken.token}`)
                      }
                    } else {
                      console.log(`FCM send successful to token ${nativeToken.token}`)
                    }
                  } catch (fcmSendErr) {
                    console.error(`FCM HTTP request failed for token ${nativeToken.token}:`, fcmSendErr)
                  }
                }
              }
            } else if (nativeTokens && nativeTokens.length > 0 && !jwtClient) {
              console.warn('Native tokens found, but FIREBASE_SERVICE_ACCOUNT is not configured.')
            }
          } catch (nativePushErr) {
            console.error(`Native push notification querying/sending failed for staff ${profile.user_id}:`, nativePushErr)
          }
        }

        // B. Email Notification
        if (prefs.email_enabled !== false && profile.email && resend) {
          try {
            await resend.emails.send({
              from: `${senderName} <${senderEmail}>`,
              to: profile.email,
              subject: notificationTitle,
              html: `
                <div style="font-family: sans-serif; max-w: 600px; margin: 0 auto;">
                  <h2>${escapeHtml(notificationTitle)}</h2>
                  <p>${escapeHtml(notificationMessage)}</p>
                  <a href="${appUrl}/staff/shifts" style="display: inline-block; padding: 12px 24px; background-color: #157354; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 16px;">View Shift</a>
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
              body: `${senderName}: ${notificationTitle}. ${notificationMessage} View it here: ${appUrl}/staff/shifts`,
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
