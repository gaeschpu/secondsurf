# secondsurf

Shop for second-hand surf clothing, built with [Astro](https://astro.build).
German lives at `/`, French at `/fr/`, English at `/en/`. No cookies, no tracking.
When you change a text, change it in all three languages (`de`, `fr`, `en`). A missing text falls back to German.

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
| Neuer Drop | `/new/` | All pieces with `drop:` = `currentDrop` in `src/config.ts` |
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
src/i18n/ui.ts             all short texts (menus, buttons, headings) in DE, FR, EN
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
   title: { de: "T-Shirt weiss", fr: "T-shirt blanc", en: "White tee" }
   category: tees            # one of the ids in CATEGORIES in src/config.ts
   size: M                   # XS, S, M, L, XL, XXL or One size
   sizeNote: "fällt klein aus"   # optional
   condition: veryGood       # new, likeNew, veryGood or good
   price: 25                 # CHF
   measurements: "Achsel zu Achsel 52 cm, Länge 70 cm"   # optional
   description: { de: "…", fr: "…", en: "…" }            # optional
   photos:
     - ./1.jpg
     - ./2.jpg
   drop: 1                   # shows under "Neuer Drop" when it matches currentDrop
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
Texts typed in the dashboard show in all three languages; edit `index.md` to translate them.
Photos are shrunk in the browser, which also removes the location. The dashboard only works on Cloudflare, not with `npm run dev`.

Setup, once. In **Cloudflare → Workers & Pages → secondsurf → Settings → Variables and Secrets**, add these as secrets for Production, then redeploy:

| Name | Value |
| --- | --- |
| `ADMIN_PASSWORD` | Your login password, at least 12 characters |
| `SESSION_SECRET` | A random text of at least 32 characters |
| `GITHUB_TOKEN` | A [fine-grained token](https://github.com/settings/personal-access-tokens/new) for only this repository, with **Contents: Read and write** |

Changing `ADMIN_PASSWORD` or `SESSION_SECRET` logs out every device. Fine-grained tokens expire, so renew `GITHUB_TOKEN` when the dashboard reports a GitHub error.

To test locally, put the same values in `.dev.vars` (git-ignored), then run `npm run build` and `npx wrangler pages dev dist`.
Careful: with a real token, this changes the real shop.

## Selling: how people pay

Right now each product has an **Anfragen** button: it opens the contact form with the piece already filled in,
and you send the payment details (e.g. TWINT) yourself. That works without any shop software.
To let people pay directly, create a payment link for the piece (for example a Stripe Payment Link) and add it as
`buyUrl: "https://…"`; the button then says **Kaufen**. A full cart and checkout (Shopify, Snipcart …) can come later.

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

To show shipping costs, the site uses Swiss Post's PostPac Economy prices at the counter, stored in `src/settings/site.json`. Check them each January, when Swiss Post usually adjusts prices.

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
