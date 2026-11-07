#!/usr/bin/env node
/**
 * Tests for parent PINs and center link keys (src/lib/parent-code.ts).
 *
 *   npm run test:parent
 */
import { randomInt } from 'node:crypto'
import { formatPin, normalizeCenterKey, normalizePin, pinFromNumber, weakPinReason } from '../../src/lib/parent-code.ts'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}

console.log('normalizePin')
check('six digits', normalizePin('482913') === '482913')
check('spaces and dashes ignored', normalizePin(' 482 913 ') === '482913' && normalizePin('482-913') === '482913')
check('leading zeros kept', normalizePin('007312') === '007312')
check('five digits refused', normalizePin('48291') === null)
check('seven digits refused', normalizePin('4829130') === null)
check('letters refused', normalizePin('48291a') === null)

console.log('weakPinReason')
for (const pin of ['000000', '999999', '123456', '234567', '654321', '987654', '012345', '121212', '123123', '454545', '112233', '159753']) {
  check(`${pin} is refused`, weakPinReason(pin) !== null)
}
for (const pin of ['482913', '730264', '051938', '119284']) {
  check(`${pin} is fine`, weakPinReason(pin) === null, weakPinReason(pin) ?? '')
}

console.log('pinFromNumber')
check('pads to 6', pinFromNumber(42) === '000042')
check('top of range', pinFromNumber(999999) === '999999')
check('out of range throws', (() => { try { pinFromNumber(1_000_000); return false } catch { return true } })())
const many = Array.from({ length: 5000 }, () => pinFromNumber(randomInt(0, 1_000_000)))
check('random PINs are always 6 digits', many.every(p => normalizePin(p) === p))
check('most random PINs are not weak', many.filter(p => weakPinReason(p)).length < 50)

console.log('format and center key')
check('format', formatPin('482913') === '482 913')
check('key ok', normalizeCenterKey('k7m2xq9d') === 'k7m2xq9d' && normalizeCenterKey('K7M2XQ9D') === 'k7m2xq9d')
check('key with i/l/o/u refused', normalizeCenterKey('k7m2xq9i') === null && normalizeCenterKey('uuuuuuuu') === null)
check('key wrong length refused', normalizeCenterKey('k7m2xq9') === null && normalizeCenterKey('') === null && normalizeCenterKey(null) === null)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
