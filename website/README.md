# secondsurf

Shop for second-hand surf clothing, built with [Astro](https://astro.build).
German lives at `/`, French at `/fr/`, Italian at `/it/`, English at `/en/`. No cookies, no tracking.
When you change a text, change it in all four languages (`de`, `fr`, `it`, `en`). A missing text falls back to German.

All commands below are for **PowerShell on Windows**, run inside this folder:

```powershell
cd "C:\Users\noalg\OneDrive\Desktop\Websites\secondsurf\website"
npm install   # once, after cloning
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Live preview at http://localhost:4321 (drafts are visible here, never on the live site) |
| `npm run build` | Builds the site into `dist/` |
| `npm run preview` | Serves the built site |
| `npm run check` | Type-checks everything, catches typos |

Anything marked **TODO** on the site or in the files is placeholder content waiting for you.

## Pages

| Page | Address | Content |
| --- | --- | --- |
| Start | `/` | Hero, new drop, categories, staff picks, "sell with us", Instagram |
| New Drop | `/new/` | All pieces with `drop:` = `currentDrop` in `src/settings/site.json`. The site opens here: `/`, `/fr/`, `/it/` and `/en/` redirect to it (`public/_redirects`), so the start page is not shown |
| Shop | `/shop/` and `/shop/<category>/` | All available pieces, category chips, size filter |
| Product | `/item/<folder-name>/` | Photos, brand, size, condition, measurements, price, buy / ask button |
| Stockist werden | `/sell/stockist/` | For shops and resellers with regular stock (consignment), with application form |
| Einmalig verkaufen | `/sell/once/` | For private people selling once, with form |
| Über uns, Kontakt | `/about/`, `/contact/` | Story, contact form, email, Instagram |
| Rückgabe | `/returns/` | Return conditions and form |
| News | `/news/` | News items; linked in the footer once one exists |
| AGB, Datenschutz, Impressum | `/terms/`, `/privacy/`, `/imprint/` | Templates. Set `legalReviewed` to `true` in `src/settings/site.json` once checked, to hide the note |

## Where things live

```
src/content/products/      one folder per piece: index.md + its photos
src/content/news/          news items, usually edited in Pages CMS
src/settings/site.json     email, owner, address, shipping prices, banners, current drop
src/settings/texts.json    texts on the start and about pages
src/config.ts              categories, sizes, conditions
functions/api/             server code: dashboard and forms
src/i18n/ui.ts             all short texts (menus, buttons, headings) in DE, FR, IT, EN
src/pages/[...lang]/       the pages
src/pages/[...lang]/sell/  the two "sell" pages: steps, what you cover, your share (TODO: your real deal)
src/components/            header, footer, product card, product grid, forms
src/styles/global.css      colours, fonts, buttons, cards
```

## Add a piece

1. Create a folder in `src/content/products/`. Start with the next number, so the newest come first:
   `0005-oneill-tee`.
2. Put the photos in it as `1.jpg`, `2.jpg` … (`1.jpg` is on the card, `2.jpg` shows when hovering).
3. Create `index.md` in the same folder:

   ```yaml
   ---
   brand: O'Neill
   title: { de: "T-Shirt weiss", fr: "T-shirt blanc", it: "T-shirt bianca", en: "White tee" }
   category: tees            # one of the ids in CATEGORIES in src/config.ts
   size: M                   # XS, S, M, L, XL, XXL or One size
   sizeNote: "fällt klein aus"   # optional
   condition: veryGood       # new, likeNew, veryGood or good
   price: 25                 # CHF
   measurements: "Achsel zu Achsel 52 cm, Länge 70 cm"   # optional
   description: { de: "…", fr: "…", it: "…", en: "…" }            # optional
   photos:
     - ./1.jpg
     - ./2.jpg
   drop: 1                   # shows under "New Drop" when it matches currentDrop
   staffPick: true           # optional: shows in Staff Picks on the start page
   stockist: "Surfshop XY"   # optional, never shown: who supplied it
   ---
   ```

When it sells, add `sold: true` (it stays visible, greyed out, at the end of the list). To hide a piece, add `draft: true`.
For a new drop, raise `currentDrop` in `src/settings/site.json` and give the new pieces that number.
The four example pieces (`0001`–`0004`) are drafts: they only show in `npm run dev`. Delete them once you have real ones.
Big phone photos are fine: they are resized and compressed automatically. Strip the location from photos first.

## Dashboard (add pieces from your phone)

Log in at `/admin/` to add a piece with photos, mark it as sold, or delete it. Saving makes a commit to `main`,
so the piece appears after Cloudflare has rebuilt the site (usually within 2 minutes). Run `git pull` before working locally.
Texts typed in the dashboard show in all four languages; edit `index.md` to translate them.
Photos are shrunk in the browser, which also removes the location. The dashboard only works on Cloudflare, not with `npm run dev`.

Setup, once. In **Cloudflare → Workers & Pages → secondsurf → Settings → Variables and Secrets**, add these as secrets for Production, then redeploy:

| Name | Value |
| --- | --- |
| `ADMIN_PASSWORD` | Your login password, at least 12 characters |
| `SESSION_SECRET` | A random text of at least 32 characters |
| `GITHUB_TOKEN` | A [fine-grained token](https://github.com/settings/personal-access-tokens/new) for only this repository, with **Contents: Read and write** |

Optional, for the **✨ Fill in with AI** button: under **Settings → Bindings → Add → Workers AI**, add a binding with the variable name `AI` (for Production), then redeploy. It sends up to four photos to Llama 4 Scout on Cloudflare Workers AI (see `functions/api/admin/describe.ts`), which suggests brand, title, category, size, condition and a description in all four languages. It's free: Workers AI includes 10,000 neurons a day, which is roughly 30 or more pieces, and on the free Workers plan it stops with a message instead of charging. Without the binding, the button shows a setup message and everything else works.

Changing `ADMIN_PASSWORD` or `SESSION_SECRET` logs out every device. Fine-grained tokens expire, so renew `GITHUB_TOKEN` when the dashboard reports a GitHub error.

To test locally, put the same values in `.dev.vars` (git-ignored), then run `npm run build` and `npx wrangler pages dev dist`.
Careful: with a real token, this changes the real shop.

## Customer accounts (wishlist, addresses, price alerts)

Customers create an account at `/account/` (the person icon in the header) with email and password. They save pieces with the heart on cards and product pages, store up to 5 shipping addresses, and get an email when a saved piece gets cheaper. All code is in `functions/api/account/[[path]].ts` and `functions/_lib/accounts.ts`, the page in `src/pages/[...lang]/account.astro`, the texts in `src/i18n/account.ts`.

- **Data:** a Cloudflare D1 database (free plan: 5 GB, 5 million reads a day). The tables create themselves on the first request.
- **Passwords:** PBKDF2-SHA256 with 50,000 rounds (the most that fits the free plan's 10 ms CPU limit). On Workers Paid, raise `ROUNDS` in `functions/_lib/accounts.ts`; passwords upgrade at the next login.
- **Protection:** Turnstile on sign-up and "forgot password"; at most 10 login tries per email and 30 per IP in 15 minutes.
- **Emails** (confirmation, new password, price alert) go through Resend, so `RESEND_API_KEY` must be set. Price alerts go only to confirmed addresses.
- **Price alerts** are sent when the price is lowered in the dashboard at `/admin/`, not when `index.md` is edited by hand. One email per lower price.
- `/products.json` lists all pieces with their price; the profile page and the wishlist API read it.

Setup, once: in **Cloudflare → Workers & Pages → D1 SQL Database → Create**, name it `secondsurf-accounts`. Then in **secondsurf → Settings → Bindings → Add → D1 database**, use the variable name `DB` and pick that database, then redeploy. Without it, the profile page shows "accounts aren't available".

To test locally: `npm run build`, then `npx wrangler pages dev dist --d1 DB=accounts-test`.

## Drops: countdown and reminders

`currentDrop` and `nextDropAt` (Swiss local time, e.g. `2026-11-12T16:00`) in `src/settings/site.json` drive the New Drop page
(`src/pages/[...lang]/new.astro`): before `nextDropAt` it shows a countdown and an **Erinnere mich** button; the drop's pieces are already
in the page, hidden, and appear when the countdown ends. The button offers an email reminder (`functions/api/drop/[[path]].ts`, table
`drop_reminders` in D1, Turnstile-protected, confirmation with an unsubscribe link) and a calendar entry (`/drop.ics`, Google Calendar link).
At drop time `POST /api/drop/notify` emails everyone in batches of 100 and deletes the addresses. It does nothing before the drop and never
emails twice, so anyone may call it: the New Drop page calls it when the countdown ends, and `.github/workflows/drop-reminder.yml`
calls it every hour as a backup. Resend's free plan sends up to 100 emails a day.

## Welcome discount (WELCOME10)

`src/components/WelcomePopup.astro` (in every page via `Base.astro`) shows a popup a few seconds into the first visit:
10 % off the first order with an account. It shows once per browser, never to logged-in customers or on `/account/`.
After signing up, the code (`WELCOME` in `src/config.ts`) shows in the profile and in the confirmation email.

With Stripe Checkout on, the product page has a code field. `functions/api/checkout.ts` only accepts the code for a
logged-in customer who hasn't used it yet, and charges 10 % less (rounded to 5 Rappen). The webhook records it as used
(`welcome_used` table) once the payment arrives. The login cookie therefore covers `/api`, not just `/api/account`.
For orders by inquiry, the owner applies the discount by hand.

## Selling: how people pay

**Without Stripe** (`"stripeCheckout": false` in `src/settings/site.json`): each piece has an **Anfragen** button that opens
the contact form with the piece filled in, and you send the payment details (e.g. TWINT) yourself.

**With Stripe Checkout** (`"stripeCheckout": true`): the button says **Kaufen** and takes the customer to Stripe's payment page.
Shipping is added there (CHF 9 per order, free from CHF 100; `shippingPrice` and `freeShippingFrom` in `site.json`, the same values the AGB show),
along with the address and phone number (Switzerland and Liechtenstein only). While someone is at the checkout, the piece is held for
them for 30 minutes so it can't be sold twice. When they've paid, the piece is marked as sold automatically (a commit, so the site
rebuilds) and you get an email with the shipping address. The customer lands on `/thanks/`. Code: `functions/api/checkout.ts`,
`functions/api/stripe-webhook.ts`, `functions/_lib/stripe.ts`. The AGB and the privacy policy switch to the Stripe wording automatically.

Setup, once:

1. Create an account at [stripe.com](https://dashboard.stripe.com/register) and activate it (business details, bank account for payouts).
2. **Settings → Payment methods**: switch on what you want, e.g. cards, TWINT, Apple Pay and Google Pay.
3. **Settings → Emails**: switch on receipts for successful payments, so customers get a receipt.
4. **Developers → Webhooks → Add endpoint**: URL `https://secondsurf.ch/api/stripe-webhook`, events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `checkout.session.expired`. Copy the **signing secret** (`whsec_…`).
5. In **Cloudflare → Workers & Pages → secondsurf → Settings → Variables and Secrets**, add as secrets for Production:
   `STRIPE_SECRET_KEY` (Developers → API keys → Secret key, `sk_live_…`) and `STRIPE_WEBHOOK_SECRET` (`whsec_…`).
   The D1 binding `DB`, `GITHUB_TOKEN` and `RESEND_API_KEY` must be set too (see above); they are used for the hold, the sold mark and the email.
6. Set `"stripeCheckout": true` in `src/settings/site.json`, commit and push.

Test first with Stripe's test mode: use the test keys (`sk_test_…` and the test webhook's `whsec_…`) and pay with card `4242 4242 4242 4242`.
A test purchase really marks the piece as sold on the site: set it back to available in the dashboard afterwards.
Then swap in the live keys and redeploy. A piece with its own `buyUrl:` (e.g. a Stripe Payment Link) uses that link instead.

