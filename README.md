# Combo Locker

Fan-made Fortnite combo builder: browse the daily Item Shop, build a six-piece combo (outfit, back bling, pickaxe, glider, sidekick, vehicle), then favorite, wishlist, save and share it. Layout follows the Figma "Fortnite Locker" designs; icons are in assets/icons/.

Accounts are real (Supabase Auth). Guests can use everything; their favorites, wishlist and combos stay in the browser (`localStorage`) and move into their account the first time they log in.

**Before launch, finish "Setup you need to do" below**: until then, sign-up emails only reach your own Supabase team's addresses and no alerts are sent.

## Run it

Requires Node 18+. No packages to install.

```sh
npm start        # then open http://localhost:5173
npm run build    # optional: build the Vercel output into public/ to check it
npm run data     # optional: refresh the fallback copy data/cosmetics.json
npm run shop     # optional: refresh the fallback copy data/shop.json (+ local data/shop-history.json)
```

The page loads live data from `/api/shop` and `/api/cosmetics` (the same code runs locally and on Vercel) and only falls back to the `data/` copies if those fail.

## Hosting (Vercel)

No framework and no packages; `vercel.json` has everything:

- **Build:** `node scripts/build-site.mjs` copies the public files into `public/` and writes `public/404.html` (the site's "not found" page, with a real 404 status). `index.html` is left out on purpose so `/` goes to `api/page.js`.
- **`/`** → `api/page.js`: `index.html` plus share-preview tags for combo links. Cached on the CDN for an hour; each deploy clears it.
- **`/api/shop`**: today's shop from fortnite-api.com, with "last seen" dates from the Supabase history (`public.shop_last_seen`). Cached until just after the 00:00 UTC reset.
- **`/api/cosmetics`**: the catalog, rebuilt from fortnite-api.com every 6 hours, so new items appear without a redeploy.
- **`/api/contact`**: stores Contact form messages in Supabase, table `public.contact_messages` (read them in Table editor). The `submit_contact` function re-checks every field and caps the site at 100 messages an hour.
- **Environment variable:** `SITE_URL` (e.g. `https://fortifyme.gg`) once the domain is connected. Until then preview links use the Vercel address.

Setting up: import the GitHub repo in Vercel (Add New → Project), leave every setting at its default (vercel.json overrides them), deploy. Connect the domain only at launch.

## Pages

- **Shop** (default): today's Item Shop grouped into its in-game sections, with prices, discounts, time left and a reset countdown. Click a tile to see every item in it, wishlist it or try it on. Link to one item: `?view=shop&item=<cosmetic id>`.
- **Build**: the combo builder. Shared combo links open here.
- **Account**: email alerts, saved combos, wishlist, likes.
- **Sign up** (`?view=signup`) and **Log in** (`?view=login`): from the Figma frames, using Supabase Auth (email + password, 12+ characters). Sign-up sends a confirmation link and shows a "Check your inbox" panel with a resend button. "Forgot password?" emails a reset link that opens **Set a new password** (`?view=reset`). My account asks you to log in first. Logging out clears this browser's copy of the locker (it's in the account).
- **Alerts turned off** (`?view=alerts-off`): where the unsubscribe link in alert emails lands.
- **Privacy** (footer link, `?view=privacy`): draft privacy policy. Retention periods, provider list and the children's section are proposals to confirm before launch.
- **Terms of Service** (`?view=terms`, linked from the footer and the sign-up form): draft terms. Still needs the operator's name and governing law before launch; the 13+ minimum age is a proposal.
- **Page not found**: shown for any missing page (e.g. `/shopp`) or unknown `?view=`. The local server returns the site with a real 404 status for missing pages (missing images or files still get a plain 404). On Vercel, `public/404.html` does the same.
- **Cookie consent banner**: shows on first visit with equal "Reject all" / "Accept all" buttons and a Customize panel (Essential always on; Analytics and Personalized ads off by default). Reopen it from the footer's "Cookie settings". The choice is saved under `comboLocker.consent`. Nothing optional runs yet; when you add analytics or ads, load them only if `window.comboConsent()` says so and listen for the `consentchange` event. A Global Privacy Control signal forces personalized ads off.
- **Contact** (footer link, `?view=contact`): a form with a topic, optional name, email and message. The local server saves each message to `out/messages/` (not committed); the live site stores them in Supabase (`public.contact_messages`).

## Accounts

- Sign-in: Supabase Auth, project **combo-locker**. Browser settings are in `config.js` (the publishable key is meant to be public).
- Data: table `public.lockers`, one row per account (likes, wishlist, combos, alerts on/off, time zone, unsubscribe token), created automatically at sign-up from the form's alert choice. Row Level Security: people can only read and change their own row, and never the unsubscribe token.
- Sync: changes upload about a second after you make them (last change wins across devices). Alert settings are saved only by the **Save preferences** button, so an old open tab can't switch alerts back on after someone unsubscribed by email.
- Alerts always go to the account's own confirmed email; there's no separate alert address (stops anyone pointing alerts at a stranger).
- Deleting an account in Supabase (Authentication > Users) removes its locker and alert log too.

## Wishlist email alerts

When a wishlisted item appears in the shop, the subscriber gets one email with:

