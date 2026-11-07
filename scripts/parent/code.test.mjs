#!/usr/bin/env node
/**
 * Tests for parent access codes (src/lib/parent-code.ts).
 *
 *   npm run test:parent
 */
import { randomBytes } from 'node:crypto'
import { codeFromBytes, formatParentCode, normalizeParentCode, parentCodeHint } from '../../src/lib/parent-code.ts'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}

console.log('codeFromBytes')
const zeros = codeFromBytes(new Uint8Array(8))
check('all-zero bytes give 00000000', zeros === '00000000', zeros)
check('high bits are ignored (255 -> Z)', codeFromBytes(new Uint8Array(8).fill(255)) === 'ZZZZZZZZ')
check('short input throws', (() => { try { codeFromBytes(new Uint8Array(4)); return false } catch { return true } })())
const many = Array.from({ length: 2000 }, () => codeFromBytes(randomBytes(8)))
check('random codes are always valid', many.every(c => normalizeParentCode(c) === c))
check('random codes never use I, L, O or U', many.every(c => !/[ILOU]/.test(c)))
check('2000 random codes are all different', new Set(many).size === many.length)
const counts = new Map()
for (const c of Array.from({ length: 4000 }, () => codeFromBytes(randomBytes(8))).join('')) counts.set(c, (counts.get(c) ?? 0) + 1)
check('all 32 characters show up', counts.size === 32, String(counts.size))

console.log('normalizeParentCode')
check('dash and spaces', normalizeParentCode(' k7qf-29xm ') === 'K7QF29XM')
check('O read as 0, I and L as 1', normalizeParentCode('OIL0-1234') === '01101234')
check('too short', normalizeParentCode('K7QF-29X') === null)
check('too long', normalizeParentCode('K7QF-29XMA') === null)
check('U is not a code character', normalizeParentCode('UUUU-UUUU') === null)
check('other symbols refused', normalizeParentCode('K7QF/29XM') === null)
check('empty', normalizeParentCode('') === null)

console.log('format and hint')
check('format', formatParentCode('K7QF29XM') === 'K7QF-29XM')
check('hint is the last 4', parentCodeHint('K7QF29XM') === '29XM')

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