## Tracking numbers

Shipping an order (the shop in /admin, a seller in the profile) requires the Swiss Post tracking number, typed or scanned with
the camera: `public/scanner.js` (ZXing, built from `scripts/scanner-src.js` with `npm run build:scanner`, loaded only on tap).
`addTracking` in `functions/_lib/orders.ts` stores it (table `tracking`, per order and sender) and emails the buyer the Swiss Post
link plus `/tracking/?n=…`, a page with the number as a Code 128 barcode to scan into the Post-App.

## Cart (Warenkorb)

The piece page adds to a cart kept in the browser (`src/scripts/cart.ts`, localStorage `cart`); the header shows the count and
`/cart/` (`src/pages/[...lang]/cart.astro`) lists the pieces, drops sold or auctioned ones, and posts all ids plus the discount code to
`/api/checkout`. That holds every piece (all or nothing) and opens one Stripe Checkout with one line per piece and shipping per
order; metadata `product_ids` lets the webhook mark all of them sold in one commit. At most 8 pieces (`MAX_CART`). The thanks page
(`?order=1`) empties the cart.

## Price offers ("Preis vorschlagen")

Every available piece has a **Preis vorschlagen** button. Only logged-in customers can use it: logged out, it shows a
note with a login button that comes back to the piece. Name and email come from the customer account. Customers offer a price, at most 35 % below the shop price
(rounded up to whole francs; `MAX_DISCOUNT` in `functions/_lib/offers.ts`). You get an email, and the offer appears in the
dashboard under **Offers** (`/admin/#offers`), where you **accept**, **decline** or send a **counter-offer**.
The customer gets an email in their language with a link to `/offer/?t=…`, where they see the status, accept or decline
your counter-offer, and pay the agreed price. With Stripe Checkout on, they pay online (the piece is held during checkout and
marked as sold when paid); without it, you send the payment details yourself. An agreed price can be paid for 3 days.
Until it's paid, the piece is not reserved: whoever pays first gets it.