1. how long it's in the shop (leave date/time in their time zone, days left)
2. its price in V-Bucks (and the normal price if discounted, or the bundle it's in)
3. the last time it was in the shop

**Live sender:** the `send-alerts` Edge Function (copy in `supabase/functions/send-alerts/`) runs daily at 00:30 UTC, 20 minutes after the shop is recorded, with a retry at 06:30 UTC.

- Who gets one: accounts with alerts on, a confirmed email, and a wishlisted item in today's shop (`public.alert_subscribers()`).
- Each item alerts once per shop listing, logged in `public.alerts_sent`; re-running never double-sends.
- Every email has a one-click "Turn off wishlist alerts" link plus the `List-Unsubscribe` header (Gmail and Yahoo require it for bulk senders). The `unsubscribe` function turns alerts off and sends people to `?view=alerts-off`.
- Until `RESEND_API_KEY` and `ALERT_FROM` are set it's a **dry run**: it counts what it would send and sends nothing. See recent runs in the SQL editor: `select status_code, content from net._http_response order by created desc limit 5;`
- Sends stop at `ALERT_DAILY_CAP` (default 100, Resend's free daily limit); anyone left over gets theirs at the 06:30 retry.
- Template preview without sending: `POST /functions/v1/send-alerts?preview=1` with `{"wishlist": ["<item id in today's shop>"], "time_zone": "America/New_York"}`.
- The template is `lib/alert-email.js`; the function uses a copy (`supabase/functions/send-alerts/alert-email.js`). After editing the template, copy it over and redeploy the function.

The old local scripts still work for testing (`npm run daily` writes previews to `out/emails/` from `data/subscribers.json`).

**"Last time in the shop" only covers dates since we started recording** (`data/shop-history.json`). No free API provides older shop history, so start running the daily job as early as possible. Brand-new items show "Never — this is a new item".

## Share previews

Shared combo links look like `/?view=build&outfit=<id>&pickaxe=<id>`. Posted in Discord, iMessage, X, Slack and so on, they show a 1200x630 picture of the combo: the outfit large, the other pieces as tiles.

- The picture is made by the `combo-card` Edge Function (copy in `supabase/functions/combo-card/`) from item IDs only; names and images come from fortnite-api.com, so nobody can put their own text on a card. With no items it shows a generic "Build your next combo" card, which is also every other page's preview.
- The page's title, description and picture tags come from `lib/page.mjs`, used by `server.mjs` locally and `api/page.js` on Vercel. **Previews only work on a public address** (the Vercel URL works). Set `SITE_URL` to the public address.
- On phones the Share button opens the system share sheet; elsewhere it copies the link. Older `#outfit=...` links still open in the builder but have no preview.

## Setup you need to do

1. **Resend** ([resend.com](https://resend.com), free: 3,000 emails/month, 100/day): create an account, add and verify your domain, create an API key.
2. **Alert emails**: in Supabase > Edge Functions > Secrets, add `RESEND_API_KEY`, `ALERT_FROM` (e.g. `Combo Locker <alerts@yourdomain.com>`) and `SITE_URL` (the site's address; `http://localhost:5173` until launch).
3. **Sign-up and password emails**: in Supabase > Authentication > Emails > SMTP settings, turn on custom SMTP with Resend: host `smtp.resend.com`, port `465`, user `resend`, password = the API key, sender = an address on your verified domain. Until then Supabase only emails members of your Supabase team.
4. **Redirect links**: in Supabase > Authentication > URL Configuration, set Site URL to `http://localhost:5173` (your real address at launch) and add `http://localhost:5173/**` (later also `https://yourdomain/**`) to Redirect URLs. Otherwise confirmation and reset links land on the wrong page.
5. **Password rule** (recommended): Authentication > Providers > Email > minimum password length 12, so the server enforces it too.

## Daily shop recording (live)

The real shop history is recorded in Supabase, project **combo-locker** (`zirktoidxwdivbztzyhg`, us-east-2), starting 2026-10-18:

- Edge Function `record-shop` (copy in `supabase/functions/record-shop/`) saves today's shop to `shop_appearances` and `shop_days`.
- `pg_cron` runs it daily at 00:10 UTC, with a retry at 06:10 UTC (`supabase/migrations/`).
- Check it's running: in the Supabase SQL editor, `select * from shop_days order by shop_date desc;` should show one row per day. A missing day is a gap in history.

`npm run shop` still records a local copy for the prototype.

## Files

- `index.html`, `styles.css`, `app.js`: the page
- `config.js`: Supabase address and publishable key (browser and server)
- `supabase/functions/`: Edge Functions `record-shop`, `send-alerts`, `unsubscribe`, `combo-card` (copies of what's deployed)
- `supabase/migrations/`: database changes, in order
- `lib/alert-email.js`: the alert email template (shared by the page preview and the sender)
- `data/cosmetics.json`: trimmed catalog (about 9,000 items, 1.8 MB)
- `data/shop.json`, `data/shop-history.json`: today's shop and our recorded shop history
- `scripts/build-data.mjs`: downloads and trims the catalog
- `scripts/record-shop.mjs`: records today's shop
- `scripts/send-alerts.mjs`: matches wishlists to today's shop and sends emails
- `server.mjs`: local server (static files, contact form, link-preview tags, 404 pages)

Fortnite is a trademark of Epic Games, Inc. This site is not official and is not endorsed by Epic Games.
