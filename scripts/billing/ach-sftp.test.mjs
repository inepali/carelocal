#!/usr/bin/env node
/**
 * Tests for the bank SFTP sender (src/lib/server/ach-sftp.ts) against a small in-memory SFTP server built with ssh2:
 * host key pinning, password and private key sign-in, folder checks, upload without overwriting, and PGP encryption.
 *
 *   npm run test:ach-sftp
 */
import ssh2 from 'ssh2'
import { createHash } from 'node:crypto'
import * as openpgp from 'openpgp'
import { SftpError, hostKeyFingerprint, pgpEncrypt, readHostFingerprint, testSftp, uploadSftp } from '../../src/lib/server/ach-sftp.ts'

const { Server, utils } = ssh2
const { STATUS_CODE } = utils.sftp
let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}
async function fails(fn, pat) {
  try { await fn(); return 'did not fail' } catch (e) { return e instanceof SftpError && pat.test(e.message) ? true : `${e?.constructor?.name}: ${e?.message}` }
}

// ---- a tiny bank SFTP server ----------------------------------------------------------------------------------------
const hostKey = utils.generateKeyPairSync('ed25519')
const clientKey = utils.generateKeyPairSync('ed25519', { passphrase: 'kp-123', cipher: 'aes256-ctr', rounds: 16 })
const allowed = utils.parseKey(clientKey.public)
const FP = 'SHA256:' + createHash('sha256').update(utils.parseKey(hostKey.public).getPublicSSH()).digest('base64').replace(/=+$/, '')
const dirs = new Set(['/', '/inbound'])
const files = new Map()
const norm = p => { const s = ('/' + p).replace(/\/+/g, '/').replace(/\/\.(\/|$)/g, '/'); return s.length > 1 ? s.replace(/\/$/, '') : s }
const attrs = (mode, size = 0) => ({ mode, uid: 0, gid: 0, size, atime: 0, mtime: 0 })

