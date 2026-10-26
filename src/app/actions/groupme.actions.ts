'use server'

import { cookies } from 'next/headers'
import { randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import {
  GROUPME_STATE_COOKIE, GROUPME_TOKEN_COOKIE, GroupMeError,
  botNameFor, createBot, createGroup, destroyBot, groupMeServerReady, isBotId, listGroups, postAsBot, serviceDb, sharedToken,
  type GroupMeGroup,
} from '@/lib/server/groupme'

type Result<T = object> = ({ success: true } & T) | { success: false; error: string }

export interface GroupMeStatus {
  connected: boolean
  groupName: string | null
  botName: string | null
  enabled: boolean
  lastPostedAt: string | null
  lastError: string | null
  /** "Connect with GroupMe" is set up on this server (GROUPME_CLIENT_ID) */
  oauthAvailable: boolean
  /** CareLocal can create the group and bot itself, under its own GroupMe account (GROUPME_ACCESS_TOKEN) */
  sharedAvailable: boolean
  /** Invite link for staff to join the group, when CareLocal created it */
  shareUrl: string | null
  /** The director has just signed in to GroupMe and should pick a group */
  choosingGroup: boolean
  /** The bot name this center gets */
  suggestedBotName: string
}

/** The caller must be an owner or admin of a center; returns that center */
async function requireCenterAdmin(): Promise<{ userId: string; centerId: string; centerName: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('center_admins')
    .select('center_id, role, centers(name)')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin'])
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const center = data.centers as { name?: string } | { name?: string }[] | null
  const centerName = (Array.isArray(center) ? center[0]?.name : center?.name) || 'CareLocal Center'
  return { userId: user.id, centerId: data.center_id as string, centerName }
}

const NOT_ALLOWED = { success: false as const, error: 'Only the owner or an administrator can manage GroupMe.' }
const friendly = (err: unknown) => (err instanceof GroupMeError ? err.message : 'Something went wrong with GroupMe. Please try again.')

async function readToken() {
  return (await cookies()).get(GROUPME_TOKEN_COOKIE)?.value ?? null
}

async function clearConnectCookies() {
  const jar = await cookies()
  jar.delete(GROUPME_TOKEN_COOKIE)
  jar.delete(GROUPME_STATE_COOKIE)
}

export async function getGroupMeStatus(): Promise<Result<{ status: GroupMeStatus }> | { success: false; error: string; setup: true }> {
  const me = await requireCenterAdmin()
  if (!me) return NOT_ALLOWED
  if (!groupMeServerReady()) {
    return { success: false, setup: true, error: 'GroupMe is not set up on this server yet (missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).' }
  }
  const { data: row } = await serviceDb()
    .from('center_groupme')
    .select('group_name, bot_name, enabled, last_posted_at, last_error, share_url')
    .eq('center_id', me.centerId)
    .maybeSingle()
  return {
    success: true,
    status: {
      connected: !!row,
      groupName: row?.group_name ?? null,
      botName: row?.bot_name ?? null,
      enabled: row?.enabled ?? false,
      lastPostedAt: row?.last_posted_at ?? null,
      lastError: row?.last_error ?? null,
      oauthAvailable: !!process.env.GROUPME_CLIENT_ID,
      sharedAvailable: !!sharedToken(),
      shareUrl: row?.share_url ?? null,
      choosingGroup: !!(await readToken()),
      suggestedBotName: botNameFor(me.centerName),
    },
  }
}

/**
 * Step 1: sends the director to GroupMe to sign in. GroupMe's sign-in returns no state parameter, so a short-lived
 * cookie proves the round trip started here (the callback refuses a token without it).
 */
export async function startGroupMeConnect(): Promise<Result<{ url: string }>> {
  const me = await requireCenterAdmin()
  if (!me) return NOT_ALLOWED
  const clientId = process.env.GROUPME_CLIENT_ID
  if (!clientId) return { success: false, error: 'GroupMe sign-in is not set up on this server yet. Paste a Bot ID instead.' }
  ;(await cookies()).set(GROUPME_STATE_COOKIE, randomBytes(16).toString('hex'), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600,
  })
  return { success: true, url: `https://oauth.groupme.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}` }
}

