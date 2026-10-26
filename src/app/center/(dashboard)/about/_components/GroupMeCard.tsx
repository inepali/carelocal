'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, MessageSquare, Plus, Send, Unplug } from 'lucide-react'
import {
  cancelGroupMeConnect, connectGroupMeBotId, connectGroupMeGroup, disconnectGroupMe, getGroupMeStatus,
  listGroupMeGroups, sendGroupMeTest, setGroupMeEnabled, startGroupMeConnect, type GroupMeStatus,
} from '@/app/actions/groupme.actions'
import { showAlert, showConfirm } from '@/lib/dialog'

type Group = { id: string; name: string; members: number }

const formatWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const BTN = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50'
const FIELD = 'w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-text-main focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30'

/**
 * Center Profile → GroupMe. Connecting creates a bot named "<Center Name>_Notification" in the center's staff
 * group; every new shift is then posted there, alongside push and email alerts.
 */
export default function GroupMeCard() {
  const [status, setStatus] = useState<GroupMeStatus | null>(null)
  const [hidden, setHidden] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [choice, setChoice] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [manual, setManual] = useState(false)
  const [botId, setBotId] = useState('')

  const loadGroups = useCallback(async () => {
    const res = await listGroupMeGroups()
    if (!res.success) { showAlert(res.error); setGroups(null); return }
    setGroups(res.groups)
    setChoice(res.groups[0]?.id ?? 'new')
  }, [])

  const load = useCallback(async () => {
    const res = await getGroupMeStatus()
    if (!res.success) {
      if ('setup' in res) setSetupError(res.error)
      else setHidden(true)   // staff without admin rights don't see the card
      return
    }
    setStatus(res.status)
    if (res.status.choosingGroup) loadGroups()
  }, [loadGroups])

  useEffect(() => {
    // Back from GroupMe sign-in: drop ?groupme=... from the address, keep #profile
    const params = new URLSearchParams(window.location.search)
    if (params.get('groupme') === 'failed') showAlert('GroupMe sign-in did not finish. Please try connecting again.')
    if (params.has('groupme')) window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function run<T extends { success: boolean }>(fn: () => Promise<T>): Promise<T> {
    setBusy(true)
    try { return await fn() } finally { setBusy(false) }
  }

  async function connect() {
    const res = await run(startGroupMeConnect)
    if (!res.success) { showAlert(res.error); return }
    window.location.href = res.url
  }

  async function createBot() {
    const input = choice === 'new' ? { newGroupName } : { groupId: choice }
    const res = await run(() => connectGroupMeGroup(input))
    if (!res.success) { showAlert(res.error); load(); return }
    setStatus(res.status); setGroups(null); setNewGroupName('')
  }

  async function cancelChoosing() {
    await run(cancelGroupMeConnect)
    setGroups(null)
    load()
  }

  async function saveBotId() {
    const res = await run(() => connectGroupMeBotId(botId))
    if (!res.success) { showAlert(res.error); return }
    setStatus(res.status); setManual(false); setBotId('')
  }

  async function test() {
    const res = await run(sendGroupMeTest)
    showAlert(res.success ? 'Test message sent. Check your GroupMe group.' : res.error)
    load()
  }

  async function toggle() {
    if (!status) return
    const res = await run(() => setGroupMeEnabled(!status.enabled))
    if (!res.success) { showAlert(res.error); return }
    setStatus(res.status)
  }

  async function disconnect() {
    const ok = await showConfirm(
      'Stop posting shifts to GroupMe? The bot stays in your GroupMe group until you remove it there (group settings, or dev.groupme.com → Bots).',
      { title: 'Disconnect GroupMe', tone: 'danger', confirmLabel: 'Disconnect' },
    )
    if (!ok) return
    const res = await run(disconnectGroupMe)
    if (!res.success) { showAlert(res.error); return }
    setStatus(res.status)
  }

  if (hidden) return null

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-border bg-surface/50 p-5">
        <MessageSquare className="h-5 w-5 text-brand-600" />
        <h2 className="text-base font-semibold text-text-main">GroupMe shift alerts</h2>
        {status?.connected && (
          <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${status.enabled ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-500'}`}>
            {status.enabled ? 'On' : 'Paused'}
          </span>
        )}
      </div>

      <div className="space-y-5 p-6">
        {setupError ? (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {setupError}
          </div>
        ) : !status ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
        ) : groups ? (
          // ── Signed in to GroupMe: pick the staff group ──
          <>
            <p className="text-sm text-muted">
              Choose the group your staff are in. CareLocal adds <strong className="text-text-main">{status.suggestedBotName}</strong> to it and posts every new shift there.
            </p>
            <div className="space-y-2">
              {groups.map(g => (
                <label key={g.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm ${choice === g.id ? 'border-brand-600 bg-brand-50/50' : 'border-border'}`}>
                  <input type="radio" name="groupme-group" checked={choice === g.id} onChange={() => setChoice(g.id)} className="h-4 w-4 text-brand-600 focus:ring-brand-600" />
                  <span className="flex-1 font-medium text-text-main">{g.name}</span>
                  {g.members > 0 && <span className="text-xs text-muted">{g.members} member{g.members === 1 ? '' : 's'}</span>}
                </label>
              ))}
              <label className={`flex cursor-pointer flex-col gap-3 rounded-xl border px-4 py-3 text-sm ${choice === 'new' ? 'border-brand-600 bg-brand-50/50' : 'border-border'}`}>
                <span className="flex items-center gap-3">
                  <input type="radio" name="groupme-group" checked={choice === 'new'} onChange={() => setChoice('new')} className="h-4 w-4 text-brand-600 focus:ring-brand-600" />
                  <span className="font-medium text-text-main">Create a new group</span>
                </span>
                {choice === 'new' && (
                  <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="e.g. Sunshine Academy Shifts" maxLength={140} className={FIELD} />
                )}
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={createBot} disabled={busy || !choice || (choice === 'new' && !newGroupName.trim())} className={`${BTN} bg-brand-600 text-white hover:bg-brand-800`}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create {status.suggestedBotName}
              </button>
              <button type="button" onClick={cancelChoosing} disabled={busy} className={`${BTN} border border-border text-text-main hover:bg-surface`}>Cancel</button>
            </div>
          </>
        ) : status.connected ? (
          // ── Connected ──
          <>
            <div className="text-sm text-muted">
              New shifts are posted to {status.groupName ? <strong className="text-text-main">{status.groupName}</strong> : 'your GroupMe group'}
              {status.botName ? <> by <strong className="text-text-main">{status.botName}</strong></> : ''}. Staff tap the link to claim a shift in CareLocal.
            </div>
            {status.lastError ? (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Last post failed: {status.lastError}
              </div>
            ) : status.lastPostedAt ? (
              <div className="flex items-center gap-2 text-xs text-muted">
                <CheckCircle2 className="h-4 w-4 text-brand-600" /> Last posted {formatWhen(status.lastPostedAt)}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={test} disabled={busy} className={`${BTN} border border-brand-600 text-brand-600 hover:bg-brand-50`}>
                <Send className="h-4 w-4" /> Send test message
              </button>
              <button type="button" onClick={toggle} disabled={busy} className={`${BTN} border border-border text-text-main hover:bg-surface`}>
                {status.enabled ? 'Pause alerts' : 'Resume alerts'}
              </button>
              {status.oauthAvailable && (
                <button type="button" onClick={connect} disabled={busy} className={`${BTN} border border-border text-text-main hover:bg-surface`}>Change group</button>
              )}
              <button type="button" onClick={disconnect} disabled={busy} className={`${BTN} text-red-600 hover:bg-red-50`}>
                <Unplug className="h-4 w-4" /> Disconnect
              </button>
            </div>
            <p className="text-xs text-subtle">Everyone in the group sees each shift. When someone leaves your center, remove them from the GroupMe group too.</p>
          </>
        ) : (
          // ── Not connected ──
          <>
            <p className="text-sm text-muted">
              Post every new shift to your staff&rsquo;s GroupMe group, alongside app and email alerts. CareLocal creates a bot named <strong className="text-text-main">{status.suggestedBotName}</strong> in the group you choose.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {status.oauthAvailable && (
                <button type="button" onClick={connect} disabled={busy} className={`${BTN} bg-brand-600 text-white hover:bg-brand-800`}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />} Connect GroupMe
                </button>
              )}
              <button type="button" onClick={() => setManual(m => !m)} className="text-sm font-semibold text-brand-600 hover:underline">
                {status.oauthAvailable ? 'Or paste a Bot ID' : 'Paste a Bot ID'}
              </button>
            </div>
            {(manual || !status.oauthAvailable) && (
              <div className="space-y-3 rounded-xl bg-surface p-4">
                <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
                  <li>On a computer, sign in at <a href="https://dev.groupme.com/bots" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">dev.groupme.com/bots</a> with the account that owns your staff group.</li>
                  <li>Click <strong>Create Bot</strong>, choose the group, and name it <strong>{status.suggestedBotName}</strong>. Leave Callback URL blank.</li>
                  <li>Copy the <strong>Bot ID</strong> and paste it here.</li>
                </ol>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input value={botId} onChange={e => setBotId(e.target.value)} placeholder="Bot ID" aria-label="GroupMe Bot ID" className={`${FIELD} font-mono`} />
                  <button type="button" onClick={saveBotId} disabled={busy || !botId.trim()} className={`${BTN} shrink-0 bg-brand-600 text-white hover:bg-brand-800`}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Connect
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
