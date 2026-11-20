'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, History, KeyRound, Landmark, Loader2, Lock, Pencil, PlugZap, Server } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { friendlyTuitionError } from '@/lib/tuition'
import { showAlert } from '@/lib/dialog'
import {
  BANK_PRESETS, SEND_METHOD_LABEL, checkAchSettings, settingsToInput,
  type AchBank, type AchSendMethod, type AchSettingsData, type AchSettingsInput, type SecretName,
} from '@/lib/ach-banks'
import { readAchHostFingerprint, saveAchSettings, testAchConnection } from '@/app/actions/ach-settings.actions'
import { useCenterContext } from '../../context'
import { BTN_PRIMARY, BTN_QUIET, BTN_QUIET_SM, FLD, LBL, Modal } from '../../children/_components/ui'

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const ACTION_LABEL = { saved: 'Saved', secrets_read: 'Used', tested: 'Connection OK', test_failed: 'Connection failed', sent: 'File sent', send_failed: 'Send failed' } as const
const BANKS: AchBank[] = ['truist', 'wells_fargo', 'bank_of_america', 'other']
const METHODS: AchSendMethod[] = ['manual', 'sftp', 'api']

/**
 * Center Profile → ACH bank settings: how the center's ACH (NACHA) file is built and how it reaches the bank.
 * Owners and admins see the settings (never the secrets); only the owner changes them, tests the connection, and sends.
 * Every change, test and file sent is logged below.
 */
