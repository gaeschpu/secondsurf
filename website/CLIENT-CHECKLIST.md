# Before going live

## Must be done

- [ ] **Contact address for the imprint.** Required by law; the imprint page shows a TODO until it's set. Use a business address or a c/o address rather than a home address, then fill in `addressLine1` and `addressLine2` in `src/settings/site.json`.
- [ ] **Legal check.** Have the imprint, privacy policy, terms and returns text checked by a specialist, then set `legalReviewed` to `true` to hide the note on those pages.
- [ ] **Gift card instead of money.** Ask the specialist specifically about wrong or faulty pieces: the terms give only a gift card, but also keep the statutory warranty rights (Art. 197 ff. OR), which can include money back. Those two points need to be reconciled.
- [ ] **Commercial register.** Check whether the Einzelfirma must be registered. If it's registered, the imprint must say so, and may need the owner's surname in the company name.
- [ ] **Domain.** `secondsurf.ch` must be active in Cloudflare and added to the Pages project.
- [ ] **Forms.** Set up Turnstile and Resend (see README). Until then, forms are hidden and customers can only reach you by email or Instagram.
- [ ] **Dashboard.** Add the three secrets in Cloudflare (see README).
- [ ] **Pages CMS.** Connect it to the repository and try saving once.
- [ ] **Test on a real phone.** Add a test piece, mark it sold, delete it, and send each form once.

## Please confirm: drafted without the owner's input

- [ ] **Returns:** the reasons, the 14-day limit, and who pays return shipping. Decide how long gift cards stay valid.
- [ ] **Delivery time:** the 2 business days in the top bar and terms.
- [ ] **Sell pages:** the 50 % share, monthly payout and other deal details.
- [ ] **Shipping:** Swiss Post PostPac Economy prices, as of 2026. Priority costs CHF 1.50 more.
- [ ] **Instagram:** that `@secondsurf.ch` is the real handle.
- [ ] **About and start page texts:** first drafts, ideally in your own words.

## Content

- [ ] Delete the four example pieces (`0001` to `0004`) in the dashboard.
- [ ] Add real pieces with photos.
- [ ] Optional: a hero photo for the start page, instead of the gradient.

## Later

- [ ] Payments with Stripe (TWINT and cards), including the cart, the AGB checkbox and the "Zahlungspflichtig bestellen" button. Update the privacy policy and terms at the same time.
