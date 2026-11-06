#!/usr/bin/env node
/**
 * Fixture tests for the CACFP meal-pattern checks (src/lib/cacfp.ts).
 *
 *   npm run test:cacfp
 */
import { checkMeal, checkDay, checkWeeks, credits, summarize } from '../../src/lib/cacfp.ts'
import { mondayOf, monthWeeks, monthWeekdays, monthEnd, addMonths } from '../../src/lib/menu.ts'

let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? `  [${detail}]` : ''}`) }
}

let n = 0
const food = (component, extra = {}) => ({
  food_item_id: `f${++n}`, name: `${component}${n}`, component, whole_grain_rich: false, grain_dessert: false,
  allergens: [], serving_note: null, ...extra,
})
const milk = () => food('milk')
const grain = (wgr = false) => food('grain', { whole_grain_rich: wgr })
const dessert = () => food('grain', { grain_dessert: true })
const meat = () => food('meat_alt')
const veg = () => food('vegetable')
const fruit = () => food('fruit')
const other = () => food('other')

console.log('Crediting')
check('grain dessert credits nothing', credits(dessert()) === null)
check('other credits nothing', credits(other()) === null)
check('fruit credits fruit', credits(fruit()) === 'fruit')

console.log('Breakfast')
check('milk + grain + fruit is ok', checkMeal('breakfast', [milk(), grain(), fruit()]).ok)
check('vegetable instead of fruit is ok', checkMeal('breakfast', [milk(), grain(), veg()]).ok)
{
  const r = checkMeal('breakfast', [grain(), fruit()])
  check('missing milk fails', !r.ok && r.problems.includes('Missing milk'), r.problems.join('; '))
}
{
  const r = checkMeal('breakfast', [milk(), meat(), fruit()])
  check('meat alternate stands in for grains', r.ok && r.meatForGrain)
}
{
  const r = checkMeal('breakfast', [milk(), dessert(), fruit()])
  check('grain dessert does not satisfy grains', !r.ok && r.problems.includes('Missing grains'), r.problems.join('; '))
}
check('no fruit or vegetable fails', !checkMeal('breakfast', [milk(), grain()]).ok)

console.log('Lunch / supper')
check('all five is ok', checkMeal('lunch', [milk(), meat(), grain(), veg(), fruit()]).ok)
check('two different vegetables stand in for fruit', checkMeal('supper', [milk(), meat(), grain(), veg(), veg()]).ok)
{
  const v = veg()
  check('the same vegetable twice does not', !checkMeal('lunch', [milk(), meat(), grain(), v, v]).ok)
}
{
  const r = checkMeal('lunch', [milk(), grain(), veg(), fruit()])
  check('missing meat alternate fails', !r.ok && r.problems.includes('Missing meat/meat alternate'), r.problems.join('; '))
}
check('other foods do not fill a gap', !checkMeal('lunch', [milk(), meat(), grain(), veg(), other()]).ok)

console.log('Snacks')
check('two components is ok', checkMeal('pm_snack', [grain(), meat()]).ok)
check('two of the same component fails', !checkMeal('am_snack', [fruit(), fruit()]).ok)
check('one component fails', !checkMeal('pm_snack', [milk()]).ok)
{
  const r = checkMeal('pm_snack', [grain(), meat(), dessert()])
  check('extra grain dessert warns but does not fail', r.ok && r.problems.length === 1, r.problems.join('; '))
}

console.log('Day')
{
  const d = checkDay('2026-12-01', { breakfast: [milk(), grain(true), fruit()], lunch: [milk(), meat(), grain(), veg(), fruit()] })
  check('one whole grain-rich grain makes the day ok', d.ok && d.problems.length === 0)
}
{
  const d = checkDay('2026-12-01', { breakfast: [milk(), grain(), fruit()], pm_snack: [grain(), fruit()] })
  check('no whole grain-rich grain fails the day', !d.ok && d.problems.includes('No whole grain-rich grain today'))
}
{
  const d = checkDay('2026-12-01', { pm_snack: [meat(), fruit()] })
  check('a day with no grains needs no whole grain-rich', d.ok)
}

console.log('Week')
{
  const days = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03'].map(date =>
    checkDay(date, { breakfast: [milk(), meat(), fruit()] }))
  const issues = checkWeeks(days, mondayOf)
  check('a 4th meat-for-grain breakfast in a week is flagged', issues.length === 1 && issues[0].weekStart === '2026-11-30', JSON.stringify(issues))
  check('3 in a week is fine', checkWeeks(days.slice(0, 3), mondayOf).length === 0)
}
{
  const days = [checkDay('2026-12-01', { breakfast: [milk(), grain(true), fruit()] }), checkDay('2026-12-02', { breakfast: [milk(), fruit()] })]
  const s = summarize(days)
  check('summary counts meals and problem days', s.mealsPlanned === 2 && s.mealsOk === 1 && s.daysWithProblems === 1, JSON.stringify(s))
}

console.log('Month grid')
{
  const weeks = monthWeeks('2026-12-01')     // Dec 1 2026 is a Tuesday
  check('December 2026 starts with a blank Monday', weeks[0][0] === null && weeks[0][1] === '2026-12-01')
  check('every row has 5 weekdays', weeks.every(w => w.length === 5))
  check('December 2026 has 23 weekdays', monthWeekdays('2026-12-01').length === 23, String(monthWeekdays('2026-12-01').length))
  check('month end handles February', monthEnd('2028-02-01') === '2028-02-29')
  check('addMonths crosses years', addMonths('2026-12-01', 1) === '2027-01-01' && addMonths('2026-01-01', -1) === '2025-12-01')
  const nov = monthWeekdays('2026-11-01')    // Nov 1 2026 is a Sunday
  check('a month starting on Sunday begins on Monday the 2nd', nov[0] === '2026-11-02')
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
