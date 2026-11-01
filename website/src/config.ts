// Central site settings. Edit names, links, categories and contact info here.

import type { Localized } from './i18n';

export const SITE = {
	url: 'https://secondsurf.ch',
	name: 'secondsurf',
	// The email is stored in two parts and only assembled in the browser
	// after a click, so spam bots scraping the HTML don't find it.
	// TODO: put the real address here.
	emailUser: 'hello',
	emailDomain: 'secondsurf.ch',
	// TODO: create a free access key at https://web3forms.com and paste it here.
	// Leave empty to hide the forms (contact, stockist, sell once) on the live site.
	web3formsKey: '',
	// Number of the current drop. Items with `drop:` equal to this number appear under "New drop".
	currentDrop: 1,
};

/** Bar at the very top of every page. Leave empty ('') to hide it. */
export const ANNOUNCEMENT: Localized = {
	de: '☆ Versand innert 2 Arbeitstagen in der ganzen Schweiz ☆',
	fr: '☆ Envoi sous 2 jours ouvrables dans toute la Suisse ☆',
	en: '☆ We ship within 2 business days all over Switzerland ☆',
};

// TODO: put the real Instagram handle here.
export const SOCIALS = [
	{ label: 'Instagram', handle: '@secondsurf.ch', href: 'https://www.instagram.com/secondsurf.ch/', icon: 'instagram' },
] as const;

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