export default function CenterAchSettingsCard() {
  const { centerId, role } = useCenterContext()
  const allowed = role === 'owner' || role === 'admin'
  const [data, setData] = useState<AchSettingsData | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<AchSettingsInput | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [probing, setProbing] = useState(false)
  const [showLog, setShowLog] = useState(false)

  const load = useCallback(async () => {
    if (!centerId) return
    const { data: d, error: e } = await createClient().rpc('center_ach_settings_get', { p_center_id: centerId })
    if (e) { setError(friendlyTuitionError(e)); return }
    setError('')
    setData(d as AchSettingsData)
  }, [centerId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (allowed) load() }, [allowed, load])

  if (!allowed || !centerId) return null
  const s = data?.settings ?? null
  const preset = BANK_PRESETS[s?.bank ?? 'other']
  const bankName = s ? (s.bank === 'other' ? s.bank_label : preset.label) : null
  const sftpReady = !!(s && s.send_method === 'sftp' && s.sftp_host && s.sftp_username && s.has_sftp_secret && s.sftp_host_fingerprint)

  function edit() {
    const f = settingsToInput(s)
    if (!s && BANK_PRESETS[f.bank].apiBaseUrl) f.api_base_url = BANK_PRESETS[f.bank].apiBaseUrl!
    setForm(f)
  }

  async function save() {
    if (!form || !centerId) return
    const problem = checkAchSettings(form, { sftp_secret: !!s?.has_sftp_secret })
    if (problem) { showAlert(problem); return }
    setSaving(true)
    const res = await saveAchSettings(centerId, form)
    setSaving(false)
    if (!res.success) { showAlert(res.error); return }
    setForm(null)
    load()
  }

  async function test() {
    if (!centerId) return
    setTesting(true)
    const res = await testAchConnection(centerId)
    setTesting(false)
    load()
    if (!res.success) { showAlert(res.error, { title: 'Connection failed' }); return }
    showAlert(`Signed in to ${s?.sftp_host} and found the folder ${res.folder}. Nothing was sent.`, { title: 'Connection works' })
  }

  async function probe() {
    if (!centerId) return
    setProbing(true)
    const res = await readAchHostFingerprint(centerId)
    setProbing(false)
    if (!res.success) { showAlert(res.error); return }
    showAlert(`The server presents ${res.fingerprint}. Only save it if it matches the fingerprint your bank gave you (ask them by phone or in their setup document, not by email from an unknown sender).`, { title: 'Server host key' })
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/50 p-5">
        <div className="flex items-center gap-3">
          <Landmark className="h-5 w-5 text-brand-600" />
          <h2 className="text-base font-semibold text-text-main">ACH bank settings</h2>
        </div>
        {data?.is_owner && (
          <div className="flex gap-2">
            {sftpReady && (
              <button onClick={test} disabled={testing} className={BTN_QUIET_SM}>
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} Test connection
              </button>
            )}
            <button onClick={edit} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-800">
              <Pencil className="h-3.5 w-3.5" /> {s ? 'Edit settings' : 'Set up'}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-5 p-6">
        <p className="text-sm text-muted">
          How Run ACH builds the center&apos;s NACHA file and gets it to the bank: the Company ID and file details your bank gave
          you, and, if the bank set it up, the SFTP connection CareLocal sends the file through.
        </p>

        {error ? <p className="text-sm text-red-700">{error}</p> : !data ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
        ) : s ? (
          <div className="rounded-2xl border border-border p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-heading">{bankName}</div>
                <div className="text-sm text-text-main">{SEND_METHOD_LABEL[s.send_method]}</div>
              </div>
              {s.send_method === 'sftp' && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${sftpReady ? 'border-brand-100 bg-brand-50 text-brand-600' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                  {sftpReady ? <><CheckCircle2 className="h-3.5 w-3.5" /> Ready to send</> : 'Not finished'}
                </span>
              )}
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <Item label="Company ID" value={s.company_id} mono />
              <Item label="Name on statements" value={s.company_name ?? 'Center name'} />
              <Item label="Entry description" value={s.entry_description ?? 'TUITION'} />
              <Item label="Balanced file" value={s.balanced ? 'Yes, with an offsetting credit' : 'No (debits only)'} />
              {s.immediate_destination && <Item label="Immediate destination" value={s.immediate_destination} mono />}
              {s.immediate_origin && <Item label="Immediate origin" value={s.immediate_origin} mono />}
              {s.file_name_pattern && <Item label="File name" value={s.file_name_pattern} mono />}
              {s.line_ending === 'crlf' && <Item label="Line endings" value="CRLF" />}
              {s.send_method === 'sftp' && <>
                <Item label="SFTP server" value={s.sftp_host ? `${s.sftp_host}:${s.sftp_port}` : null} mono />
                <Item label="Username" value={s.sftp_username} mono />
                <Item label="Folder" value={s.sftp_remote_dir || 'Home folder'} mono />
                <Item label={s.sftp_auth === 'key' ? 'Private key' : 'Password'} value={s.has_sftp_secret ? 'Saved, encrypted' : null} />
                <Item label="Host key" value={s.sftp_host_fingerprint ? `${s.sftp_host_fingerprint.slice(0, 22)}…` : null} mono />
                <Item label="PGP encryption" value={s.pgp_public_key ? 'On, with the bank’s key' : 'Off'} />
              </>}
              {s.send_method === 'api' && <>
                <Item label="API" value={`${s.api_environment === 'production' ? 'Production' : 'Sandbox'}${s.api_base_url ? ` · ${s.api_base_url}` : ''}`} />
                <Item label="Client ID" value={s.api_client_id} mono />
                <Item label="Client secret" value={s.has_api_client_secret ? 'Saved, encrypted' : null} />
              </>}
            </dl>
            {s.send_method === 'api' && <p className="mt-3 text-xs text-muted">Bank APIs take payments one at a time, not NACHA files, so Run ACH still builds the file for you to upload. These credentials are kept for when API sending is added.</p>}
            {s.send_method !== 'sftp' && <p className="mt-3 text-xs text-muted">Upload the file: {preset.uploadHint}</p>}
            <p className="mt-3 text-xs text-muted">Updated {when(s.updated_at)} by {s.updated_by}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
            <Lock className="mx-auto mb-2 h-6 w-6 text-brand-200" />
            No ACH bank settings yet.{data.is_owner ? ' Set them up once your bank has enrolled the center in ACH origination.' : ' The center’s owner can set them up.'}
          </div>
        )}

        {data && !data.is_owner && <p className="flex items-center gap-1.5 text-xs text-muted"><Lock className="h-3.5 w-3.5" /> Only the center&apos;s owner can change these settings or send files to the bank.</p>}

        {data && data.events.length > 0 && (
          <div>
            <button onClick={() => setShowLog(v => !v)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
              <History className="h-4 w-4" /> {showLog ? 'Hide' : 'Show'} change and connection log
            </button>
            {showLog && (
              <ul className="mt-3 space-y-2 text-sm">
                {data.events.map((e, i) => (
                  <li key={i}>
                    <span className={`font-semibold ${e.action.endsWith('failed') ? 'text-red-700' : 'text-heading'}`}>{ACTION_LABEL[e.action]}</span>{' '}
                    <span className="text-muted">· {when(e.at)} · {e.who}{e.summary ? ` · ${e.summary}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {form && (
        <SettingsForm form={form} setForm={setForm} saved={s} saving={saving} probing={probing}
          onProbe={probe} onSave={save} onClose={() => setForm(null)} />
      )}
    </div>
  )
}

function Item({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`${mono ? 'font-mono' : ''} ${value ? 'text-heading' : 'text-amber-700'}`}>{value || 'Not set'}</dd>
    </div>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-heading">{icon} {title}</h3>
      {children}
    </section>
  )
}

function SettingsForm({ form, setForm, saved, saving, probing, onProbe, onSave, onClose }: {
  form: AchSettingsInput; setForm: (f: AchSettingsInput | null) => void; saved: AchSettingsData['settings']
  saving: boolean; probing: boolean; onProbe: () => void; onSave: () => void; onClose: () => void
}) {
  const set = <K extends keyof AchSettingsInput>(k: K, v: AchSettingsInput[K]) => setForm({ ...form, [k]: v })
  const preset = BANK_PRESETS[form.bank]
  const clear = form.clear ?? []
  const toggleClear = (n: SecretName) => setForm({ ...form, clear: clear.includes(n) ? clear.filter(x => x !== n) : [...clear, n], [n]: '' })
  const has: Record<SecretName, boolean> = {
    sftp_secret: !!saved?.has_sftp_secret, sftp_passphrase: !!saved?.has_sftp_passphrase,
    api_client_secret: !!saved?.has_api_client_secret, api_client_key: !!saved?.has_api_client_key,
  }

  function pickBank(b: AchBank) {
    const next = { ...form, bank: b }
    // Prefill the bank's published API address when the field is empty or still another bank's
    const urls = Object.values(BANK_PRESETS).map(p => p.apiBaseUrl).filter(Boolean)
    if (!form.api_base_url || urls.includes(form.api_base_url)) next.api_base_url = BANK_PRESETS[b].apiBaseUrl ?? ''
    setForm(next)
  }

  /** A password, key or secret: never shown, blank keeps the saved one */
  // A plain function, not a component: declared inside the form, a component would remount and lose focus on each key
  const secret = (name: SecretName, label: string, multiline?: boolean, placeholder?: string) => {
    const cleared = clear.includes(name)
    const hint = has[name] && !cleared ? 'Saved. Leave empty to keep it, or paste a new one.' : placeholder
    const props = {
      id: `ach-${name}`, value: form[name] ?? '', autoComplete: 'off', 'data-1p-ignore': true, 'data-lpignore': 'true', spellCheck: false,
      disabled: cleared, placeholder: cleared ? 'Will be removed when you save' : hint,
      onChange: (e: { target: { value: string } }) => set(name, e.target.value),
    }
    return (
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor={`ach-${name}`} className={LBL}>{label}</label>
          {has[name] && <button type="button" onClick={() => toggleClear(name)} className="mb-1.5 text-xs font-semibold text-brand-600 hover:underline">{cleared ? 'Keep it' : 'Remove'}</button>}
        </div>
        {multiline
          ? <textarea {...props} rows={4} className={`${FLD} font-mono text-xs`} />
          : <input {...props} type="password" className={`${FLD} font-mono`} />}
      </div>
    )
  }

  return (
    <Modal wide title="ACH bank settings" onClose={onClose} footer={
      <>
        <button onClick={onClose} className={BTN_QUIET}>Cancel</button>
        <button onClick={onSave} disabled={saving} className={BTN_PRIMARY}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save settings</button>
      </>
    }>
      <div className="space-y-4">
        <Section icon={<Landmark className="h-4 w-4 text-brand-600" />} title="Bank">
          <div className="grid gap-2 sm:grid-cols-4">
            {BANKS.map(b => (
              <button key={b} type="button" onClick={() => pickBank(b)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold ${form.bank === b ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-border text-text-main hover:bg-surface'}`}>
                {BANK_PRESETS[b].label}
              </button>
            ))}
          </div>
          {form.bank === 'other' && (
            <div>
              <label htmlFor="ach-bank-label" className={LBL}>Bank name *</label>
              <input id="ach-bank-label" value={form.bank_label} onChange={e => set('bank_label', e.target.value)} maxLength={80} className={FLD} placeholder="PNC, First Citizens…" />
            </div>
          )}
          <div className="space-y-1.5">
            <span className={LBL}>How the file reaches the bank</span>
            {METHODS.map(m => (
              <label key={m} className="flex items-start gap-2 text-sm">
                <input type="radio" className="mt-1" checked={form.send_method === m} onChange={() => set('send_method', m)} />
                <span>{SEND_METHOD_LABEL[m]}</span>
              </label>
            ))}
            <p className="rounded-xl bg-surface p-3 text-xs text-muted">
              {form.send_method === 'manual' ? preset.uploadHint : form.send_method === 'sftp' ? preset.transmissionHint : preset.apiHint}
            </p>
          </div>
        </Section>

        <Section icon={<KeyRound className="h-4 w-4 text-brand-600" />} title="NACHA file">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="ach-cid" className={LBL}>Company ID</label>
              <input id="ach-cid" value={form.company_id} onChange={e => set('company_id', e.target.value.replace(/\s/g, '').toUpperCase())} maxLength={10} className={`${FLD} font-mono`} placeholder="e.g. 1123456789" />
              <p className="mt-1 text-[11px] text-subtle">From your bank when it set up ACH (often 1 + your EIN).</p>
            </div>
            <div>
              <label htmlFor="ach-cname" className={LBL}>Name on statements</label>
              <input id="ach-cname" value={form.company_name} onChange={e => set('company_name', e.target.value)} maxLength={16} className={FLD} placeholder="Center name" />
              <p className="mt-1 text-[11px] text-subtle">Up to 16 characters. Families see it on their bank statement.</p>
            </div>
            <div>
              <label htmlFor="ach-desc" className={LBL}>Entry description</label>
              <input id="ach-desc" value={form.entry_description} onChange={e => set('entry_description', e.target.value)} maxLength={10} className={FLD} placeholder="TUITION" />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={form.balanced} onChange={e => set('balanced', e.target.checked)} />
            <span>Balanced file: add an offsetting credit to the center&apos;s account. Only if your bank asks for one.</span>
          </label>
          <details className="rounded-xl bg-surface p-3">
            <summary className="cursor-pointer text-sm font-semibold text-text-main">File header values from your bank&apos;s ACH specs (optional)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="ach-idest" className={LBL}>Immediate destination</label>
                <input id="ach-idest" value={form.immediate_destination} onChange={e => set('immediate_destination', e.target.value.replace(/\D/g, '').slice(0, 9))} inputMode="numeric" className={`${FLD} font-mono`} placeholder="Center's routing number" />
              </div>
              <div>
                <label htmlFor="ach-idestn" className={LBL}>Destination name</label>
                <input id="ach-idestn" value={form.immediate_destination_name} onChange={e => set('immediate_destination_name', e.target.value)} maxLength={23} className={FLD} placeholder="Bank name" />
              </div>
              <div>
                <label htmlFor="ach-iorig" className={LBL}>Immediate origin</label>
                <input id="ach-iorig" value={form.immediate_origin} onChange={e => set('immediate_origin', e.target.value.replace(/\s/g, '').toUpperCase())} maxLength={10} className={`${FLD} font-mono`} placeholder="Company ID" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="ach-fname" className={LBL}>File name</label>
                <input id="ach-fname" value={form.file_name_pattern} onChange={e => set('file_name_pattern', e.target.value.replace(/\s/g, ''))} maxLength={120} className={`${FLD} font-mono`} placeholder="ach-drafts-{date}-{created}.ach" />
                <p className="mt-1 text-[11px] text-subtle">Tokens: {'{companyId}'} {'{date}'} (draft date) {'{created}'} (now, to the second) {'{seq}'}. Some banks pick files up by name.</p>
              </div>
              <div>
                <label htmlFor="ach-eol" className={LBL}>Line endings</label>
                <select id="ach-eol" value={form.line_ending} onChange={e => set('line_ending', e.target.value as 'lf' | 'crlf')} className={FLD}>
                  <option value="lf">LF (most banks)</option><option value="crlf">CRLF</option>
                </select>
              </div>
            </div>
          </details>
        </Section>

        {form.send_method === 'sftp' && (
          <Section icon={<Server className="h-4 w-4 text-brand-600" />} title="SFTP connection (from your bank)">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label htmlFor="ach-host" className={LBL}>Host *</label>
                <input id="ach-host" value={form.sftp_host} onChange={e => set('sftp_host', e.target.value.trim())} className={`${FLD} font-mono`} placeholder="sftp.yourbank.com" />
              </div>
              <div>
                <label htmlFor="ach-port" className={LBL}>Port</label>
                <input id="ach-port" value={form.sftp_port} onChange={e => set('sftp_port', e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" className={`${FLD} font-mono`} />
              </div>
              <div>
                <label htmlFor="ach-user" className={LBL}>Username *</label>
                <input id="ach-user" value={form.sftp_username} onChange={e => set('sftp_username', e.target.value.trim())} autoComplete="off" className={`${FLD} font-mono`} />
              </div>
              <div>
                <label htmlFor="ach-auth" className={LBL}>Sign in with</label>
                <select id="ach-auth" value={form.sftp_auth} onChange={e => set('sftp_auth', e.target.value as 'password' | 'key')} className={FLD}>
                  <option value="key">SSH private key</option><option value="password">Password</option>
                </select>
              </div>
              <div>
                <label htmlFor="ach-dir" className={LBL}>Folder</label>
                <input id="ach-dir" value={form.sftp_remote_dir} onChange={e => set('sftp_remote_dir', e.target.value.trim())} className={`${FLD} font-mono`} placeholder="/inbound/ach" />
              </div>
            </div>
            {form.sftp_auth === 'key' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">{secret('sftp_secret', 'Private key *', true, '-----BEGIN OPENSSH PRIVATE KEY-----')}</div>
                {secret('sftp_passphrase', 'Key passphrase', false, 'Only if the key has one')}
              </div>
            ) : secret('sftp_secret', 'Password *')}
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="ach-fp" className={LBL}>Server host key fingerprint *</label>
                {saved?.sftp_host && <button type="button" onClick={onProbe} disabled={probing} className="mb-1.5 text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50">{probing ? 'Checking…' : 'Read it from the saved server'}</button>}
              </div>
              <input id="ach-fp" value={form.sftp_host_fingerprint} onChange={e => set('sftp_host_fingerprint', e.target.value.trim())} className={`${FLD} font-mono text-xs`} placeholder="SHA256:…" />
              <p className="mt-1 text-[11px] text-subtle">Ask your bank for it. CareLocal only sends to the server with this exact key, so a look-alike server can&apos;t receive the file.</p>
            </div>
            <div>
              <label htmlFor="ach-pgp" className={LBL}>Bank&apos;s PGP public key (if the bank wants files encrypted)</label>
              <textarea id="ach-pgp" value={form.pgp_public_key} onChange={e => set('pgp_public_key', e.target.value)} rows={3} spellCheck={false} className={`${FLD} font-mono text-xs`} placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----" />
            </div>
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Banks only accept SFTP from IP addresses they allowlist. CareLocal&apos;s fixed IP address for bank connections isn&apos;t set up yet, so
              the connection test will fail until it is and your bank has allowlisted it. Until then, download the file and upload it by hand.
            </p>
          </Section>
        )}

        {form.send_method === 'api' && (
          <Section icon={<PlugZap className="h-4 w-4 text-brand-600" />} title="Bank API credentials (saved for later)">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="ach-env" className={LBL}>Environment</label>
                <select id="ach-env" value={form.api_environment} onChange={e => set('api_environment', e.target.value as 'sandbox' | 'production')} className={FLD}>
                  <option value="sandbox">Sandbox</option><option value="production">Production</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="ach-url" className={LBL}>API base URL</label>
                <input id="ach-url" value={form.api_base_url} onChange={e => set('api_base_url', e.target.value.trim())} className={`${FLD} font-mono`} placeholder="https://" />
              </div>
              <div>
                <label htmlFor="ach-cli" className={LBL}>Client ID</label>
                <input id="ach-cli" value={form.api_client_id} onChange={e => set('api_client_id', e.target.value.trim())} autoComplete="off" className={`${FLD} font-mono`} />
              </div>
              <div className="sm:col-span-2">{secret('api_client_secret', 'Client secret')}</div>
              {preset.apiExtra.map(f => (
                <div key={f.key}>
                  <label htmlFor={`ach-x-${f.key}`} className={LBL}>{f.label}</label>
                  <input id={`ach-x-${f.key}`} value={form.api_extra[f.key] ?? ''} onChange={e => set('api_extra', { ...form.api_extra, [f.key]: e.target.value })} maxLength={200} className={`${FLD} font-mono`} />
                  {f.help && <p className="mt-1 text-[11px] text-subtle">{f.help}</p>}
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="ach-cert" className={LBL}>Client certificate (mutual TLS)</label>
                <textarea id="ach-cert" value={form.api_client_cert} onChange={e => set('api_client_cert', e.target.value)} rows={4} spellCheck={false} className={`${FLD} font-mono text-xs`} placeholder="-----BEGIN CERTIFICATE-----" />
              </div>
              {secret('api_client_key', 'Certificate private key', true, '-----BEGIN PRIVATE KEY-----')}
            </div>
            <p className="rounded-xl bg-surface p-3 text-xs text-muted">Bank APIs take ACH payments one at a time, not NACHA files, so nothing is sent this way yet. Run ACH still builds the file for you to upload.</p>
          </Section>
        )}

        <p className="flex items-start gap-1.5 text-[11px] text-subtle"><Lock className="mt-0.5 h-3 w-3 shrink-0" /> Passwords, private keys and secrets are encrypted before they are saved and are never shown again. Only the owner can change these settings, and every change, test and file sent is logged.</p>
      </div>
    </Modal>
  )
}
