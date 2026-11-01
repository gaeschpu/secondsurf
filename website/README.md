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
| AGB, Datenschutz, Impressum | `/terms/`, `/privacy/`, `/imprint/` | **TODO: legal texts** (an imprint is mandatory for Swiss online shops) |

## Where things live

```
src/content/products/      one folder per piece: index.md + its photos
src/config.ts              name, email, Instagram, announcement bar, current drop, categories, sizes, conditions
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
For a new drop, raise `currentDrop` in `src/config.ts` and give the new pieces that number.
The four example pieces (`0001`–`0004`) are drafts: they only show in `npm run dev`. Delete them once you have real ones.
Big phone photos are fine: they are resized and compressed automatically. Strip the location from photos first.

## Selling: how people pay

Right now each product has an **Anfragen** button: it opens the contact form with the piece already filled in,
and you send the payment details (e.g. TWINT) yourself. That works without any shop software.
To let people pay directly, create a payment link for the piece (for example a Stripe Payment Link) and add it as
`buyUrl: "https://…"`; the button then says **Kaufen**. A full cart and checkout (Shopify, Snipcart …) can come later.

## Forms (contact, stockist, sell once)

The email address is never in the HTML; it is assembled in the browser when someone clicks "Show email address".
Set the real address in `emailUser` / `emailDomain` in `src/config.ts`.
To enable the forms, get a free access key at [web3forms.com](https://web3forms.com) and paste it into `web3formsKey`
in `src/config.ts`. Without a key, the forms are hidden on the live site.

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
