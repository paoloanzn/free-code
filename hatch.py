#!/usr/bin/env python3
"""
Buddy Hatchery — a toy reimplementation of the Claude Code companion algorithm.

Reverse-engineered from the Claude Code 2.1.89 binary. Uses the same:
  - Bun.hash (wyhash) for string → uint32 seeding (requires `bun` CLI)
  - SplitMix32 PRNG  (uint32 → float sequence)
  - Lookup tables, weights, stat formulas, and ASCII art

Usage:
  python hatch.py                         # random seed
  python hatch.py "my-seed"               # specific seed
  python hatch.py --hunt legendary        # brute-force search for a target rarity
  python hatch.py --hunt shiny            # find any shiny
  python hatch.py --hunt "legendary shiny"  # the holy grail
  python hatch.py --crack "legendary shiny dragon"  # find a userID to inject
"""

from __future__ import annotations

import sys
import os
import json
import random
import shutil
import string
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Callable

# ── Constants (extracted from binary) ────────────────────────────────────────

SALT = "friend-2026-401"

SPECIES = [
    "duck", "goose", "blob", "cat", "dragon", "octopus", "owl", "penguin",
    "turtle", "snail", "ghost", "axolotl", "capybara", "cactus", "robot",
    "rabbit", "mushroom", "chonk",
]

EYES = ["·", "✦", "×", "◉", "@", "°"]

HATS = ["none", "crown", "tophat", "propeller", "halo", "wizard", "beanie", "tinyduck"]

# Hat art overlays (12 chars wide, matching body line width)
HAT_ART = {
    "none":      "",
    "crown":     "   \\^^^/    ",
    "tophat":    "   [___]    ",
    "propeller": "    -+-     ",
    "halo":      "   (   )    ",
    "wizard":    "    /^\\     ",
    "beanie":    "   (___)    ",
    "tinyduck":  "    ,>      ",
}

RARITIES = ["common", "uncommon", "rare", "epic", "legendary"]

RARITY_WEIGHTS = {"common": 60, "uncommon": 25, "rare": 10, "epic": 4, "legendary": 1}

RARITY_STARS = {
    "common": "★", "uncommon": "★★", "rare": "★★★",
    "epic": "★★★★", "legendary": "★★★★★",
}

RARITY_COLORS = {
    "common": "\033[90m",          # gray
    "uncommon": "\033[32m",        # green
    "rare": "\033[35m",            # magenta
    "epic": "\033[33m",            # yellow
    "legendary": "\033[38;5;208m", # orange
}

STAT_NAMES = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"]

STAT_BUDGETS = {"common": 5, "uncommon": 15, "rare": 25, "epic": 35, "legendary": 50}

FALLBACK_NAMES = ["Crumpet", "Soup", "Pickle", "Biscuit", "Moth", "Gravy"]

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
ITALIC = "\033[3m"
SHINY_COLOR = "\033[93m"

# ── Species ASCII art (extracted from binary) ───────────────────────────────
# Each species has 3 animation frames, each frame is 5 lines of 12 chars.
# {E} is replaced with the companion's eye character at render time.