Needs the same setup as the forms below (Resend, Turnstile) plus the D1 binding `DB`, where offers are stored.
Code: `functions/_lib/offer-create.ts` (sent to `/api/account/offer`), `functions/api/offers/`, `functions/api/admin/offers/`, `src/components/OfferForm.astro`, `src/pages/[...lang]/offer.astro`.

## Auctions (Ricardo style)

Started in `/admin/#auctions` (start price + end). Everything lives in D1, so starting or ending an auction needs no rebuild:
the piece page asks `/api/auctions/view` and, while an auction runs or waits for payment, shows the auction box
(`src/components/AuctionBox.astro`) instead of the buy/offer part. `/api/checkout` and offers refuse the piece during that time.

- Rules, states, bidding and emails: `functions/_lib/auctions.ts`. API: `functions/api/auctions/[[path]].ts`; admin:
  `functions/api/admin/auctions/`. Texts: `src/i18n/auction.ts`. Terms: section 9 of `src/pages/[...lang]/terms.astro`.
- Bidding is by limit (proxy bidding): the price is one step (CHF 1) above the second-highest limit; equal limits → the earlier
  one leads. A bid is written with a conditional UPDATE on the auction's `version` in one D1 batch with its rows, so
  simultaneous bids can't both win. A bid in the last minute extends the end by 5 minutes.
  `GET /api/auctions/calendar?id=…&lang=…` gives the end as a calendar file with an alarm 15 minutes before.
