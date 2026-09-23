# BUILD.md — Implementation Contract (frozen)

Owner: **architect**. Everyone else reads this and nobody else edits it. If you
need something changed here, report it to the orchestrator.

This file adds to `docs/DESIGN.md` and `docs/REVISION-BRIEF.md`; it does not
replace them. If they conflict, **this file wins on data and file ownership**,
and `REVISION-BRIEF.md` wins on product decisions.

Final structure, in page order: **opening → daily life → stats → photos → surprise.**
The inventory section has been removed.

---

## 1. Frozen file map (one writer per file)

Paths are relative to the repo root, which is also the GitHub Pages site root.

### 1a. Already exists — read-only during implementation

| Path | Owner | Notes |
|---|---|---|
| `docs/DESIGN.md`, `docs/REVISION-BRIEF.md` | orchestrator | product and design rules |
| `assets/tokens.css` | orchestrator | the only place hex values may appear |
| `assets/base.css` | orchestrator | shared `.ac-*` classes (DESIGN.md §5) |
| `assets/audio.js` | orchestrator | `window.ACSound` API (see header of that file) |
| `assets/config.js` | orchestrator | **legacy, used only by the mockups.** Production code MUST NOT read it. `content/site.json` replaces it. |
| `assets/office-bg.svg`, `assets/outdoor-bg.svg`, `assets/leaf.svg` | scene worker | backgrounds and the leaf mark |
| `assets/reference/allyssa-reference.jpg` | user-supplied | **the** character image (400×400). Never edit it, redraw it, or crop it. |
| `assets/allyssa-stand.svg`, `assets/allyssa-desk.svg` | character worker | **retired for Allyssa.** Do not use them to show her (see §6). |
| `mockups/**`, `tools/**` | orchestrator | visual reference only. Not deployed and not linked from `index.html`. |

### 1b. Architect-owned (this deliverable)

| Path | Owner |
|---|---|
| `content/site.json` | architect for the schema; **after launch the editor (via Pages CMS) owns the values** |
| `.pages.yml` | architect |
| `docs/BUILD.md` | architect |
| `assets/photos/.gitkeep` | architect. Photos uploaded later go in this folder and are written by Pages CMS. |

### 1c. To be created in the implementation phase (one owner each)

| Path | Owner | Responsibility |
|---|---|---|
| `index.html` | **shell worker** | The one page. Landmarks, empty section containers with the ids in §4, `<link>`/`<script>` tags in the order in §4, and the start gate markup. **No visitor-facing copy in HTML** apart from a `<noscript>` notice and the fallback `<title>`. |
| `.nojekyll` | shell worker | an empty file |
| `assets/site.css` | shell worker | page layout, start gate, section chrome, the portrait frame (`.ac-portrait`), the empty-state look, and nav/presentation mode. |
| `assets/content.js` | **data worker** | `window.ACContent`: loads the JSON, fills templates, provides the empty-state helpers (§4). No DOM layout of its own. |
| `assets/app.js` | **shell worker** | Boot sequence, start gate + `ACSound.init()`, keyboard presentation navigation, scroll reveals, and the edit link. Calls each section's `render`. |
| `assets/sections/opening.js` + `assets/sections/opening.css` | opening worker | section 1 |
| `assets/sections/daily.js` + `assets/sections/daily.css` | daily worker | section 2 |
| `assets/sections/stats.js` + `assets/sections/stats.css` | stats worker | section 3 |
| `assets/sections/gallery.js` + `assets/sections/gallery.css` | gallery worker | section 4 |
| `assets/sections/reveal.js` + `assets/sections/reveal.css` | reveal worker | section 5 (all five beats) |

A worker may own several rows, but each file has exactly one owner. Section CSS
must only style selectors under its own section root (`#opening …`, `#daily …`,
and so on). It must use `--ac-*` / `--sp-*` / `--r-*` / `--sh-*` / `--ease-*` /
`--t-*` tokens and no raw colors.

---

## 2. Hard rules (restated so workers need not look elsewhere)

- Vanilla HTML, CSS and JS only. No npm, bundler, framework or build step.
- **Relative paths only.** Never start a path with `/`. The site must work at
  `https://<user>.github.io/allyssaportfolio/` and at a local server root.
- Every color comes from an `--ac-*` token.
- Visitor-facing text comes **only** from `content/site.json`, including buttons
  and labels. The only exceptions are the `<noscript>` notice, the fallback
  `<title>`, and ARIA/alt strings built from JSON values.
