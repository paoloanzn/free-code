// Real Claude Code companion cracker — uses the exact algorithm from companion.ts
// Key differences from hatch.py:
//   1. PRNG is Mulberry32, not SplitMix32
//   2. Uses Bun.hash (wyhash) natively
//   3. Cracks accountUuid (the field actually used), not userID

const SALT = 'friend-2026-401'
const SPECIES = ['duck','goose','blob','cat','dragon','octopus','owl','penguin','turtle','snail','ghost','axolotl','capybara','cactus','robot','rabbit','mushroom','chonk']
const EYES = ['·','✦','×','◉','@','°']
const HATS = ['none','crown','tophat','propeller','halo','wizard','beanie','tinyduck']
const RARITIES = ['common','uncommon','rare','epic','legendary']
const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 }
const STAT_NAMES = ['DEBUGGING','PATIENCE','CHAOS','WISDOM','SNARK']

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s) {
  return Number(BigInt(Bun.hash(s)) & 0xffffffffn)
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

function rollRarity(rng) {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity]
    if (roll < 0) return rarity
  }
  return 'common'
}

function rollFrom(rng) {
  const rarity = rollRarity(rng)
  const species = pick(rng, SPECIES)
  const eye = pick(rng, EYES)
  const hat = rarity === 'common' ? 'none' : pick(rng, HATS)
  const shiny = rng() < 0.01
  // consume stat RNG calls too (to keep state consistent, though we don't need stats for matching)
  // rollStats: pick peak, pick dump (with retry), then 5 stat rolls
  return { rarity, species, eye, hat, shiny }
}

// Target parsing
const target = (process.argv[2] || '').toLowerCase()
if (!target) {
  console.error('Usage: bun crack.mjs "legendary shiny rabbit"')
  process.exit(1)
}

let wantRarity = null, wantSpecies = null, wantShiny = target.includes('shiny')
for (const r of RARITIES) { if (target.includes(r)) { wantRarity = r; break } }
for (const s of SPECIES) { if (target.includes(s)) { wantSpecies = s; break } }

if (!wantRarity && !wantSpecies && !wantShiny) {
  console.error('Specify at least one of: ' + [...RARITIES, ...SPECIES, 'shiny'].join(', '))
  process.exit(1)
}

console.error(`Cracking: ${[wantRarity, wantShiny ? 'shiny' : null, wantSpecies].filter(Boolean).join(' ')}`)

const HEX = '0123456789abcdef'
const start = performance.now()
let attempts = 0

// Generate random 36-char UUID-like strings (matching accountUuid format)
function randomUuid() {
  const s = new Array(36)
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) { s[i] = '-'; continue }
    s[i] = HEX[(Math.random() * 16) | 0]
  }
  return s.join('')
}

while (true) {
  attempts++
  const candidate = randomUuid()
  const key = candidate + SALT
  const hash = hashString(key)
  const rng = mulberry32(hash)
  const result = rollFrom(rng)

  if (wantRarity && result.rarity !== wantRarity) continue
  if (wantSpecies && result.species !== wantSpecies) continue
  if (wantShiny && !result.shiny) continue

  const elapsed = ((performance.now() - start) / 1000).toFixed(2)
  console.log(JSON.stringify({ userid: candidate, ...result, attempts, elapsed_sec: elapsed }))
  break
}
