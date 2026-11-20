// Server only. Talks to a bank's SFTP server ("direct transmission") to deliver a center's ACH file.
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import SftpClient from 'ssh2-sftp-client'
import * as openpgp from 'openpgp'

export interface SftpTarget {
  host: string
  port: number
  username: string
  auth: 'password' | 'key'
  secret: string              // the password, or the private key (PEM / OpenSSH)
  passphrase?: string         // for an encrypted private key
  remoteDir?: string | null
  fingerprint: string         // the bank server's host key, "SHA256:…", given by the bank
}

/** A message that is safe to show the owner and to log: no secrets, no file contents */
export class SftpError extends Error {}

const TIMEOUT_MS = 20_000

export function hostKeyFingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
}
const sameFingerprint = (a: string, b: string) => a.replace(/=+$/, '') === b.replace(/=+$/, '')

function explain(e: unknown, seen: string | null, want: string | null): SftpError {
  const msg = e instanceof Error ? e.message : String(e)
  if (want && seen && !sameFingerprint(seen, want)) {
    return new SftpError(`The bank server's host key is ${seen}, not the fingerprint on file. Don't send anything: confirm the fingerprint with your bank first.`)
  }
  if (/authentication methods failed|auth/i.test(msg)) return new SftpError('The bank server refused the username, password or private key.')
  if (/passphrase|encrypted private key|Cannot parse privateKey/i.test(msg)) return new SftpError('The private key couldn’t be read. Check the key and its passphrase.')
  if (/timed out|ETIMEDOUT|handshake/i.test(msg)) {
    return new SftpError('The bank server didn’t answer. Banks only accept connections from IP addresses they allowlist, so CareLocal’s fixed IP may not be set up or allowlisted yet.')
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return new SftpError('That SFTP host name wasn’t found. Check it with your bank.')
  if (/ECONNREFUSED/i.test(msg)) return new SftpError('The bank server refused the connection on that port.')
  if (/No such file|ENOENT/i.test(msg)) return new SftpError('That folder doesn’t exist on the bank server.')
  if (/Permission denied|EACCES/i.test(msg)) return new SftpError('The bank server doesn’t allow writing to that folder.')
  return new SftpError('The bank server connection failed. Check the settings with your bank and try again.')
}

async function withSftp<T>(t: SftpTarget, fn: (c: SftpClient) => Promise<T>): Promise<T> {
  const client = new SftpClient('carelocal-ach')
  let seen: string | null = null
  try {
    await client.connect({
      host: t.host,
      port: t.port,
      username: t.username,
      ...(t.auth === 'password' ? { password: t.secret } : { privateKey: t.secret, passphrase: t.passphrase || undefined }),
      readyTimeout: TIMEOUT_MS,
      retries: 0,
      // Only talk to the server whose host key the bank gave us, so the file can't go to an impostor
      hostVerifier: (key: Buffer) => { seen = hostKeyFingerprint(key); return sameFingerprint(seen, t.fingerprint) },
    })
    return await fn(client)
  } catch (e) {
    if (e instanceof SftpError) throw e
    throw explain(e, seen, t.fingerprint)
  } finally {
    await client.end().catch(() => {})
  }
}

const dirOf = (t: SftpTarget) => (t.remoteDir?.trim() || '.')

/** Signs in, checks the host key and the folder, and sends nothing */
export async function testSftp(t: SftpTarget): Promise<{ folder: string }> {
  return withSftp(t, async c => {
    const folder = dirOf(t)
    const kind = await c.exists(folder)
    if (kind !== 'd') throw new SftpError(folder === '.' ? 'The bank server’s home folder can’t be opened.' : 'That folder doesn’t exist on the bank server.')
    return { folder }
  })
}

/**
 * The host key the server presents, without signing in. For comparing with the fingerprint the bank gives you;
 * never save it without that check.
 */
export async function readHostFingerprint(host: string, port: number): Promise<string> {
  const client = new SftpClient('carelocal-ach-probe')
  let seen: string | null = null
  try {
    await client.connect({ host, port, username: 'fingerprint-check', password: 'x', readyTimeout: TIMEOUT_MS, retries: 0,
      hostVerifier: (key: Buffer) => { seen = hostKeyFingerprint(key); return false } })
  } catch (e) {
    if (seen) return seen
    throw explain(e, null, null)
  } finally {
    await client.end().catch(() => {})
  }
  throw new SftpError('The server didn’t present a host key.')
}

/** Uploads the file under a new name (never over an existing file). Returns the path it was written to. */
export async function uploadSftp(t: SftpTarget, fileName: string, content: Buffer): Promise<string> {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(fileName) || fileName.startsWith('.')) throw new SftpError('Bad file name')
  return withSftp(t, async c => {
    const path = posix.join(dirOf(t), fileName)
    if (await c.exists(path)) throw new SftpError(`A file named ${fileName} is already on the bank server. Nothing was sent.`)
    await c.put(content, path)
    return path
  })
}

/** Encrypts the file with the bank's PGP public key (binary OpenPGP message), for banks that require it */
export async function pgpEncrypt(content: string, armoredPublicKey: string): Promise<Buffer> {
  let key: openpgp.Key
  try {
    key = await openpgp.readKey({ armoredKey: armoredPublicKey })
  } catch {
    throw new SftpError('The bank’s PGP public key couldn’t be read. Paste it again from your bank.')
  }
  const message = await openpgp.createMessage({ binary: new TextEncoder().encode(content) })
  const encrypted = await openpgp.encrypt({ message, encryptionKeys: key, format: 'binary' })
  return Buffer.from(encrypted as Uint8Array)
}