- Accessibility requirements: `<header>`/`<main>`/`<footer>` landmarks, one `<h1>`, a
  section `<h2>` for each section, alt text on every `<img>`, a visible
  `:focus-visible` ring, and `prefers-reduced-motion: reduce` that turns
  off transform/opacity animation while keeping everything readable.
- No autoplaying audio. Sound starts only after the "Press A" gesture.

---

## 3. `content/site.json` — exact contract

Every value is a **string** or a **list** (array). There are no numbers or booleans, because Pages CMS
string fields round-trip safely. Keys are camelCase. **Code must tolerate any
key being missing, `null`, or `""`.** Treat all of those as empty. The CMS may
drop empty keys, and an editor may delete list items.

### 3a. Template tokens (for strings marked **T**)

`ACContent.fill(str, extra)` replaces these tokens:

| Token | Source |
|---|---|
| `{name}` | `site.name` |
| `{son}` | `site.son` |
| `{venue}` | `opening.venue` |
| `{years}` | `reveal.years` |
| `{startDate}` | `reveal.startDate` (printed **exactly as written**) |
| `{jobTitle}` | `reveal.jobTitle` |
| `{employer}` | `reveal.employer` |
| `{time}` `{weekday}` `{date}` | **only in `opening.announcement`**, built from `new Date()` when the line is shown (see §5) |

An unknown token or an empty value becomes `""`. `*text*` marks emphasis and
renders as `<span class="ac-hl">text</span>`. There is no other markup. Build
the output with `textContent` and `createElement` only. **Never assign JSON
text to `innerHTML`.**

### 3b. Key list

