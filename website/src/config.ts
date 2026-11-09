// Central site settings. Contact details, banners, shipping prices and the current drop live in
// src/settings/site.json, so they can be edited in Pages CMS. Categories, sizes and conditions are here.

import type { Localized } from './i18n';
import settings from './settings/site.json';

export const SITE = {
	url: 'https://secondsurf.ch',
	name: 'secondsurf',
	email: settings.email,
	phone: settings.phone,
	// Number of the current drop. Items with `drop:` equal to this number appear under "New drop".
	currentDrop: settings.currentDrop,
};

/**
 * When the current drop goes live, as Swiss local time ("2026-11-12T16:00", the format Pages CMS saves).
 * Until then, the New Drop page shows a countdown and a reminder button; reminder emails go out at this time.
 */
export const DROP = {
	number: settings.currentDrop,
	at: zurichTime(settings.nextDropAt ?? ''),
};

/** "2026-11-12T16:00" in Swiss time (CET or CEST) to a Date. A time with Z or an offset is taken as is. */
export function zurichTime(value: string): Date | null {
	if (!value) return null;
	if (/[zZ]|[+-]\d\d:?\d\d$/.test(value)) return new Date(value);
	const asUtc = new Date(`${value.length === 16 ? `${value}:00` : value}Z`);
	if (Number.isNaN(asUtc.getTime())) return null;
	// The offset of Zurich at that moment, e.g. +01:00 in winter, +02:00 in summer.
	const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zurich', timeZoneName: 'shortOffset' }).formatToParts(asUtc);
	const offset = parts.find((p) => p.type === 'timeZoneName')?.value.match(/GMT([+-]\d+)(?::(\d+))?/);
	const minutes = offset ? Number(offset[1]) * 60 + Math.sign(Number(offset[1])) * Number(offset[2] ?? 0) : 60;
	return new Date(asUtc.getTime() - minutes * 60_000);
}

/** Who runs the shop, for the imprint and the legal pages. */
export const OWNER = {
	name: settings.ownerName,
	legalForm: settings.legalForm,
	address: [settings.addressLine1, settings.addressLine2].filter(Boolean),
	uid: settings.uid,
	/** While false, the legal pages show a visible "template" note. */
	legalReviewed: settings.legalReviewed,
};

/** Shipping in Switzerland and Liechtenstein: one price per order (CHF), free from `freeFrom`. Same as the AGB. */
export const SHIPPING = {
	freeFrom: settings.freeShippingFrom,
	price: settings.shippingPrice,
};

/** Bar at the very top of every page. Leave the German text empty to hide it. */
export const ANNOUNCEMENT: Localized = settings.announcement;

/** Holiday notice above the announcement bar, switched on and off in the settings. */
export const HOLIDAY_BANNER: Localized = settings.holidayBanner.enabled ? { de: settings.holidayBanner.de, fr: settings.holidayBanner.fr || undefined, it: settings.holidayBanner.it || undefined, en: settings.holidayBanner.en || undefined } : '';

export const SOCIALS = [{ label: 'Instagram', handle: settings.instagramHandle, href: settings.instagramUrl, icon: 'instagram' }] as const;

/**
 * Shop categories. The `id` is used in the product files (`category: hoodies`) and in the address (/shop/hoodies/).
 * Add, remove or rename freely; the menu and the shop pages follow automatically.
 */
export const CATEGORIES = [
	{ id: 'hoodies', label: { de: 'Hoodies & Pullover', fr: 'Sweats & pulls', it: 'Felpe & maglioni', en: 'Hoodies & jumpers' } },
	{ id: 'tees', label: { de: 'T-Shirts', fr: 'T-shirts', it: 'T-shirt', en: 'Tees' } },
	{ id: 'longsleeves', label: { de: 'Longsleeves', fr: 'Manches longues', it: 'Maniche lunghe', en: 'Longsleeves' } },
	{ id: 'jackets', label: { de: 'Jacken', fr: 'Vestes', it: 'Giacche', en: 'Jackets' } },
	{ id: 'boardshorts', label: { de: 'Boardshorts', fr: 'Boardshorts', it: 'Boardshort', en: 'Boardshorts' } },
	{ id: 'swim', label: { de: 'Bikinis & Badehosen', fr: 'Bikinis & maillots', it: 'Bikini & costumi', en: 'Bikinis & swim' } },
	{ id: 'wetsuits', label: { de: 'Neoprenanzüge', fr: 'Combinaisons', it: 'Mute', en: 'Wetsuits' } },
	{ id: 'headwear', label: { de: 'Caps & Mützen', fr: 'Casquettes & bonnets', it: 'Cappellini & berretti', en: 'Caps & beanies' } },
	{ id: 'accessories', label: { de: 'Accessoires', fr: 'Accessoires', it: 'Accessori', en: 'Accessories' } },
] as const satisfies readonly { id: string; label: Localized }[];

export type CategoryId = (typeof CATEGORIES)[number]['id'];

/** Sizes offered in the size filter, in this order. */
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'] as const;

/** Condition grades for second-hand pieces. */
export const CONDITIONS = {
	new: { de: 'Neu mit Etikett', fr: 'Neuf avec étiquette', it: 'Nuovo con etichetta', en: 'New with tags' },
	likeNew: { de: 'Wie neu', fr: 'Comme neuf', it: 'Come nuovo', en: 'Like new' },
	veryGood: { de: 'Sehr gut', fr: 'Très bon état', it: 'Molto buono', en: 'Very good' },
	good: { de: 'Gut, mit Gebrauchsspuren', fr: 'Bon, traces d’usure', it: 'Buono, con segni d’uso', en: 'Good, some wear' },
} as const satisfies Record<string, Localized>;

/**
 * Online payment with Stripe Checkout (functions/api/checkout.ts). Switch it on with "stripeCheckout": true in
 * src/settings/site.json once STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set in Cloudflare (see README).
 */
export const CHECKOUT = {
	enabled: settings.stripeCheckout === true,
};

/**
 * Welcome discount: after creating an account, customers get this code once, for their first order.
 * Only logged-in customers can use it, once per account (functions/api/checkout.ts checks this).
 */
export const WELCOME = { code: 'WELCOME10', percent: 10 } as const;
