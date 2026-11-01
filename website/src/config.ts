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

/** Who runs the shop, for the imprint and the legal pages. */
export const OWNER = {
	name: settings.ownerName,
	legalForm: settings.legalForm,
	address: [settings.addressLine1, settings.addressLine2].filter(Boolean),
	uid: settings.uid,
	/** While false, the legal pages show a visible "template" note. */
	legalReviewed: settings.legalReviewed,
};

/** Swiss Post PostPac Economy prices in CHF, free from `freeFrom`. */
export const SHIPPING = {
	freeFrom: settings.freeShippingFrom,
	upTo2kg: settings.shippingUpTo2kg,
	upTo10kg: settings.shippingUpTo10kg,
};

/** Bar at the very top of every page. Leave the German text empty to hide it. */
export const ANNOUNCEMENT: Localized = settings.announcement;

/** Holiday notice above the announcement bar, switched on and off in the settings. */
export const HOLIDAY_BANNER: Localized = settings.holidayBanner.enabled ? { de: settings.holidayBanner.de, fr: settings.holidayBanner.fr || undefined, en: settings.holidayBanner.en || undefined } : '';

export const SOCIALS = [{ label: 'Instagram', handle: settings.instagramHandle, href: settings.instagramUrl, icon: 'instagram' }] as const;

/**
 * Shop categories. The `id` is used in the product files (`category: hoodies`) and in the address (/shop/hoodies/).
 * Add, remove or rename freely; the menu and the shop pages follow automatically.
 */
export const CATEGORIES = [
	{ id: 'hoodies', label: { de: 'Hoodies & Pullover', fr: 'Sweats & pulls', en: 'Hoodies & jumpers' } },
	{ id: 'tees', label: { de: 'T-Shirts', fr: 'T-shirts', en: 'Tees' } },
	{ id: 'longsleeves', label: { de: 'Longsleeves', fr: 'Manches longues', en: 'Longsleeves' } },
	{ id: 'jackets', label: { de: 'Jacken', fr: 'Vestes', en: 'Jackets' } },
	{ id: 'boardshorts', label: { de: 'Boardshorts', fr: 'Boardshorts', en: 'Boardshorts' } },
	{ id: 'swim', label: { de: 'Bikinis & Badehosen', fr: 'Bikinis & maillots', en: 'Bikinis & swim' } },
	{ id: 'wetsuits', label: { de: 'Neoprenanzüge', fr: 'Combinaisons', en: 'Wetsuits' } },
	{ id: 'headwear', label: { de: 'Caps & Mützen', fr: 'Casquettes & bonnets', en: 'Caps & beanies' } },
	{ id: 'accessories', label: { de: 'Accessoires', fr: 'Accessoires', en: 'Accessories' } },
] as const satisfies readonly { id: string; label: Localized }[];

export type CategoryId = (typeof CATEGORIES)[number]['id'];

/** Sizes offered in the size filter, in this order. */
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'] as const;

/** Condition grades for second-hand pieces. */
export const CONDITIONS = {
	new: { de: 'Neu mit Etikett', fr: 'Neuf avec étiquette', en: 'New with tags' },
	likeNew: { de: 'Wie neu', fr: 'Comme neuf', en: 'Like new' },
	veryGood: { de: 'Sehr gut', fr: 'Très bon état', en: 'Very good' },
	good: { de: 'Gut, mit Gebrauchsspuren', fr: 'Bon, traces d’usure', en: 'Good, some wear' },
} as const satisfies Record<string, Localized>;
