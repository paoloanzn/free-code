// Exact copy of companion.ts algorithm — verify what a UUID produces
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

function rollStats(rng, rarity) {
  const RARITY_FLOOR = { common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 }
  const floor = RARITY_FLOOR[rarity]
  const peak = pick(rng, STAT_NAMES)
  let dump = pick(rng, STAT_NAMES)
  while (dump === peak) dump = pick(rng, STAT_NAMES)
  const stats = {}
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30))
    } else if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15))
    } else {
      stats[name] = floor + Math.floor(rng() * 40)
    }
  }
  return stats
}

function rollFrom(rng) {
  const rarity = rollRarity(rng)
  const species = pick(rng, SPECIES)
  const eye = pick(rng, EYES)
  const hat = rarity === 'common' ? 'none' : pick(rng, HATS)
  const shiny = rng() < 0.01
  const stats = rollStats(rng, rarity)
  const inspirationSeed = Math.floor(rng() * 1e9)
  return { rarity, species, eye, hat, shiny, stats, inspirationSeed }
}

function roll(userId) {
  const key = userId + SALT
  const hash = hashString(key)
  const rng = mulberry32(hash)
  return rollFrom(rng)
}

// Verify the cracked UUID
const uuid = process.argv[2] || '8df629b4-c274-22d7-4b23-c2993422180d'
console.log('UUID:', uuid)
console.log('Key:', uuid + SALT)
console.log('Hash:', hashString(uuid + SALT))
console.log('Result:', JSON.stringify(roll(uuid), null, 2))