/** Step 2: the director's GroupMe groups, to pick the one their staff are in */
export async function listGroupMeGroups(): Promise<Result<{ groups: GroupMeGroup[] }>> {
  const me = await requireCenterAdmin()
  if (!me) return NOT_ALLOWED
  const token = await readToken()
  if (!token) return { success: false, error: 'GroupMe sign-in has expired. Please connect again.' }
  try {
    return { success: true, groups: await listGroups(token) }
  } catch (err) {
    await clearConnectCookies()
    return { success: false, error: friendly(err) }
  }
}

/**
 * Step 3: creates "<Center Name>_Notification" in the chosen group (or in a new group), saves the bot and posts a
 * welcome message. The GroupMe token is discarded afterwards.
 */
export async function connectGroupMeGroup(input: { groupId: string } | { newGroupName: string }): Promise<Result<{ status: GroupMeStatus }>> {
  const me = await requireCenterAdmin()
  if (!me) return NOT_ALLOWED
  const token = await readToken()
  if (!token) return { success: false, error: 'GroupMe sign-in has expired. Please connect again.' }

  try {
    let group: GroupMeGroup | undefined
    if ('newGroupName' in input) {
      const name = input.newGroupName.trim()
      if (!name) return { success: false, error: 'Enter a name for the new group.' }
      group = await createGroup(token, name)
    } else {
      group = (await listGroups(token)).find(g => g.id === input.groupId)
      if (!group) return { success: false, error: 'That group was not found in your GroupMe account.' }
    }

    const db = serviceDb()
    const { data: previous } = await db.from('center_groupme').select('bot_id').eq('center_id', me.centerId).maybeSingle()
    const botName = botNameFor(me.centerName)
    const botId = await createBot(token, group.id, botName)

    const { error } = await db.from('center_groupme').upsert({
      center_id: me.centerId, bot_id: botId, bot_name: botName, group_id: group.id, group_name: group.name,
      share_url: group.shareUrl ?? null, carelocal_owned: false,
      enabled: true, connected_by: me.userId, connected_at: new Date().toISOString(), last_error: null, last_error_at: null,
    })
    if (error) {
      await destroyBot(token, botId)
      return { success: false, error: 'Could not save the GroupMe connection.' }
    }
    // Replacing an earlier connection: remove its bot if this GroupMe user created it
    if (previous?.bot_id && previous.bot_id !== botId) await destroyBot(token, previous.bot_id)

    await postAsBot(botId, `✅ CareLocal is connected. New shifts at ${me.centerName} will be posted here.`).catch(() => {})
  } catch (err) {
    return { success: false, error: friendly(err) }
  } finally {
    await clearConnectCookies()
  }
  return statusAfter()
}

/**
 * One click, no GroupMe account needed: CareLocal creates "<Center Name>" as a new group and
 * "<Center Name>_Notification" as its bot, under CareLocal's own GroupMe account. The center then shares the
 * invite link with its staff. Refuses when the center is already connected (disconnect first).
 */
export async function createCenterGroupMe(): Promise<Result<{ status: GroupMeStatus }>> {
  const me = await requireCenterAdmin()
  if (!me) return NOT_ALLOWED
  const token = sharedToken()
  if (!token) return { success: false, error: 'Creating a group for you is not set up on this server yet.' }

  try {
    const db = serviceDb()
    const { data: existing } = await db.from('center_groupme').select('center_id').eq('center_id', me.centerId).maybeSingle()
    if (existing) return { success: false, error: 'GroupMe is already connected. Disconnect it first to create a new group.' }

    const group = await createGroup(token, me.centerName)
    const botName = botNameFor(me.centerName)
    const botId = await createBot(token, group.id, botName)

    const { error } = await db.from('center_groupme').insert({
      center_id: me.centerId, bot_id: botId, bot_name: botName, group_id: group.id, group_name: group.name,
      share_url: group.shareUrl ?? null, carelocal_owned: true,
      enabled: true, connected_by: me.userId,
    })
    if (error) {
      // Two clicks at once, or a failed save: leave no stray bot behind
      await destroyBot(token, botId)
      return { success: false, error: 'Could not save the GroupMe connection.' }
    }
    await postAsBot(botId, `✅ CareLocal is connected. New shifts at ${me.centerName} will be posted here.`).catch(() => {})
  } catch (err) {
    return { success: false, error: friendly(err) }
  }
  return statusAfter()
}

