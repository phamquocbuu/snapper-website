# Snapper website

Static marketing site for [Snapper](https://snapper.nexis.io.vn) — a
local-first, native macOS screen capture and recording utility.

- Single static `index.html`, no build step.
- Design follows the app icon: blue vertical gradient, rounded-square
  plates, white viewfinder motif, rounded typography.
- Deployed to GitHub Pages via `.github/workflows/deploy.yml`.
- Custom domain: `snapper.nexis.io.vn` (see `CNAME`).

## Local preview

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.
