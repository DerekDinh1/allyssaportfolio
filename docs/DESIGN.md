# Design Contract — Allyssa Portfolio

Animal Crossing: New Horizons–inspired website presenting Allyssa's life as a
stay-at-home mom, ending on a surprise: **she got a job starting October 4th.**

This file is the coordination contract. Every worker reads it; nobody edits it
except the orchestrator.

---

## 1. Hard technical constraints

| Constraint | Rule |
|---|---|
| Stack | **Vanilla HTML + CSS + JS. No framework, no bundler, no build step.** |
| Hosting | GitHub Pages, static files served from repo root |
| Paths | **Relative only** (`assets/...`, `./index.html`). Never absolute `/assets`. |
| Entry | `index.html` at repo root |
| Jekyll | `.nojekyll` present at root |
| Fonts | Google Fonts CDN: **Baloo 2** (UI/display) + **Nunito** (body) + **Caveat** (handwriting) |
| Images | SVG preferred; raster photos go in `assets/photos/` |
| Browser floor | Evergreen Chrome/Safari/Firefox; iOS Safari must work |
| A11y | Semantic landmarks, visible focus rings, `prefers-reduced-motion` honored, alt text on all images |

Rationale: GitHub Pages serves static files directly. A build step adds a
failure mode (and a CI dependency) for zero benefit at this scale.

---

## 2. File ownership — prevents conflicting edits

**One writer per file. No exceptions.** If you need a change in a file you do
not own, write it into your own file or report it to the orchestrator.

| Path | Owner |
|---|---|
| `assets/tokens.css` | orchestrator (read-only for everyone else) |
| `assets/base.css` | orchestrator (read-only for everyone else) |
| `docs/DESIGN.md` | orchestrator |
| `tools/*` | orchestrator |
| `assets/allyssa-stand.svg` | character worker |
| `assets/allyssa-desk.svg` | character worker |
| `assets/office-bg.svg` | scene worker |
| `assets/leaf.svg` | scene worker |
| `assets/base-extra.css` | garnish worker |
| `mockups/sections/<n>-<slug>.html` | **one dedicated worker per file** |
| `index.html`, `assets/app.js` | production worker (Wave 3) |
| `assets/photos/*` | supplied by Allyssa/Derek |

---

## 3. Asset interfaces (frozen)

Consumers reference these by path; do not depend on internal markup.

| Asset | viewBox | Intended use |
|---|---|---|
| `assets/allyssa-stand.svg` | `0 0 360 560` | full body, standing, feet at bottom edge, centered on x=180 |
| `assets/allyssa-desk.svg` | `0 0 360 420` | waist-up, for placing behind a desk; bottom edge is the desk line |
| `assets/office-bg.svg` | `0 0 1600 900` | Resident Services interior backdrop, `preserveAspectRatio="xMidYMid slice"` |
| `assets/leaf.svg` | `0 0 64 64` | the ACNH leaf mark |

Character reference (from the supplied screenshot): dark brown chin-length bob
with straight bangs, **closed happy eyes** (upward-curving arcs), big open
smile, rosy cheeks, warm tan skin, cream pinafore dress with a **bear-face
applique** on the chest, white puff-sleeve tee underneath, gray sneakers.
Floating pink flower petals around the head. Keep it cute, soft-edged, and
**original vector art** — do not trace or embed copyrighted game assets.

---

## 4. Design tokens

All color/type/space/motion values live in `assets/tokens.css` as `--ac-*`
custom properties. **Never hardcode a hex value in a section file.** Pull from
the tokens.

Signature values:

- Dialogue cream `--ac-cream #FBF6E0`, ink `--ac-ink #7B5B43`
- Nametag chip `--ac-chip #EAE6A0` (white text, soft brown text-shadow)
- Pink highlight `--ac-pink #F2A0B6` · roses/alert `--ac-pink-deep #E0536B`
- Leaf green `--ac-leaf #7EC850` · sky `--ac-sky #8ED4F0` · Nook blue `#3FA9DC`
- Wood ramp `--ac-wood-light #D9A96C` → `--ac-wood-deep #5E4022`

---

## 5. Component contract

Reusable primitives in `assets/base.css` — **use these class names, do not
reimplement them**:

`.ac-wrap` `.ac-stack` `.ac-center`
`.ac-box` + `.ac-namechip` + `.ac-next` + `.ac-caret` (dialogue box)
`.ac-hl` `.ac-hl-g` (inline emphasis)
`.ac-btn` `.ac-key--a|b|x|y` (button prompts)
`.ac-card` `.ac-tag` `.ac-tag--pink|blue|gold`
`.ac-heading` `.ac-leaf`
`.ac-petals` `.ac-petal` (ambient flower particles)
`.ac-ticket` `.ac-stamp` (Nook Miles cardboard + wax stamp)
`.ac-sr` (screen-reader only) `.ac-pop` (entrance pop)

---

## 6. Motion rules

- Everything bounces: `--ease-bounce: cubic-bezier(.34,1.56,.64,1)`.
- Nothing animates linearly. Nothing animates faster than 150ms.
- Scroll reveals: enter with a small upward pop + fade, staggered ~70ms.
- Ambient petals always drift slowly in the background.
- `prefers-reduced-motion: reduce` ⇒ kill transform/opacity animation, keep content legible.
- No autoplaying audio (browser policy). Audio requires a user gesture gate —
  which is conveniently ACNH-authentic ("Press Ⓐ to start").

---

## 7. Mockup rules (Wave 2)

Deliverable per worker: **one** `mockups/sections/<n>-<slug>.html` that is
self-contained enough to screenshot standalone.

- Link shared CSS with relative paths: `../../assets/tokens.css`, `../../assets/base.css`.
- Load Google Fonts via `<link>`.
- Fixed design width **1440×900** (desktop, 16:9 — this doubles as the
  presentation aspect ratio). Must also not break at 390px wide.
- Reference assets by relative path (`../../assets/allyssa-stand.svg` inside `<img>`).
- Include a faint `DATA: MOCKUP` corner badge so nobody mistakes it for final.
- Content: use **clearly-marked placeholder copy** where real facts/photos are
  pending. Prefer obviously-fake placeholders (`[FACT PENDING]`) over invented
  personal details.

---

## 8. Section map (the six scenes)

| # | Slug | Purpose |
|---|---|---|
| 1 | `opening` | Hero: Resident Services interior, Allyssa at the desk, ACNH announcement dialogue box |
| 2 | `schedule` | "A Day in the Life" — hour-by-hour timeline cards |
| 3 | `inventory` | "Tools of the Trade" — ACNH inventory grid, click for item description |
| 4 | `stats` | "Resident Stats" — Nook Miles achievement tickets, animated counters |
| 5 | `gallery` | "Critterpedia" photo gallery — placeholders for photos supplied later |
| 6 | `reveal` | The surprise: Allyssa got a job, starting **October 4th** |