const server = new Server({ hostKeys: [hostKey.private] }, client => {
  client.on('authentication', ctx => {
    if (ctx.username !== 'bankuser') return ctx.reject()
    if (ctx.method === 'password') return ctx.password === 'B4nk-pass!' ? ctx.accept() : ctx.reject()
    if (ctx.method === 'publickey' && ctx.key.algo === allowed.type && ctx.key.data.equals(allowed.getPublicSSH())) {
      if (!ctx.signature) return ctx.accept()
      return allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) ? ctx.accept() : ctx.reject()
    }
    ctx.reject(['password', 'publickey'])
  }).on('ready', () => {
    client.on('session', accept => {
      accept().on('sftp', acceptSftp => {
        const sftp = acceptSftp()
        const handles = new Map()
        let next = 0
        const stat = (id, path) => {
          const p = norm(path)
          if (dirs.has(p)) return sftp.attrs(id, attrs(0o40755))
          if (files.has(p)) return sftp.attrs(id, attrs(0o100644, files.get(p).length))
          sftp.status(id, STATUS_CODE.NO_SUCH_FILE)
        }
        sftp.on('REALPATH', (id, path) => sftp.name(id, [{ filename: norm(path), longname: '', attrs: attrs(0o40755) }]))
        sftp.on('STAT', stat).on('LSTAT', stat)
        sftp.on('OPEN', (id, filename) => {
          const p = norm(filename)
          if (!dirs.has(p.replace(/\/[^/]+$/, '') || '/')) return sftp.status(id, STATUS_CODE.NO_SUCH_FILE)
          const h = Buffer.alloc(4); h.writeUInt32BE(next++)
          handles.set(h.toString('hex'), p)
          files.set(p, Buffer.alloc(0))
          sftp.handle(id, h)
        })
        sftp.on('WRITE', (id, handle, offset, data) => {
          const p = handles.get(handle.toString('hex'))
          if (!p) return sftp.status(id, STATUS_CODE.FAILURE)
          const cur = files.get(p)
          const out = Buffer.alloc(Math.max(cur.length, offset + data.length)); cur.copy(out); data.copy(out, offset)
          files.set(p, out)
          sftp.status(id, STATUS_CODE.OK)
        })
        sftp.on('FSTAT', (id, handle) => { const p = handles.get(handle.toString('hex')); stat(id, p ?? '') })
        sftp.on('FSETSTAT', id => sftp.status(id, STATUS_CODE.OK)).on('SETSTAT', id => sftp.status(id, STATUS_CODE.OK))
        sftp.on('CLOSE', (id, handle) => { handles.delete(handle.toString('hex')); sftp.status(id, STATUS_CODE.OK) })
      })
    })
  }).on('error', () => {})
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const target = { host: '127.0.0.1', port, username: 'bankuser', auth: 'password', secret: 'B4nk-pass!', remoteDir: '/inbound', fingerprint: FP }

console.log('host key')
check('fingerprint format matches OpenSSH (SHA256, no padding)', /^SHA256:[A-Za-z0-9+/]{43}$/.test(FP))
check('fingerprint helper agrees', hostKeyFingerprint(utils.parseKey(hostKey.public).getPublicSSH()) === FP)
check('reads the server fingerprint without signing in', (await readHostFingerprint('127.0.0.1', port)) === FP)
check('padding in the saved fingerprint is fine', (await testSftp({ ...target, fingerprint: FP + '=' })).folder === '/inbound')
const wrongFp = 'SHA256:' + 'A'.repeat(43)
check('refuses a server with another host key', await fails(() => testSftp({ ...target, fingerprint: wrongFp }), /host key is SHA256:.*not the fingerprint on file/))

console.log('sign in')
check('password sign-in and folder check', (await testSftp(target)).folder === '/inbound')
check('wrong password', await fails(() => testSftp({ ...target, secret: 'nope' }), /refused the username/))
check('wrong user', await fails(() => testSftp({ ...target, username: 'someone' }), /refused the username/))
const keyTarget = { ...target, auth: 'key', secret: clientKey.private, passphrase: 'kp-123' }
check('private key with passphrase', (await testSftp(keyTarget)).folder === '/inbound')
check('wrong passphrase', await fails(() => testSftp({ ...keyTarget, passphrase: 'bad' }), /private key couldn’t be read|refused/))
check('missing folder', await fails(() => testSftp({ ...target, remoteDir: '/outbound' }), /folder doesn’t exist/))
check('home folder when none is set', (await testSftp({ ...target, remoteDir: '' })).folder === '.')
check('closed port', await fails(() => testSftp({ ...target, port: 1 }), /refused the connection|didn’t answer/))

console.log('upload')
const nacha = '101 0530001961123456789\n'.padEnd(95, ' ')
const path = await uploadSftp(target, 'ACH_20261116.ach', Buffer.from(nacha))
check('uploads into the folder', path === '/inbound/ACH_20261116.ach' && files.get('/inbound/ACH_20261116.ach')?.toString() === nacha, path)
check('never overwrites a file already there', await fails(() => uploadSftp(target, 'ACH_20261116.ach', Buffer.from('again')), /already on the bank server/))
check('the first file is untouched', files.get('/inbound/ACH_20261116.ach')?.toString() === nacha)
check('refuses a path in the file name', await fails(() => uploadSftp(target, '../etc/passwd', Buffer.from('x')), /Bad file name/))
check('refuses a hidden file name', await fails(() => uploadSftp(target, '.profile', Buffer.from('x')), /Bad file name/))
check('upload with the private key', (await uploadSftp(keyTarget, 'ACH_2.ach', Buffer.from('k'))) === '/inbound/ACH_2.ach')

console.log('pgp')
const { privateKey, publicKey } = await openpgp.generateKey({ type: 'ecc', curve: 'curve25519', userIDs: [{ name: 'Bank', email: 'ach@bank.test' }], format: 'armored' })
const enc = await pgpEncrypt(nacha, publicKey)
check('encrypted output is not the file', !enc.toString('latin1').includes('1123456789'))
const msg = await openpgp.readMessage({ binaryMessage: enc })
const { data } = await openpgp.decrypt({ message: msg, decryptionKeys: await openpgp.readPrivateKey({ armoredKey: privateKey }), format: 'binary' })
check('the bank can decrypt it to the same file', Buffer.from(data).toString('utf8') === nacha)
check('a broken PGP key is refused', await fails(() => pgpEncrypt(nacha, '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nnope\n-----END PGP PUBLIC KEY BLOCK-----'), /PGP public key couldn’t be read/))

server.close()
console.log(`\n${passed} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