| Key | Type | Seed | Meaning / rendering rule |
|---|---|---|---|
| `site.title` | string | `"Allyssa's Island"` | `document.title`. If empty, keep the HTML fallback title. |
| `site.tagline` | string | `""` | optional line on the start gate. Hidden if empty. |
| `site.name` | string | `"Allyssa"` | her name → `{name}` |
| `site.son` | string | `"Keone"` | her son's name → `{son}` |
| `site.portrait` | string (path) | `"assets/reference/allyssa-reference.jpg"` | the framed character portrait (§6). Read-only in the CMS. |
| `site.portraitAlt` | string | `"Allyssa's character portrait"` | alt text for the portrait |
| `site.editUrl` | string (URL) | `""` | if it is not empty, the footer shows a small link labelled `ui.editLink`. It is hidden if empty. Never put a token here. |
| `ui.startPrompt` | string | `"Press A to start"` | start gate button. The "A" key chip is decoration (`.ac-key--a`). |
| `ui.startHint` | string | `"Tap, click, or press Enter"` | small hint under the start button |
| `ui.skipLink` | string | `"Skip to content"` | skip link that points at `#main` |
| `ui.next` | string | `"Next"` | dialogue advance button |
| `ui.keepGoing` | string | `"keep going"` | hint inside the dialogue box |
| `ui.replay` | string | `"Play it again"` | finale replay button |
| `ui.soundOn` / `ui.soundOff` | string | `"Sound on"` / `"Sound off"` | mute toggle label (shows the action the button will take) |
| `ui.editLink` | string | `"Edit content"` | text of the edit link |
| `ui.emptyEntry` | string | `"Waiting to be filled in"` | shown on a daily or stats card whose fields are all empty |
| `ui.emptyPhoto` | string | `"Photo coming soon"` | shown in a photo frame with no `image` |
| `ui.emptySection` | string | `"Nothing here yet — check back soon!"` | shown when a section's list is missing or has 0 items |
| `opening.speaker` | string **T** | `"{name}"` | name chip on the dialogue box |
| `opening.venue` | string | `"Thuy and Melissa's house"` | presentation venue → `{venue}` |
| `opening.announcement` | string **T** | `"Right now at *{venue}*, it's {time} on {weekday}, {date}."` | the first dialogue line, with the live date and time |
| `opening.dialogue[]` | list of string **T** | 4 lines (see file) | the following dialogue lines, in order. Empty strings are skipped. |
| `dailyLife.title` | string | `"A Day in the Life"` | section `<h2>` |
| `dailyLife.subtitle` | string | `""` | hidden if empty |
| `dailyLife.entries[]` | list of object | 8 × empty | timeline cards, in order |
| `dailyLife.entries[].time` | string | `""` | free text, **not parsed** |
| `dailyLife.entries[].title` | string | `""` | card heading |
| `dailyLife.entries[].detail` | string (multi-line) | `""` | card body. Newlines become line breaks. |
| `stats.title` | string | `"Resident Stats"` | section `<h2>` |
| `stats.subtitle` | string | `""` | hidden if empty |
| `stats.items[]` | list of object | 8 × empty | Nook Miles tickets, in order |
| `stats.items[].label` | string | `""` | `.ac-ticket__label` |
| `stats.items[].value` | string | `""` | `.ac-ticket__value`. It counts up **only** if it matches `^\d{1,3}(,\d{3})*$\|^\d+$` (reduced motion shows the final value at once). Otherwise it is printed verbatim. |
| `gallery.title` | string | `"Little Moments"` | section `<h2>` |
| `gallery.subtitle` | string | `""` | hidden if empty |
| `gallery.photos[]` | list of object | 8 × empty | photo frames, in order |
| `gallery.photos[].image` | string (relative path) | `""` | e.g. `assets/photos/beach.jpg`. Used as `<img src>` as is. If empty, show the `ui.emptyPhoto` frame. |
| `gallery.photos[].alt` | string | `""` | alt text. Fallback order: alt → caption → `""` (and then the image is decorative with `alt=""` only if the caption is shown right next to it) |
| `gallery.photos[].caption` | string (multi-line) | `""` | `<figcaption>`. Omitted if empty. |
| `gallery.photos[].tag` | string | `""` | `.ac-tag` chip. Omitted if empty. |
| `reveal.years` | string | `"2"` | → `{years}` (confirmed: 2 years) |
| `reveal.startDate` | string | `"October 4th"` | → `{startDate}`. **No year, ever.** |
| `reveal.jobTitle` | string | `""` | → `{jobTitle}`. It is not used by the default copy. Any element that shows it must hide itself when it is empty. |
| `reveal.employer` | string | `""` | → `{employer}`. Same rule as `jobTitle`. |
| `reveal.saving.title` | string | `"Saving..."` | beat 1 heading. The animated dots are decoration. Render the text as given. |
| `reveal.saving.note` | string | `"Do not turn off the power."` | beat 1 sub-line |
| `reveal.saving.aside` | string | `"(This is a completely normal save. Nothing is about to happen.)"` | beat 1 joke. Hidden if empty. |
| `reveal.announcement.speaker` | string **T** | `"Resident Services"` | name chip |
| `reveal.announcement.badge` | string | `"Island news!"` | blue tag. Hidden if empty. |
| `reveal.announcement.line` | string **T** | `"{name} is *moving up*!"` | the typed big line |
| `reveal.announcement.detail` | string **T** | "After {years} years as {son}'s stay-at-home mom, she is starting a new job on {startDate}." | sub-line |
| `reveal.achievement.badge` | string | `"Nook Miles+ · Achievement unlocked"` | blue tag |
| `reveal.achievement.stamp` | string | `"Hired!"` | `.ac-stamp` text. Plays `ACSound.stamp()`. |
| `reveal.achievement.title` | string **T** | `"Career change!"` | achievement `<h2>` (CSS may uppercase it) |
| `reveal.achievement.detail` | string **T** | "After {years} years as {son}'s stay-at-home mom, {name} is starting a new job on {startDate}." | lead paragraph |
| `reveal.achievement.ticketLabel` | string | `"Confirmed milestone"` | ticket label |
| `reveal.achievement.ticketValue` | string **T** | `"New job"` | ticket value |
| `reveal.letter.greeting` | string **T** | `"Dear everyone,"` | letter opening |
| `reveal.letter.lines[]` | list of string **T** | 2 lines (see file) | letter paragraphs. Empty strings are skipped. |
| `reveal.letter.signature` | string **T** | `"{name}"` | rendered as "— {signature}" plus a heart |
| `reveal.letter.ps` | string (multi-line) **T** | `""` | the P.S. **Hidden if empty.** The renderer adds the "P.S. " prefix only if the text does not already start with "P.S." |
| `reveal.letter.calendarLabel` | string | `"First day"` | tag on the calendar sticker |
| `reveal.finale.tag` | string **T** | `"From everyone at {venue}"` | pink tag |
| `reveal.finale.line` | string **T** | `"Congratulations, {name}!"` | the big waving headline |
| `reveal.finale.detail` | string **T** | `"A new job begins {startDate}."` | sub-line |

That is 78 key paths in total, counting each list-item field once. `.pages.yml` mirrors
them exactly (this was checked with a script at authoring time). **Adding a key requires
editing site.json, .pages.yml and this table together (architect only).**

### 3c. Empty-state rules (these are the expected launch state)

