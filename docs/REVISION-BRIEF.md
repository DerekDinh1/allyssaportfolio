# Revision brief — user feedback after first mockup review

## Authoritative decisions
- Keep current office/environment design.
- Revise Allyssa character to match original supplied female Animal Crossing reference as closely as possible, with rounded, shaded, game-like 3D appearance. Character not approved yet. Do not pretend prior SVG was visually verified against reference.
- Original character attachment located at /Users/derekdinh/.dsh/attachments/v1/objects/39/394a8c780bc125d7f50bd2503513f1c9261508678aba28b2f3714fde095c7d68. No need to request re-upload.
- Remove inventory (old section 3). Final structure: opening, daily life, stats, photos, surprise.
- Remove invented facts and sample claims presented as real. Blank editable fields until user supplies facts/photos.
- User explicitly supplied duration: after 2 years. Remove all four-year claims. Make duration editable.
- Start date is October 4th; year was not supplied. Do not infer a year from host clock.
- Names: Allyssa, son Keone; opening venue: Thuy and Melissa's house. Live date and time.
- Reveal chain: Saving… → Allyssa is moving up! → achievement → letter → congratulations.
- Scroll site with keyboard presentation navigation; Press A user gesture gate for audio.
- User wants easiest editing of text and photo input without downloading and re-uploading site copies.

## Proposed editing direction — awaiting confirmation
Recommend Pages CMS: authenticated browser editor commits structured content and uploaded images to the GitHub repo, with automatic Pages publishing. Site can include Edit content link; actual editor is separate signed-in screen, not inline editing. User must authorize GitHub access for the CMS; never put repository tokens in public site JS. No custom database required. Explain deploy delay and do not promise instant public changes.
Sources: https://pagescms.org/ ; https://pagescms.org/docs/quick-start/ ; https://pagescms.org/docs/configuration/
If user requires literal inline shared editing instead, need authenticated backend/storage and explicit consent on provider/setup.

## Evidence from first preview gate
- mockups/index.html is local review gallery; not deployed.
- mockups/previews/ contains 20 PNGs, including all six initial sections desktop/mobile, three fullpage images and five reveal beat clips.
- mockups/previews/report.json records successful Chrome CDP captures, loaded fonts, no runtime errors/missing images/horizontal page overflow at tested dimensions.
- NOT aesthetic approval, actual audio listening, full interaction testing, or full-site acceptance.
- Chrome required wider execution approval because sandbox browser initialization failed. tools/render-previews.mjs manages process and exits cleanly; no background job remains.

## Next scope
1. Confirm Pages CMS editing approach.
2. Revise character using actual reference with an appropriately image-capable production path; if unavailable explicitly explain limitation, not pretend exact matching.
3. Remove inventory from review navigation; clear invented facts and correct duration, leaving clearly empty editable states.
4. Show revised character and five-section preview before full-site build/deployment.