/** Without GroupMe sign-in: the director made the bot on dev.groupme.com and pastes its Bot ID */
export async function connectGroupMeBotId(rawBotId: string): Promise<Result<{ status: GroupMeStatus }>> {
  const me = await requireCenterAdmin()
  if (!me) return NOT_ALLOWED
  const botId = rawBotId.trim()
  if (!isBotId(botId)) return { success: false, error: 'That does not look like a GroupMe Bot ID (letters and numbers only).' }
  try {
    // Posting proves the ID works before it is saved
    await postAsBot(botId, `✅ CareLocal is connected. New shifts at ${me.centerName} will be posted here.`)
  } catch {
    return { success: false, error: 'GroupMe did not accept that Bot ID. Check it on dev.groupme.com → Bots.' }
  }
  const { error } = await serviceDb().from('center_groupme').upsert({
    center_id: me.centerId, bot_id: botId, bot_name: null, group_id: null, group_name: null,
    share_url: null, carelocal_owned: false,
    enabled: true, connected_by: me.userId, connected_at: new Date().toISOString(), last_error: null, last_error_at: null,
  })
  if (error) return { success: false, error: 'Could not save the GroupMe connection.' }
  return statusAfter()
}

export async function cancelGroupMeConnect(): Promise<Result> {
  if (!await requireCenterAdmin()) return NOT_ALLOWED
  await clearConnectCookies()
  return { success: true }
}

export async function sendGroupMeTest(): Promise<Result> {
  const me = await requireCenterAdmin()
  if (!me) return NOT_ALLOWED
  const db = serviceDb()
  const { data: row } = await db.from('center_groupme').select('bot_id').eq('center_id', me.centerId).maybeSingle()
  if (!row) return { success: false, error: 'GroupMe is not connected.' }
  try {
    await postAsBot(row.bot_id, `👋 Test message from CareLocal for ${me.centerName}. Shift alerts will appear here.`)
    await db.from('center_groupme').update({ last_posted_at: new Date().toISOString(), last_error: null, last_error_at: null }).eq('center_id', me.centerId)
    return { success: true }
  } catch (err) {
    const message = friendly(err)
    await db.from('center_groupme').update({ last_error: message.slice(0, 500), last_error_at: new Date().toISOString() }).eq('center_id', me.centerId)
    return { success: false, error: message }
  }
}

export async function setGroupMeEnabled(enabled: boolean): Promise<Result<{ status: GroupMeStatus }>> {
  const me = await requireCenterAdmin()
  if (!me) return NOT_ALLOWED
  const { error } = await serviceDb().from('center_groupme').update({ enabled }).eq('center_id', me.centerId)
  if (error) return { success: false, error: 'Could not update GroupMe.' }
  return statusAfter()
}

/**
 * Forgets the bot. A bot CareLocal created is removed from GroupMe too; any other bot stays in the group until
 * someone removes it there (GroupMe needs its creator to delete it). The group itself is never deleted.
 */
export async function disconnectGroupMe(): Promise<Result<{ status: GroupMeStatus }>> {
  const me = await requireCenterAdmin()
  if (!me) return NOT_ALLOWED
  const db = serviceDb()
  const { data: row } = await db.from('center_groupme').select('bot_id, carelocal_owned').eq('center_id', me.centerId).maybeSingle()
  const token = sharedToken()
  if (row?.carelocal_owned && token) await destroyBot(token, row.bot_id)
  const { error } = await db.from('center_groupme').delete().eq('center_id', me.centerId)
  if (error) return { success: false, error: 'Could not disconnect GroupMe.' }
  return statusAfter()
}

async function statusAfter(): Promise<Result<{ status: GroupMeStatus }>> {
  const res = await getGroupMeStatus()
  return res.success ? { success: true, status: res.status } : res
}