SPECIES_ART: dict[str, list[list[str]]] = {
    "duck": [
        ["            ", "    __      ", "  <({E} )___  ", "   (  ._>   ", "    `--´    "],
        ["            ", "    __      ", "  <({E} )___  ", "   (  ._>   ", "    `--´~   "],
        ["            ", "    __      ", "  <({E} )___  ", "   (  .__>  ", "    `--´    "],
    ],
    "goose": [
        ["            ", "     ({E}>    ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
        ["            ", "    ({E}>     ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
        ["            ", "     ({E}>>   ", "     ||     ", "   _(__)_   ", "    ^^^^    "],
    ],
    "blob": [
        ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (      )  ", "   `----´   "],
        ["            ", "  .------.  ", " (  {E}  {E}  ) ", " (        ) ", "  `------´  "],
        ["            ", "    .--.    ", "   ({E}  {E})   ", "   (    )   ", "    `--´    "],
    ],
    "cat": [
        ["            ", "   /\\_/\\    ", "  ( {E}   {E})  ", "  (  ω  )   ", '  (")_(")   '],
        ["            ", "   /\\_/\\    ", "  ( {E}   {E})  ", "  (  ω  )   ", '  (")_(")~  '],
        ["            ", "   /\\-/\\    ", "  ( {E}   {E})  ", "  (  ω  )   ", '  (")_(")   '],
    ],
    "dragon": [
        ["            ", "  /^\\  /^\\  ", " <  {E}  {E}  > ", " (   ~~   ) ", "  `-vvvv-´  "],
        ["            ", "  /^\\  /^\\  ", " <  {E}  {E}  > ", " (        ) ", "  `-vvvv-´  "],
        ["   ~    ~   ", "  /^\\  /^\\  ", " <  {E}  {E}  > ", " (   ~~   ) ", "  `-vvvv-´  "],
    ],
    "octopus": [
        ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", "  /\\/\\/\\/\\  "],
        ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", "  \\/\\/\\/\\/  "],
        ["     o      ", "   .----.   ", "  ( {E}  {E} )  ", "  (______)  ", "  /\\/\\/\\/\\  "],
    ],
    "owl": [
        ["            ", "   /\\  /\\   ", "  (({E})({E}))  ", "  (  ><  )  ", "   `----´   "],
        ["            ", "   /\\  /\\   ", "  (({E})({E}))  ", "  (  ><  )  ", "   .----.   "],
        ["            ", "   /\\  /\\   ", "  (({E})(-))  ", "  (  ><  )  ", "   `----´   "],
    ],
    "penguin": [
        ["            ", "  .---.     ", "  ({E}>{E})     ", " /(   )\\    ", "  `---´     "],
        ["            ", "  .---.     ", "  ({E}>{E})     ", " |(   )|    ", "  `---´     "],
        ["  .---.     ", "  ({E}>{E})     ", " /(   )\\    ", "  `---´     ", "   ~ ~      "],
    ],
    "turtle": [
        ["            ", "   _,--._   ", "  ( {E}  {E} )  ", " /[______]\\ ", "  ``    ``  "],
        ["            ", "   _,--._   ", "  ( {E}  {E} )  ", " /[______]\\ ", "   ``  ``   "],
        ["            ", "   _,--._   ", "  ( {E}  {E} )  ", " /[======]\\ ", "  ``    ``  "],
    ],
    "snail": [
        ["            ", " {E}    .--.  ", "  \\  ( @ )  ", "   \\_`--´   ", "  ~~~~~~~   "],
        ["            ", "  {E}   .--.  ", "  |  ( @ )  ", "   \\_`--´   ", "  ~~~~~~~   "],
        ["            ", " {E}    .--.  ", "  \\  ( @  ) ", "   \\_`--´   ", "   ~~~~~~   "],
    ],
    "ghost": [
        ["            ", "   .----.   ", "  / {E}  {E} \\  ", "  |      |  ", "  ~`~``~`~  "],
        ["            ", "   .----.   ", "  / {E}  {E} \\  ", "  |      |  ", "  `~`~~`~`  "],
        ["    ~  ~    ", "   .----.   ", "  / {E}  {E} \\  ", "  |      |  ", "  ~~`~~`~~  "],
    ],
    "axolotl": [
        ["            ", "}~(______)~{", "}~({E} .. {E})~{", "  ( .--. )  ", "  (_/  \\_)  "],
        ["            ", "~}(______){~", "~}({E} .. {E}){~", "  ( .--. )  ", "  (_/  \\_)  "],
        ["            ", "}~(______)~{", "}~({E} .. {E})~{", "  (  --  )  ", "  ~_/  \\_~  "],
    ],
    "capybara": [
        ["            ", "  n______n  ", " ( {E}    {E} ) ", " (   oo   ) ", "  `------´  "],
        ["            ", "  n______n  ", " ( {E}    {E} ) ", " (   Oo   ) ", "  `------´  "],
        ["    ~  ~    ", "  u______n  ", " ( {E}    {E} ) ", " (   oo   ) ", "  `------´  "],
    ],
    "cactus": [
        ["            ", " n  ____  n ", " | |{E}  {E}| | ", " |_|    |_| ", "   |    |   "],
        ["            ", "    ____    ", " n |{E}  {E}| n ", " |_|    |_| ", "   |    |   "],
        [" n        n ", " |  ____  | ", " | |{E}  {E}| | ", " |_|    |_| ", "   |    |   "],
    ],
    "robot": [
        ["            ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ ==== ]  ", "  `------´  "],
        ["            ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ -==- ]  ", "  `------´  "],
        ["     *      ", "   .[||].   ", "  [ {E}  {E} ]  ", "  [ ==== ]  ", "  `------´  "],
    ],
    "rabbit": [
        ["            ", "   (\\__/)   ", "  ( {E}  {E} )  ", " =(  ..  )= ", '  (")__(")  '],
        ["            ", "   (|__/)   ", "  ( {E}  {E} )  ", " =(  ..  )= ", '  (")__(")  '],
        ["            ", "   (\\__/)   ", "  ( {E}  {E} )  ", " =( .  . )= ", '  (")__(")  '],
    ],
    "mushroom": [
        ["            ", " .-o-OO-o-. ", "(__________)","   |{E}  {E}|   ", "   |____|   "],
        ["            ", " .-O-oo-O-. ", "(__________)","   |{E}  {E}|   ", "   |____|   "],
        ["   . o  .   ", " .-o-OO-o-. ", "(__________)","   |{E}  {E}|   ", "   |____|   "],
    ],
    "chonk": [
        ["            ", "  /\\    /\\  ", " ( {E}    {E} ) ", " (   ..   ) ", "  `------´  "],
        ["            ", "  /\\    /|  ", " ( {E}    {E} ) ", " (   ..   ) ", "  `------´  "],
        ["            ", "  /\\    /\\  ", " ( {E}    {E} ) ", " (   ..   ) ", "  `------´~ "],
    ],
}


# ── Hashing ─────────────────────────────────────────────────────────────────

def _has_bun() -> bool:
    return shutil.which("bun") is not None


def bun_hash(s: str) -> int:
    """Compute Bun.hash(s) & 0xFFFFFFFF — the real hash used by Claude Code."""
    result = subprocess.run(
        ["bun", "-e", f"process.stdout.write(String(Number(BigInt(Bun.hash({json.dumps(s)}))&0xffffffffn)))"],
        capture_output=True, text=True, timeout=5,
    )
    return int(result.stdout.strip())


def bun_hash_batch(strings: list[str]) -> list[int]:
    """Hash multiple strings in a single Bun process for performance."""
    script = (
        "const inputs = " + json.dumps(strings) + ";\n"
        "for (const s of inputs) process.stdout.write(String(Number(BigInt(Bun.hash(s))&0xffffffffn)) + '\\n');\n"
    )
    result = subprocess.run(
        ["bun", "-e", script], capture_output=True, text=True, timeout=30,
    )
    return [int(line) for line in result.stdout.strip().split("\n")]


def fnv1a_hash(s: str) -> int:
    """FNV-1a hash: fallback when Bun is not available."""
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def hash_string(s: str) -> int:
    """Hash a string to uint32 using Bun.hash (preferred) or FNV-1a (fallback)."""
    if _has_bun():
        return bun_hash(s)
    return fnv1a_hash(s)


def splitmix32(seed: int) -> Callable[[], float]:
    """SplitMix32 PRNG: uint32 seed → callable that returns floats in [0, 1)."""
    state = seed & 0xFFFFFFFF

    def next_float() -> float:
        nonlocal state
        state = (state + 1831565813) & 0xFFFFFFFF
        q = _imul(state ^ (state >> 15), 1 | state) & 0xFFFFFFFF
        q = (q + _imul(q ^ (q >> 7), 61 | q)) ^ q
        q &= 0xFFFFFFFF
        return ((q ^ (q >> 14)) & 0xFFFFFFFF) / 4294967296

    return next_float


def _imul(a: int, b: int) -> int:
    """Emulate JS Math.imul — 32-bit integer multiply."""
    a, b = a & 0xFFFFFFFF, b & 0xFFFFFFFF
    result = (a * b) & 0xFFFFFFFF
    if result >= 0x80000000:
        result -= 0x100000000
    return result & 0xFFFFFFFF


# ── Companion generation ────────────────────────────────────────────────────

def pick(rng: Callable[[], float], items: list):
    """Pick a random element from a list using the PRNG."""
    return items[int(rng() * len(items))]


def weighted_pick_rarity(rng: Callable[[], float]) -> str:
    """Weighted random pick for rarity tier."""
    total = sum(RARITY_WEIGHTS.values())
    roll = rng() * total
    for rarity in RARITIES:
        roll -= RARITY_WEIGHTS[rarity]
        if roll < 0:
            return rarity
    return "common"


def derive_stats(rng: Callable[[], float], rarity: str) -> dict[str, int]:
    """Generate stats with two spotlight stats — one boosted, one dipped."""
    budget = STAT_BUDGETS[rarity]
    primary = pick(rng, STAT_NAMES)

    secondary = pick(rng, STAT_NAMES)
    while secondary == primary:
        secondary = pick(rng, STAT_NAMES)

    stats = {}
    for name in STAT_NAMES:
        if name == primary:
            stats[name] = min(100, budget + 50 + int(rng() * 30))
        elif name == secondary:
            stats[name] = max(1, budget - 10 + int(rng() * 15))
        else:
            stats[name] = budget + int(rng() * 40)
    return stats


def render_body(species: str, eye: str, hat: str, frame: int = 0) -> list[str]:
    """Render species ASCII art with eye and hat substitution."""
    frames = SPECIES_ART.get(species, SPECIES_ART["blob"])
    art = frames[frame % len(frames)]
    lines = [line.replace("{E}", eye) for line in art]
    if hat != "none" and not lines[0].strip():
        lines = list(lines)
        lines[0] = HAT_ART.get(hat, lines[0])
    return lines


@dataclass(frozen=True)
class Companion:
    rarity: str
    species: str
    eye: str
    hat: str
    shiny: bool
    stats: dict[str, int]
    seed_name: str
    fallback_name: str

    @property
    def stars(self) -> str:
        return RARITY_STARS[self.rarity]


def hatch(seed_string: str) -> Companion:
    """Derive a companion from a seed string using the exact Claude Code algorithm."""
    salted = seed_string + SALT
    seed = hash_string(salted)
    rng = splitmix32(seed)

    rarity = weighted_pick_rarity(rng)
    species = pick(rng, SPECIES)
    eye = pick(rng, EYES)
    hat = "none" if rarity == "common" else pick(rng, HATS)
    shiny = rng() < 0.01
    stats = derive_stats(rng, rarity)

    _inspiration_seed = int(rng() * 1e9)
    fallback_idx = (ord(species[0]) + ord(eye[0])) % len(FALLBACK_NAMES)

    return Companion(
        rarity=rarity,
        species=species,
        eye=eye,
        hat=hat,
        shiny=shiny,
        stats=stats,
        seed_name=seed_string,
        fallback_name=FALLBACK_NAMES[fallback_idx],
    )


# ── Display ─────────────────────────────────────────────────────────────────

CARD_W = 40  # inner width between │ borders


def stat_bar(value: int, width: int = 10) -> str:
    filled = min(width, round(value / 100 * width))
    return "█" * filled + "░" * (width - filled)


def _pad(text: str, width: int) -> str:
    """Pad a string that may contain ANSI codes to a visual width."""
    import re
    visible = re.sub(r"\033\[[0-9;]*m", "", text)
    return text + " " * max(0, width - len(visible))


def print_companion(companion: Companion, *, compact: bool = False) -> None:
    c = RARITY_COLORS[companion.rarity]

    print()
    print(f"  {DIM}seed: {companion.seed_name!r}{RESET}")
    print(f"  ┌{'─' * CARD_W}┐")

    # ── Header: stars + RARITY (left)   SPECIES (right)
    rarity_label = f"{companion.stars} {BOLD}{companion.rarity.upper()}{RESET}{c}"
    species_label = f"{BOLD}{companion.species.upper()}{RESET}{c}"
    header = f"  │ {c}{_pad(rarity_label, 24)}{_pad(species_label, 14)}{RESET} │"
    print(header)

    # ── Body art
    body = render_body(companion.species, companion.eye, companion.hat)
    print(f"  │{' ' * CARD_W}│")
    for line in body:
        # Center the 12-char art in the card
        padded = line.center(CARD_W)
        print(f"  │{c}{padded}{RESET}│")

    # ── Name + personality
    print(f"  │{' ' * CARD_W}│")
    name_line = f"  {BOLD}{companion.fallback_name}{RESET}"
    print(f"  │{_pad(name_line, CARD_W)}│")
    personality = f"  {ITALIC}\"A {companion.rarity} {companion.species} of few words.\"{RESET}"
    print(f"  │{_pad(personality, CARD_W)}│")

    # ── Shiny badge
    if companion.shiny:
        shiny_line = f"  {SHINY_COLOR}{BOLD}✨ SHINY ✨{RESET}"
        print(f"  │{_pad(shiny_line, CARD_W)}│")

    # ── Stats
    print(f"  │{' ' * CARD_W}│")
    for name, value in companion.stats.items():
        bar = stat_bar(value)
        stat_line = f"  {name:<10} {bar} {value:>3}"
        print(f"  │{stat_line:<{CARD_W}}│")

    print(f"  └{'─' * CARD_W}┘")
    print()


# ── Interactive selection ───────────────────────────────────────────────────

RARITY_ODDS_LABEL = {
    "common": "60%", "uncommon": "25%", "rare": "10%", "epic": "4%", "legendary": "1%",
}


def _select_one(
    title: str,
    options: list[str],
    *,
    extras: dict[str, str] | None = None,
    columns: int = 1,
    allow_any: bool = True,
) -> str | None:
    """Display a numbered menu and return the selected value, or None for 'any'."""
    print(f"\n  {BOLD}{title}{RESET}")

    items = list(options)
    labeled: list[tuple[int, str, str]] = []
    if allow_any:
        labeled.append((0, "any", ""))

    for i, item in enumerate(items, start=1):
        extra = f"  {DIM}({extras[item]}){RESET}" if extras and item in extras else ""
        labeled.append((i, item, extra))

    if columns == 1:
        for num, name, extra in labeled:
            print(f"    {DIM}{num:>2}.{RESET} {name}{extra}")
    else:
        row: list[str] = []
        for num, name, extra in labeled:
            cell = f"{DIM}{num:>2}.{RESET} {name:<12}{extra}"
            row.append(cell)
            if len(row) >= columns:
                print(f"    {''.join(row)}")
                row = []
        if row:
            print(f"    {''.join(row)}")

    while True:
        try:
            raw = input(f"  {DIM}>{RESET} ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            sys.exit(0)

        if not raw:
            continue

        try:
            choice = int(raw)
        except ValueError:
            # Allow typing the name directly
            raw_lower = raw.lower()
            for item in items:
                if item.lower() == raw_lower:
                    return item
            if allow_any and raw_lower == "any":
                return None
            print(f"    {DIM}invalid, try again{RESET}")
            continue

        if allow_any and choice == 0:
            return None
        if 1 <= choice <= len(items):
            return items[choice - 1]

        print(f"    {DIM}invalid, try again{RESET}")


def _confirm(prompt: str, default: bool = False) -> bool:
    """Simple y/N confirmation prompt."""
    hint = "Y/n" if default else "y/N"
    print(f"\n  {BOLD}{prompt}{RESET} [{hint}]")
    try:
        raw = input(f"  {DIM}>{RESET} ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        sys.exit(0)

    if not raw:
        return default
    return raw in ("y", "yes")


def _interactive_select(mode: str = "crack") -> dict[str, object]:
    """Interactive trait selection menu. Returns a dict of desired traits."""
    print(f"\n  {BOLD}🥚 Buddy Hatchery — {mode.title()} Mode{RESET}")

    want: dict[str, object] = {}

    # Rarity
    rarity = _select_one("Rarity:", RARITIES, extras=RARITY_ODDS_LABEL)
    if rarity:
        want["rarity"] = rarity

    # Species
    species = _select_one("Species:", SPECIES, columns=3)
    if species:
        want["species"] = species

    # Shiny
    if _confirm("Shiny? (1% chance)"):
        want["shiny"] = True

    # Hat (optional for crack, skip for hunt)
    if mode == "crack":
        hat = _select_one("Hat:", [h for h in HATS if h != "none"], allow_any=True)
        if hat:
            want["hat"] = hat

        # Eye
        eye = _select_one("Eye:", EYES, allow_any=True)
        if eye:
            want["eye"] = eye

    if not want:
        print(f"\n  {DIM}No traits selected — hatching random companion instead{RESET}")
        return {}

    # Summary
    parts = []
    if "rarity" in want:
        parts.append(f"{RARITY_COLORS[want['rarity']]}{want['rarity']}{RESET}")
    if want.get("shiny"):
        parts.append(f"{SHINY_COLOR}shiny{RESET}")
    if "species" in want:
        parts.append(str(want["species"]))
    if "hat" in want:
        parts.append(f"hat:{want['hat']}")
    if "eye" in want:
        parts.append(f"eye:{want['eye']}")

    print(f"\n  Target: {' '.join(parts)}")

    return want


def _want_to_target_string(want: dict[str, object]) -> str:
    """Convert a want dict to a target string for hunt/crack compatibility."""
    parts = []
    if "rarity" in want:
        parts.append(str(want["rarity"]))
    if want.get("shiny"):
        parts.append("shiny")
    if "species" in want:
        parts.append(str(want["species"]))
    return " ".join(parts)


# ── Hunt mode ───────────────────────────────────────────────────────────────

def hunt(target: str | None = None, max_attempts: int = 1_000_000) -> None:
    """Brute-force search for a companion matching the target criteria."""
    if target is None:
        want = _interactive_select(mode="hunt")
        if not want:
            return
        target = _want_to_target_string(want)

    want_shiny = "shiny" in target.lower()
    want_rarity = None
    want_species = None

    for r in RARITIES:
        if r in target.lower():
            want_rarity = r
            break

    for s in SPECIES:
        if s in target.lower():
            want_species = s
            break

    use_bun = _has_bun()
    batch_size = 500 if use_bun else 1
    print(f"  {DIM}Hunting for: {target}... (hash: {'bun' if use_bun else 'fnv1a'}){RESET}")
    found = 0
    checked = 0

    while checked < max_attempts and found < 3:
        seeds = [
            "".join(random.choices(string.ascii_lowercase + string.digits, k=12))
            for _ in range(batch_size)
        ]
        salted = [s + SALT for s in seeds]

        if use_bun:
            hashes = bun_hash_batch(salted)
        else:
            hashes = [fnv1a_hash(s) for s in salted]

        for seed_str, h in zip(seeds, hashes):
            checked += 1
            rng = splitmix32(h)

            rarity = weighted_pick_rarity(rng)
            if want_rarity and rarity != want_rarity:
                continue
            species = pick(rng, SPECIES)
            if want_species and species != want_species:
                continue
            eye = pick(rng, EYES)
            hat = "none" if rarity == "common" else pick(rng, HATS)
            shiny = rng() < 0.01
            if want_shiny and not shiny:
                continue

            stats = derive_stats(rng, rarity)
            _inspiration = int(rng() * 1e9)
            fallback_idx = (ord(species[0]) + ord(eye[0])) % len(FALLBACK_NAMES)
            comp = Companion(
                rarity=rarity, species=species, eye=eye, hat=hat, shiny=shiny,
                stats=stats, seed_name=seed_str, fallback_name=FALLBACK_NAMES[fallback_idx],
            )
            found += 1
            print(f"  {BOLD}Found #{found} after {checked:,} attempts!{RESET}")
            print_companion(comp)
            if found >= 3:
                break

    if found == 0:
        print(f"  No match in {max_attempts:,} attempts. The RNG gods are cruel.")


# ── Crack mode ──────────────────────────────────────────────────────────────
#
# Runs the full crack in a Bun script for native performance:
#   - Generate random 64-char hex userIDs
#   - Hash with Bun.hash (wyhash) — the real Claude Code hash
#   - Run SplitMix32 PRNG forward
#   - Check if derived traits match the target
#   - Output the first matching userID

_CRACK_SCRIPT_TEMPLATE = r"""
// Buddy Cracker — generated by hatch.py
// SplitMix32 PRNG (exact match of Claude Code binary)
function splitmix32(seed) {
  let state = seed >>> 0;
  return function() {
    state = (state + 1831565813) | 0;
    let q = Math.imul(state ^ (state >>> 15), 1 | state);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

const SALT = "friend-2026-401";
const SPECIES = %%SPECIES%%;
const EYES = %%EYES%%;
const HATS = %%HATS%%;
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];
const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };
const STAT_NAMES = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"];
const STAT_BUDGETS = { common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 };
const FALLBACK_NAMES = ["Crumpet", "Soup", "Pickle", "Biscuit", "Moth", "Gravy"];
const HEX = "0123456789abcdef";

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

function weightedRarity(rng) {
  const total = 100;
  let roll = rng() * total;
  for (const r of RARITIES) { roll -= RARITY_WEIGHTS[r]; if (roll < 0) return r; }
  return "common";
}

function deriveStats(rng, rarity) {
  const budget = STAT_BUDGETS[rarity];
  const primary = pick(rng, STAT_NAMES);
  let secondary = pick(rng, STAT_NAMES);
  while (secondary === primary) secondary = pick(rng, STAT_NAMES);
  const stats = {};
  for (const name of STAT_NAMES) {
    if (name === primary) stats[name] = Math.min(100, budget + 50 + Math.floor(rng() * 30));
    else if (name === secondary) stats[name] = Math.max(1, budget - 10 + Math.floor(rng() * 15));
    else stats[name] = budget + Math.floor(rng() * 40);
  }
  return stats;
}

function randomHex64() {
  let s = "";
  for (let i = 0; i < 64; i++) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}

// Target criteria
const WANT_RARITY = %%WANT_RARITY%%;
const WANT_SPECIES = %%WANT_SPECIES%%;
const WANT_SHINY = %%WANT_SHINY%%;
const WANT_HAT = %%WANT_HAT%%;
const WANT_EYE = %%WANT_EYE%%;
const MAX_ATTEMPTS = %%MAX_ATTEMPTS%%;

let attempts = 0;
const startTime = Date.now();

while (attempts < MAX_ATTEMPTS) {
  attempts++;
  const uid = randomHex64();
  const hash = Number(BigInt(Bun.hash(uid + SALT)) & 0xffffffffn);
  const rng = splitmix32(hash);

  const rarity = weightedRarity(rng);
  if (WANT_RARITY && rarity !== WANT_RARITY) continue;

  const species = pick(rng, SPECIES);
  if (WANT_SPECIES && species !== WANT_SPECIES) continue;

  const eye = pick(rng, EYES);
  if (WANT_EYE && eye !== WANT_EYE) continue;

  const hat = rarity === "common" ? "none" : pick(rng, HATS);
  if (WANT_HAT && hat !== WANT_HAT) continue;

  const shiny = rng() < 0.01;
  if (WANT_SHINY && !shiny) continue;

  const stats = deriveStats(rng, rarity);
  const _inspiration = Math.floor(rng() * 1e9);
  const fbIdx = (species.charCodeAt(0) + eye.charCodeAt(0)) % FALLBACK_NAMES.length;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const result = {
    userid: uid, rarity, species, eye, hat, shiny, stats,
    fallback_name: FALLBACK_NAMES[fbIdx],
    attempts, elapsed_sec: parseFloat(elapsed),
  };
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}

process.stderr.write(`No match in ${MAX_ATTEMPTS.toLocaleString()} attempts\n`);
process.exit(1);
"""


def crack(target: str | None = None) -> None:
    """Find a 64-char hex userID that produces the desired companion."""
    if not _has_bun():
        print("  --crack requires Bun. Install from https://bun.sh")
        return

    if target is None:
        want_dict = _interactive_select(mode="crack")
        if not want_dict:
            return
        want_rarity = want_dict.get("rarity")
        want_species = want_dict.get("species")
        want_shiny = bool(want_dict.get("shiny"))
        # hat and eye from interactive mode (crack-only extras)
        want_hat = want_dict.get("hat")
        want_eye = want_dict.get("eye")
    else:
        target_lower = target.lower()
        want_rarity = None
        want_species = None
        want_shiny = "shiny" in target_lower
        want_hat = None
        want_eye = None

        for r in RARITIES:
            if r in target_lower:
                want_rarity = r
                break
        for s in SPECIES:
            if s in target_lower:
                want_species = s
                break

    if not want_rarity and not want_species and not want_shiny:
        print(f"  Specify at least one trait: {', '.join(RARITIES + SPECIES + ['shiny'])}")
        return

    odds = 1.0
    if want_rarity:
        odds *= RARITY_WEIGHTS[want_rarity] / 100
    if want_species:
        odds *= 1 / len(SPECIES)
    if want_shiny:
        odds *= 0.01
    if want_hat:
        odds *= 1 / len(HATS)
    if want_eye:
        odds *= 1 / len(EYES)

    expected = int(1 / odds) if odds > 0 else 999999
    max_attempts = max(expected * 20, 5_000_000)

    label_parts = [p for p in [want_rarity, "shiny" if want_shiny else None, want_species, f"hat:{want_hat}" if want_hat else None, f"eye:{want_eye}" if want_eye else None] if p]
    print(f"  {DIM}Cracking: {' '.join(label_parts)}{RESET}")
    print(f"  {DIM}Odds: ~1/{expected:,} per attempt — using Bun.hash (native speed){RESET}")
    print(f"  {DIM}Searching up to {max_attempts:,} candidates...{RESET}")
    print()

    # Generate and run Bun script
    script = _CRACK_SCRIPT_TEMPLATE
    script = script.replace("%%SPECIES%%", json.dumps(SPECIES))
    script = script.replace("%%EYES%%", json.dumps(EYES))
    script = script.replace("%%HATS%%", json.dumps(HATS))
    script = script.replace("%%WANT_RARITY%%", json.dumps(want_rarity) if want_rarity else "null")
    script = script.replace("%%WANT_SPECIES%%", json.dumps(want_species) if want_species else "null")
    script = script.replace("%%WANT_SHINY%%", "true" if want_shiny else "false")
    script = script.replace("%%WANT_HAT%%", json.dumps(want_hat) if want_hat else "null")
    script = script.replace("%%WANT_EYE%%", json.dumps(want_eye) if want_eye else "null")
    script = script.replace("%%MAX_ATTEMPTS%%", str(max_attempts))

    with tempfile.NamedTemporaryFile(mode="w", suffix=".mjs", delete=False) as f:
        f.write(script)
        script_path = f.name

    try:
        result = subprocess.run(
            ["bun", "run", script_path],
            capture_output=True, text=True, timeout=120,
        )

        if result.returncode != 0:
            print(f"  {result.stderr.strip()}")
            return

        data = json.loads(result.stdout.strip())
    finally:
        os.unlink(script_path)

    # Verify and display
    userid = data["userid"]
    print(f"  {BOLD}Cracked in {data['attempts']:,} attempts ({data['elapsed_sec']}s){RESET}")

    comp = Companion(
        rarity=data["rarity"], species=data["species"], eye=data["eye"],
        hat=data["hat"], shiny=data["shiny"], stats=data["stats"],
        seed_name=userid, fallback_name=data["fallback_name"],
    )
    print_companion(comp)

    # Verify with our own pipeline
    verified = hatch(userid)
    if verified.rarity != comp.rarity or verified.species != comp.species:
        print(f"  {BOLD}WARNING: verification mismatch — hash inconsistency{RESET}")
    else:
        print(f"  {DIM}Verified: hatch(userID) matches Bun output{RESET}")

    print()
    print(f"  {BOLD}Your cracked userID:{RESET}")
    print(f"  {RARITY_COLORS[comp.rarity]}{userid}{RESET}")
    print()
    print(f"  {DIM}To apply: edit .claude.json (usually ~/.claude/.claude.json or ~/.claude.json){RESET}")
    print(f"  {DIM}  1. Set \"userID\" to the value above{RESET}")
    print(f"  {DIM}  2. Delete the \"companion\" key{RESET}")
    print(f"  {DIM}  3. Run /buddy to re-hatch{RESET}")
    print()


# ── Main ────────────────────────────────────────────────────────────────────

def main() -> None:
    args = sys.argv[1:]

    if len(args) >= 1 and args[0] == "--hunt":
        rest = " ".join(args[1:]).strip()
        hunt(rest if rest else None)
    elif len(args) >= 1 and args[0] == "--crack":
        rest = " ".join(args[1:]).strip()
        crack(rest if rest else None)
    elif len(args) == 1 and not args[0].startswith("--"):
        print_companion(hatch(args[0]))
    elif len(args) == 0:
        seed = "".join(random.choices(string.ascii_lowercase + string.digits, k=10))
        print_companion(hatch(seed))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
