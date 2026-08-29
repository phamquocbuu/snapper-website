# Snapper website

Static marketing site for [Snapper](https://snapper.nexis.io.vn) — a
local-first, native macOS screen capture and recording utility.

- Static HTML at the repo root, no build step.
- Design follows the app icon: blue vertical gradient, rounded-square
  plates, white viewfinder motif, rounded typography.
- Hosted on **Cloudflare Pages**; the contact form is a Pages Function
  (`functions/contact.js`) that verifies Turnstile and posts to Telegram.
- Custom domain: `snapper.nexis.io.vn`.

## Local preview

```sh
python3 -m http.server 8000            # static pages only
# or, to also run the /contact function:
npx wrangler pages dev .
```

## Deploy (Cloudflare Pages, git-connected)

1. Cloudflare dashboard -> Workers & Pages -> Create -> Pages ->
   **Connect to Git** -> `phamquocbuu/snapper-website`.
2. Build settings: **Framework preset: None**, **Build command: empty**,
   **Output directory: `/`**.
3. Deploy, then **Custom domains** -> add `snapper.nexis.io.vn`.
4. Pushes to `main` auto-deploy; PRs get preview URLs.

## Contact form setup

The `/contact` Pages Function needs three secrets and a Turnstile widget.

1. **Turnstile** — dashboard -> Turnstile -> Add widget. Add
   `snapper.nexis.io.vn` (and `localhost` for testing) as hostnames.
   Put the **site key** into `data-sitekey` in `contact.html`; keep the
   **secret key** for step 3.
2. **Telegram bot** — message [@BotFather](https://t.me/BotFather),
   `/newbot`, copy the token. Send the bot a message, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read
   `result[].message.chat.id`.
3. **Secrets** — Pages project -> Settings -> Variables and Secrets
   (Production + Preview), or via CLI:

   ```sh
   npx wrangler pages secret put TURNSTILE_SECRET
   npx wrangler pages secret put TELEGRAM_BOT_TOKEN
   npx wrangler pages secret put TELEGRAM_CHAT_ID
   ```

For local dev with `wrangler pages dev`, use the Turnstile test keys
(site `1x00000000000000000000AA`, secret
`1x0000000000000000000000000000000AA`) and a `.dev.vars` file for the
secrets (git-ignored).
