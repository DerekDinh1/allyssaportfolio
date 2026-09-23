# Allyssa's Island

A fun, Animal Crossing-inspired website about what it's like to be a stay-at-home mom —
with some news at the end.

## What's here

| File | Purpose |
|---|---|
| `index.html` | The site. Five scenes: opening announcement, a day in the life, resident stats, little moments, and the surprise. |
| `content/site.json` | **All the words and photos.** This is the only file you edit to change content. |
| `.pages.yml` | Configuration for the Pages CMS editor. |
| `assets/` | Styles, scripts, artwork, and uploaded photos. |
| `mockups/` | Earlier design mockups, kept for reference. Not used by the site. |
| `docs/BUILD.md` | How the site is built, and the rules it follows. |

## Editing the content

Open the editor, sign in with GitHub, change any text or upload photos, and save.
Your changes are committed to this repository and GitHub Pages republishes automatically.

## Running locally

The site reads `content/site.json` over HTTP, so open it through a local server rather
than double-clicking the file:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000/
```

## Deploying

Hosted with GitHub Pages from the `main` branch root. No build step.