- An object in a list with **every** field empty still renders as a
  placeholder card or frame showing `ui.emptyEntry` / `ui.emptyPhoto`. It uses soft,
  dashed cream styling (`--ac-cream-edge` border, `--ac-ink-soft` text). It must look
  **inviting and intentional, not broken.**
- If only some fields are filled, render the ones that are filled and leave out the empty ones. Do not print a
  placeholder for a single missing field.
- A missing or empty list shows one `ui.emptySection` card.
- Never replace an empty value with invented sample text, and never show `[FACT PENDING]`
  in production.

---

## 4. Runtime contract

### 4a. Load order in `index.html` (all relative, no `type="module"` needed)

```html
<link rel="stylesheet" href="assets/tokens.css">
<link rel="stylesheet" href="assets/base.css">
<link rel="stylesheet" href="assets/site.css">
<link rel="stylesheet" href="assets/sections/opening.css">   <!-- … daily, stats, gallery, reveal -->
<script src="assets/audio.js" defer></script>
<script src="assets/content.js" defer></script>
<script src="assets/sections/opening.js" defer></script>     <!-- … daily, stats, gallery, reveal -->
<script src="assets/app.js" defer></script>                  <!-- must be last -->
```

Section roots in `index.html`, in page order, inside `<main id="main">`:
`<section id="opening">`, `<section id="daily">`, `<section id="stats">`,
`<section id="gallery">`, `<section id="reveal">`. Each is empty in the HTML, and its
module fills it in.

### 4b. `window.ACContent` (owned by the data worker, `assets/content.js`)

```js
ACContent.load()            // -> Promise<data>; fetches once, caches, never rejects (see 4c)
ACContent.data              // the loaded object (after load resolves)
ACContent.get('reveal.letter.ps')  // safe path lookup -> value or ''  (lists -> [] when missing)
ACContent.fill(str, extra?) // token replacement (§3a) -> plain string, '*' markers preserved
ACContent.rich(str, extra?) // fill + '*emphasis*' -> DocumentFragment (text nodes + span.ac-hl)
ACContent.isBlank(v)        // true for undefined/null/''/whitespace, or an object whose values are all blank
ACContent.liveStamp(d = new Date()) // -> { time: '3:07 PM', weekday: 'Saturday', date: 'September 21st' }
```

### 4c. How the JSON is loaded (safe for relative paths)

```js
fetch('content/site.json', { cache: 'no-cache' })
```

- The URL is **relative with no leading slash**, so it resolves against the page URL. That makes
  `/allyssaportfolio/` → `/allyssaportfolio/content/site.json` work. Don't
  use `new URL(..., location.origin)` and don't use absolute paths.
- `cache: 'no-cache'` makes the browser revalidate, so a CMS edit shows up after a normal
  refresh once Pages has redeployed.
- If the fetch or parse fails (this includes opening `index.html` via `file://`), `load()`
  resolves with `{}` and the site renders **every empty state**. It also shows one
  unobtrusive `role="status"` notice ("Content could not be loaded — …").
  That notice is the only hardcoded copy allowed in JS. It must never render
  invented text. Local preview: `python3 -m http.server` from the repo root.
- Image paths in the JSON (for example `assets/photos/x.jpg`) are also relative to the
  page and are used exactly as given.

### 4d. Section module interface (owned by each section worker)

```js
window.ACSections = window.ACSections || {};
ACSections.opening = {           // keys: opening | daily | stats | gallery | reveal
  render(root, data, C) {},      // root = <section>, data = full JSON, C = ACContent. Build the DOM. Idempotent.
  enter()  {},                   // optional: section became the presented slide / scrolled into view
  reset()  {}                    // optional: return to initial state (used by "Play it again")
};
```

`app.js` does the following: calls `ACContent.load()`, sets `document.title`, calls `render` on each
section in order, shows the start gate, and on the first gesture calls `ACSound.init()` and
enters the opening. For keyboard presentation it maps ArrowRight/PageDown/Space to next section and
ArrowLeft/PageUp to previous (when focus is not inside a form control). Enter/Space inside
a dialogue box advances the dialogue, and that is handled by the section. It uses IntersectionObserver
to call `enter()` and to add `.is-in` scroll reveals. Sound calls are wrapped as
`window.ACSound && ACSound.x && ACSound.x()`.

---

## 5. Dates: the rules

- **The opening shows the real current date and time from `new Date()`**, computed when
  the line is shown (not when the page loads). The format is `h:mm AM/PM`, a full weekday, and
  `Month Dth` (ordinal). **The opening line prints no year.**
