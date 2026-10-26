import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * GroupMe (https://dev.groupme.com/docs/v3). A center connects one group; a bot in it posts new shifts.
 * Creating the bot needs the director's GroupMe access token (from OAuth), which is used once and never stored.
 * Posting only needs the bot_id, which is kept server-side in center_groupme.
 */

const API = 'https://api.groupme.com/v3'
const TIMEOUT_MS = 8000
/** GroupMe's message limit */
const MAX_TEXT = 1000

export const GROUPME_TOKEN_COOKIE = 'groupme_token'
export const GROUPME_STATE_COOKIE = 'groupme_state'

export class GroupMeError extends Error {}

type Envelope<T> = { response?: T; meta?: { code?: number; errors?: string[] } }

async function call<T>(path: string, init: { method?: 'GET' | 'POST'; token?: string; body?: unknown } = {}): Promise<T | null> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { 'X-Access-Token': init.token } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    throw new GroupMeError('Could not reach GroupMe. Please try again.')
  }
  if (res.status === 401) throw new GroupMeError('GroupMe sign-in has expired. Please connect again.')
  if (!res.ok) {
    const json = await res.json().catch(() => null) as Envelope<unknown> | null
    const detail = json?.meta?.errors?.join(', ')
    throw new GroupMeError(`GroupMe returned an error (${res.status})${detail ? `: ${detail}` : ''}.`)
  }
  // POST /bots/post answers 201/202 with an empty body
  const text = await res.text()
  if (!text) return null
  try { return (JSON.parse(text) as Envelope<T>).response ?? null } catch { return null }
}

export interface GroupMeGroup { id: string; name: string; members: number }

/** Groups the signed-in GroupMe user belongs to, most recently active first */
export async function listGroups(token: string): Promise<GroupMeGroup[]> {
  const groups = await call<{ id: string; name: string; members?: unknown[] }[]>('/groups?per_page=100&omit=memberships', { token })
  return (groups ?? []).map(g => ({ id: String(g.id), name: g.name, members: Array.isArray(g.members) ? g.members.length : 0 }))
}

export async function createGroup(token: string, name: string): Promise<GroupMeGroup> {
  const group = await call<{ id: string; name: string }>('/groups', { method: 'POST', token, body: { name: name.slice(0, 140), share: true } })
  if (!group?.id) throw new GroupMeError('GroupMe did not create the group.')
  return { id: String(group.id), name: group.name, members: 1 }
}

export async function createBot(token: string, groupId: string, name: string, avatarUrl?: string): Promise<string> {
  const created = await call<{ bot?: { bot_id?: string }; bot_id?: string }>('/bots', {
    method: 'POST',
    token,
    body: { bot: { name, group_id: groupId, active: true, ...(avatarUrl ? { avatar_url: avatarUrl } : {}) } },
  })
  const botId = created?.bot?.bot_id ?? created?.bot_id
  if (!botId) throw new GroupMeError('GroupMe did not create the bot.')
  return botId
}

/** Best effort: removes a bot the token's user created (used when replacing or disconnecting) */
export async function destroyBot(token: string, botId: string) {
  try { await call('/bots/destroy', { method: 'POST', token, body: { bot_id: botId } }) } catch { /* already gone */ }
}

export async function postAsBot(botId: string, text: string) {
  await call('/bots/post', { method: 'POST', body: { bot_id: botId, text: text.slice(0, MAX_TEXT) } })
}

export const isBotId = (value: string) => /^[A-Za-z0-9]{10,64}$/.test(value)

/** "Sunshine Academy_Notification" (GroupMe shows it as the sender) */
export const botNameFor = (centerName: string) => `${centerName.trim().slice(0, 100)}_Notification`

/** The server settings GroupMe needs (the bot table is readable only with the service role) */
export const groupMeServerReady = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

export function serviceDb() {
  if (!groupMeServerReady()) throw new GroupMeError('GroupMe is not set up on this server: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are missing.')
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h)) return hhmm
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** The message for a newly posted shift. No staff names or notes: the group is outside CareLocal. */
export function shiftPostedText(s: { centerName: string; shiftDate: string; startTime: string; endTime: string; role: string | null; url: string }) {
  const day = new Date(`${s.shiftDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const role = s.role && s.role !== 'any' ? ` · ${s.role.replace(/_/g, ' ')}` : ''
  return `🟢 New shift at ${s.centerName}\n${day} · ${fmtTime(s.startTime)} – ${fmtTime(s.endTime)}${role}\nClaim it: ${s.url}`
}

/**
 * Posts to the center's GroupMe group if one is connected and switched on. Never throws: a GroupMe failure must
 * not stop push, email or in-app alerts. The outcome is recorded on the row so the About page can show it.
 */
export async function notifyCenterGroupMe(centerId: string, text: string): Promise<'sent' | 'skipped' | 'failed'> {
  if (!groupMeServerReady()) return 'skipped'
  const db = serviceDb()
  const { data: row } = await db.from('center_groupme').select('bot_id, enabled').eq('center_id', centerId).maybeSingle()
  if (!row?.enabled) return 'skipped'
  try {
    await postAsBot(row.bot_id, text)
    await db.from('center_groupme').update({ last_posted_at: new Date().toISOString(), last_error: null, last_error_at: null }).eq('center_id', centerId)
    return 'sent'
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GroupMe post failed'
    console.error('[groupme] post failed for center', centerId, message)
    await db.from('center_groupme').update({ last_error: message.slice(0, 500), last_error_at: new Date().toISOString() }).eq('center_id', centerId)
    return 'failed'
  }
}