- Bidders need a verified email, accepted terms (table `auction_terms`) and no block (`auction_blocks`, by email). Accounts
  without a paid order (table `purchases`, filled by the Stripe webhook) can lead one auction at a time and can't bid with an
  unpaid win.
- After the end the winner pays within 48 h on `/auction/?t=…` (also in the profile) through `startCheckout` with
  `auction_id` in the metadata; the webhook marks the auction paid and the piece sold. Reminder after 24 h; after 48 h the
  winner is blocked and the second-highest bidder gets an optional offer at their own limit; then the piece is back on sale.
- These steps run in `settle()` whenever an auction is viewed, bid on or listed, and every 10 minutes from
  `.github/workflows/auction-tick.yml` (`POST /api/auctions/tick`, safe to call any time).
- Auction lots: pieces with `auctionOnly: true` (e.g. bundles, size `Mix`) are left out of `getProducts()` (shop, categories,
  New Drop, home) but have their own piece page and are in `/products.json`; checkout and offers refuse them. The dashboard's
  "Auction only" box publishes the lot and starts its auction in one request (`functions/api/admin/products/index.ts`).
- `/auctions/` (`src/pages/[...lang]/auctions.astro`) lists every running auction from `/api/auctions/active` + `/products.json`.

## Forms (contact, stockist, sell once)

The forms send through `functions/api/forms.ts`: Turnstile stops bots, Resend emails you and sends the customer a short confirmation.
The contact, returns and both sell pages use them. Without `PUBLIC_TURNSTILE_SITE_KEY`, the forms are hidden on the live site.

1. **Turnstile:** in Cloudflare, go to **Turnstile → Add widget**, and add `secondsurf.ch`, `secondsurf.pages.dev` and `localhost`.
2. **Resend:** create an account at [resend.com](https://resend.com), add `secondsurf.ch` as a domain (this needs the domain to be active in Cloudflare) and create an API key.
3. **Cloudflare Pages settings:** add `PUBLIC_TURNSTILE_SITE_KEY` as a variable, and `TURNSTILE_SECRET_KEY` and `RESEND_API_KEY` as secrets. Then redeploy.

All names are listed in `.env.example`. The email address comes from `src/settings/site.json`. It's shown in plain text in the imprint and returns pages, and only after a click on the contact page.

## Texts and settings (Pages CMS)

Texts, contact details, banners, shipping prices and news can be edited at [app.pagescms.org](https://app.pagescms.org): log in with GitHub and pick the `secondsurf` repository. The setup is in `.pages.yml` in the repository root. Pieces are added at `/admin/`, not here.

The owner guide in German is in `OWNER-ANLEITUNG.md`. What's still missing before going live is in `CLIENT-CHECKLIST.md`.

Shipping is one price per order (`shippingPrice`, CHF 9) and free from `freeShippingFrom` (CHF 100), both in `src/settings/site.json`. The AGB page and the Stripe checkout read them from there.

## Deploy (Cloudflare Pages)

The Astro project lives in the subfolder `website/` of the Git repository.

1. Push the repository to GitHub.
2. In the [Cloudflare dashboard](https://dash.cloudflare.com): **Workers & Pages → Create → Pages → Connect to Git**, then pick `secondsurf`.
3. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - **Root directory: `website`**
   - Environment variable: `NODE_VERSION` = `24`
4. Every push to `main` now deploys automatically; other branches get preview URLs.
5. Custom domain: add `secondsurf.ch` to Cloudflare, switch the nameservers at your registrar to the two Cloudflare nameservers,
   then add the domain under **Pages project → Custom domains**. HTTPS is set up automatically.
   The domain is set in `astro.config.mjs` (`site`), `src/config.ts` (`url`) and `public/robots.txt`.
