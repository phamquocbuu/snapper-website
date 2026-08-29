# snapper-contact Worker

Cloudflare Worker that backs the site's contact form: verifies a
Cloudflare Turnstile token, then delivers the message to Telegram.

## Setup

1. **Turnstile widget** — Cloudflare dashboard -> Turnstile -> Add widget.
   Add `snapper.nexis.io.vn` (and `localhost` for testing) as hostnames.
   Note the **site key** (goes in `contact.html`) and **secret key**.

2. **Telegram bot** — message [@BotFather](https://t.me/BotFather),
   `/newbot`, copy the token. Send your new bot a message, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read
   `result[].message.chat.id` — that is your `TELEGRAM_CHAT_ID`.

3. **Deploy**

   ```sh
   cd worker
   npm install -g wrangler        # if not installed
   wrangler login
   wrangler secret put TURNSTILE_SECRET
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_CHAT_ID
   wrangler deploy
   ```

4. Copy the deployed URL (e.g.
   `https://snapper-contact.<subdomain>.workers.dev`) and set it as
   `CONTACT_ENDPOINT` in `../contact.html`. Optionally bind a custom
   domain route in `wrangler.toml`.

5. Put the Turnstile **site key** into `data-sitekey` in `contact.html`.

## Local dev

```sh
wrangler dev
```

Use the Turnstile test keys during development:
site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.
