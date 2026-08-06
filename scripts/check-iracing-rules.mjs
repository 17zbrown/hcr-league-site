#!/usr/bin/env node
// Assert that the browser and the database agree on when a season entry is
// complete.
//
// A season registration is refused unless it carries a full iRacing name and a
// numeric customer ID. That rule is written down three times — in the form, in
// the commissioner's accept guard, and in the CHECK constraint on
// season_registrations — because each layer catches a different bypass:
//
//   the form      so a driver is told what is wrong while typing
//   the guard     so accepting an entry states the rule where accepting happens
//   the constraint  because RLS lets any signed-in user POST straight to the
//                   table, so the RPC alone would not hold the line
//
// Three copies drift. If the form ever grows stricter than the database, drivers
// get blocked from entering for no reason; if it grows looser, they fill the form
// in, hit submit, and get a raw Postgres constraint error. This pins both client
// copies to the same behaviour table the database was probed with.
//
// The regexes are read out of the shipped source rather than retyped, so this
// cannot pass while the real files say something else.
//
// The database side of the contract is:
//
//   btrim(coalesce(iracing_name,   '')) ~ '\S\s+\S'
//   btrim(coalesce(iracing_custid, '')) ~ '^[0-9]+$'
//
// To re-check the database still matches, run that predicate over the `expected`
// column below and confirm every row agrees.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

/** Pull a regex literal out of source, failing loudly if it has moved. */
function extract(source, label, pattern) {
  const m = source.match(pattern)
  if (!m) {
    console.error(`✗ could not find ${label} — this check needs updating to match the source.`)
    process.exit(2)
  }
  return new RegExp(m[1])
}

const account = read('src/pages/Account.tsx')
const admin = read('src/pages/commissioner/Registrations.tsx')

const layers = [
  {
    name: 'entry form',
    name_re: extract(account, 'IRACING_FULL_NAME', /const IRACING_FULL_NAME = \/(.+?)\/\r?\n/),
    cid_re: extract(account, 'IRACING_CUSTID', /const IRACING_CUSTID = \/(.+?)\/\r?\n/),
  },
  {
    name: 'accept guard',
    name_re: extract(admin, "the admin name test", /!\/(.+?)\/\.test\(name\)/),
    cid_re: extract(admin, "the admin custid test", /!\/(.+?)\/\.test\(custid\)/),
  },
]

// name, custid, and whether the database accepts the pair. Verified against
// Postgres directly — see the predicate in the header.
const CASES = [
  ['both good', 'Zack Brown', '123456', true],
  ['null name', null, '123456', false],
  ['blank name', '', '123456', false],
  ['whitespace-only name', '   ', '123456', false],
  ['first name only', 'Zack', '123456', false],
  ['padded first name only', '  Zack  ', '123456', false],
  ['three-part name', 'Tyler J. Johnson', '123456', true],
  ['double-spaced name', 'Zack  Brown', '123456', true],
  ['tab-separated name', 'Zack\tBrown', '123456', true],
  ['accented name', 'Aurélien Panis', '123456', true],
  ['null custid', 'Zack Brown', null, false],
  ['blank custid', 'Zack Brown', '', false],
  ['whitespace-only custid', 'Zack Brown', '  ', false],
  ['letters in custid', 'Zack Brown', 'abc123', false],
  ['space inside custid', 'Zack Brown', '123 456', false],
  ['padded digits', 'Zack Brown', ' 123456 ', true],
  ['leading zeros', 'Zack Brown', '0000123', true],
  // Postgres `$` is not newline-permissive by default; the client must not be either.
  ['newline injection', 'Zack Brown', '123\nxyz', false],
]

let failures = 0
for (const [label, nm, cid, expected] of CASES) {
  for (const layer of layers) {
    const accepted =
      layer.name_re.test(String(nm ?? '').trim()) && layer.cid_re.test(String(cid ?? '').trim())
    if (accepted !== expected) {
      failures++
      console.error(
        `✗ ${layer.name}: ${label} — database says ${expected ? 'accept' : 'reject'}, ` +
          `${layer.name} says ${accepted ? 'accept' : 'reject'}`,
      )
    }
  }
}

if (failures) {
  console.error(`\n${failures} disagreement(s): the form and the database would behave differently.`)
  process.exit(1)
}
console.log(
  `✓ iRacing entry rules agree across ${layers.length} client layers and the database ` +
    `over ${CASES.length} cases.`,
)