- **The job start date is `reveal.startDate`, printed verbatim.** Never pass it to
  `new Date()`, never compute a year for it, and never compare it with today's date or add a year.
- For the calendar sticker, parse only the month word and the leading day number out of
  `startDate` with a regex (`/^([A-Za-z]+)\s+(\d{1,2})(st|nd|rd|th)?/`). If
  the parse fails, show the whole string as the sticker text instead.

---

## 6. The character (settled policy)

Allyssa appears **only** as `site.portrait` (her own reference image) inside a
**framed portrait**. The frame is a rounded cream mat (`--ac-cream`) with a wood edge
(`--ac-wood` / `--ac-wood-dark` border), a gentle `--sh-2` shadow and `--r-lg` corners. Style it with
`object-fit: cover` and never distort it. Define it once in `assets/site.css` as the class
`.ac-portrait` (a wrapper) around `<img>`, and reuse it wherever she appears (opening desk,
reveal announcement, finale). Do **not** redraw it, cut it out, remove its background, or
swap in the SVG characters. The alt text comes from `site.portraitAlt`.

---

## 7. Editing and publishing with Pages CMS

1. Editor setup (once): go to <https://app.pagescms.org>, sign in with GitHub, and
   authorize the Pages CMS GitHub App for this repository only. Then open the repo and branch. Pages CMS
   reads `.pages.yml` at the repo root. See <https://pagescms.org/docs/quick-start/>.
2. The sidebar shows **"Allyssa's website — all text & photos"**, which is one form for
   `content/site.json` with the groups Whole site / Buttons / 1 Opening / 2 Day in
   the life / 3 Stats / 4 Photos / 5 The surprise. List items (schedule entries,
   stats, photos, dialogue lines, letter paragraphs) can be added, removed and
   reordered.
3. Photos: the **Photo** field uploads into `assets/photos/` (the `media` block in
   `.pages.yml`: input `assets/photos`, output `assets/photos`, with no leading slash so
   the stored path stays relative). Allowed files are jpg, jpeg, png, webp and gif. Uploaded filenames are slugified
   (`rename: safe`).
4. **Save** makes a commit to the branch. GitHub Pages then redeploys automatically, which
   usually takes about 1–5 minutes, sometimes longer. After that, a normal refresh shows the change. **Changes are
   not instant**, so don't promise that they are.
5. No tokens or secrets ever go in the public site. The optional `site.editUrl`
   link only opens the separate, signed-in CMS. Pages CMS does not allow editing on the page itself.
6. `.pages.yml` is served publicly (because of `.nojekyll`). It contains no secrets, so this is fine.
7. Why comments aren't in the JSON: Pages CMS writes back only the fields
   that are configured, so `_comment` keys could be dropped or would confuse editors. Field help
   lives in the `description:` keys in `.pages.yml` and in this file.

Pages CMS schema references used: content entries of `type: file` with `format: json`,
nested `object` fields, `list: true` with `collapsible.summary`, `image` fields, and the
top-level `media` block. Sources: <https://pagescms.org/docs/configuration/content/>,
<https://pagescms.org/docs/configuration/content/list/>,
<https://pagescms.org/docs/configuration/media/>,
<https://pagescms.org/docs/configuration/fields/image/>.

---

## 8. Facts: what is confirmed and what must never be invented

**Confirmed (the only personal facts in the build):**
- Her name is **Allyssa**. Her son is **Keone**.
- The venue is **Thuy and Melissa's house**.
- She has been a stay-at-home mom for **2 years** (the reveal says "after 2 years").
- She starts a new job on **October 4th**, with **no year**.
- The reveal sequence is **"Saving..." → "Allyssa is moving up!" → achievement stamp → letter →
  congratulations.**
- The opening uses the real current date and time.

**Never invent any of the following, in code, JSON seeds, alt text, ARIA labels, comments shown to visitors, or
placeholder copy:**
- job title, employer, workplace, industry, or salary
- any year for the start date, or any countdown or "days until" based on a guessed year
- ages (hers, Keone's, anyone's), birthdays, or a spouse/partner or other family members
- daily routines, times of day, activities, hobbies, or favorites
- counts, stats, numbers or achievements (apart from the "2 years" and "New job" facts
  above)
- photo captions, photo tags, or descriptions of photos that do not exist
- quotes attributed to Allyssa beyond the seeded dialogue and letter lines
- any duration other than 2 years (the old "four years" claims are banned)

When a value is not known, the field stays **empty** and the site shows its
inviting empty state (§3c).
