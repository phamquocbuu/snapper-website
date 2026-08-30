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

## Pricing and checkout

The `#pricing` section on `index.html` uses [Paddle](https://paddle.com)
as merchant of record:

- `functions/api/checkout-context.js` — Pages Function that returns the
  resolved Paddle environment, the **public** Paddle.js client token, and
  the catalog price IDs. It responds `500` if `PADDLE_ENVIRONMENT` is
  unset or invalid, so the site can never run against the wrong account.
  The secret API key is read here only (for signed-in customer lookup)
  and is never sent to the browser.
- `assets/js/checkout.js` — loads Paddle.js, renders live totals from
  `PricePreview` (`formattedTotals` verbatim — no client-side math), and
  opens the overlay checkout on the Buy buttons. Successful payment
  redirects to `/thanks`.
- Provisioning is handled by the **license backend** below.

## License backend

Turns a completed Paddle transaction into a license key the app can
activate. Lives in `functions/api/` against a Cloudflare **D1** database
(`schema.sql`, binding `LICENSE_DB`).

- `paddle-webhook.js` — verifies the `Paddle-Signature` HMAC, dedupes on
  `event_id`, and on `transaction.completed` writes a `licenses` row.
  Bands are pinned to the major at purchase (`snapper-pro` = `1.0 - 1.x`,
  `snapper-lifetime` = `1.0 - 999.x`); the renewal price widens an
  existing key's upper major by one. Key delivery email is Paddle's
  built-in — this handler does not send email.
- `activate.js` — `POST /api/activate {key, machine}` → looks up the key,
  enforces `seats`, and returns `{ receipt }`: a `base64url(payload).base64url(sig)`
  string signed with the server's Ed25519 key and verified against the
  key compiled into the app. `404` unknown key, `409` seat limit.
- `deactivate.js` — `POST /api/deactivate {key, machine}` frees the seat;
  always `200`.

### Setup

```sh
npx wrangler d1 create snapper-licenses            # paste id into wrangler.toml
npx wrangler d1 execute snapper-licenses --remote --file=schema.sql
npx wrangler d1 execute snapper-licenses --local  --file=schema.sql   # for pages dev

node scripts/gen-license-keypair.mjs               # prints the private + public keys
npx wrangler pages secret put LICENSE_SIGNING_KEY  # the base64 PKCS#8 private key
npx wrangler pages secret put PADDLE_WEBHOOK_SECRET # pdl_ntfset_... for the destination
```

Add the `LICENSE_DB` D1 binding under Pages project → Settings → Bindings
(git-connected builds read the dashboard, not `wrangler.toml`). Point a
Paddle notification destination (`transaction.completed`) at
`https://snapper.nexis.io.vn/api/paddle-webhook`. Compile the printed raw
32-byte public key into the app (`LicenseConfiguration.Obfuscated`).

### Catalog

Products/prices are created by `seed-paddle-catalog.mjs` in the app repo
(`snapper/claude-docs/`). Sandbox: **Snapper Pro** (`$19` first purchase +
`$10` renewal) and **Snapper Lifetime** (`$59`). Re-run it with
`PADDLE_ENV=production` for live IDs.

### Config

Copy `.dev.vars.example` to `.dev.vars` for local
`npx wrangler pages dev .`. In production set the same keys under Pages
project -> Settings -> Variables and Secrets (Production + Preview):

```sh
npx wrangler pages secret put PADDLE_API_KEY        # only once real web auth exists
# the rest are plain vars, not secrets:
#   PADDLE_ENVIRONMENT  PADDLE_CLIENT_TOKEN
#   PADDLE_PRICE_PRO_FIRST  PADDLE_PRICE_PRO_RENEWAL  PADDLE_PRICE_LIFETIME
```

Sandbox domains are auto-approved. For **live**, add `snapper.nexis.io.vn`
under Paddle -> Checkout -> Website approval and set a default payment
link, or checkout shows "Something went wrong".
