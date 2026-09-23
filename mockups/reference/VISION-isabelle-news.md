# Opening vision — Isabelle's News reference

**Source:** [Animal Crossing New Horizons: Isabelle's News](https://youtu.be/K715qrb1Yrg) (`K715qrb1Yrg`)

## What the scene does (beat language)

1. **Resident Services desk** — character centered behind counter, camera locked
2. **Idle life** — soft bob / sway; sparkles or emote pulses on happy lines
3. **Dialogue box** docks low; **namechip** hangs off top-left edge
4. **Talk** — letters type one-by-one; **Animalese** pitch-babbles (not UI clicks)
5. **A Advance** — mid-type skips to full line; next A advances beat
6. **Clear hierarchy** — face readable above box; desk props (nameplate) stay part of scene

## Allyssa mapping

| Reference | Our site |
|-----------|----------|
| Isabelle at RS desk | Allyssa in `opening-scene.png` behind desk |
| Morning announcement | Live clock announcement + dialogue bank |
| Animalese talk | `ACSound.blip` / talk voice (tune to softer formant babble) |
| Nameplate on desk | Leave baked-in plate in scene art (HTML overlay removed — looked bad) |
| Idle bob + mouth | **Phase 2 (needs approval)** — CSS/sprite or Lottie/canvas idle |

## Phase 2 animation plan (await approval)

1. **Idle bob** — subtle `translateY` + scale breath on character layer (~2.5s ease)
2. **Talk emote** — while typing: slightly faster bob + occasional sparkle pulse
3. **Line-end rest** — settle to calm idle when caret ends
4. **Reduced motion** — freeze pose; keep typewriter instant
5. Prefer layered assets (body / face / desk) if we re-export scene; else clip-path bob of full plate

Do **not** implement Phase 2 until approved after nameplate + mute + talk-sound polish.
