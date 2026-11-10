// Content collections: every folder in src/content/ is described here.
// Frontmatter is validated at build time, so typos show up as clear errors.

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { CATEGORIES, CONDITIONS, SIZES } from './config';

/** Pages CMS may save an unfilled language as null or "". */
const optionalText = z.string().nullish().transform((text) => text || undefined);

/** A text that is the same in all languages ("Foo") or translated ({ de: "Foo", fr: …, en: … }). */
const localized = z.union([z.string(), z.object({ de: z.string(), fr: optionalText, it: optionalText, en: optionalText })]);

const categoryIds = CATEGORIES.map((c) => c.id) as [string, ...string[]];
const conditionIds = Object.keys(CONDITIONS) as [keyof typeof CONDITIONS, ...(keyof typeof CONDITIONS)[]];

/**
 * One folder per piece: src/content/products/0001-quiksilver-hoodie/ with index.md and the photos next to it.
 * The folder name becomes the address: /item/0001-quiksilver-hoodie/. Higher numbers are shown first.
 */
const products = defineCollection({
	loader: glob({ pattern: '*/index.md', base: './src/content/products' }),
	schema: ({ image }) =>
		z.object({
			brand: z.string(),
			title: localized,
			category: z.enum(categoryIds),
			size: z.enum(SIZES),
			/** Extra size info, e.g. "fits like M" or "W32". */
			sizeNote: z.string().optional(),
			condition: z.enum(conditionIds),
			/** Price in CHF. */
			price: z.number().positive(),
			description: localized.optional(),
			/** e.g. "Pit to pit 56 cm, length 70 cm" */
			measurements: z.string().optional(),
			/** First photo = the one on the card, the second one shows on hover. */
			photos: z.array(image()).default([]),
			/**
			 * Which photos show a model, by photo number (1 = first photo), e.g. { women: [3, 4], men: [1, 2] }.
			 * Logged-in customers who chose "women" or "men" in their profile see those model photos first.
			 */
			models: z
				.object({ women: z.array(z.number().int().positive()).default([]), men: z.array(z.number().int().positive()).default([]) })
				.default({ women: [], men: [] }),
			/** Drop number (see currentDrop in src/config.ts). */
			drop: z.number().int().optional(),
			/**
			 * Auction lot: only sold by auction (a single piece or a bundle). Never listed in the shop, the categories, New Drop
			 * or the home page, never buyable at a fixed price; shown on /auctions/ while its auction runs.
			 */
			auctionOnly: z.boolean().default(false),
			/** Shown in the "Staff Picks" row on the home page. */
			staffPick: z.boolean().default(false),
			sold: z.boolean().default(false),
			/** Who supplied the piece (stockist name). Never shown on the site, only for your bookkeeping. */
			stockist: z.string().optional(),
			/** Optional payment link (e.g. Stripe Payment Link). Without it the button says "Ask about it". */
			buyUrl: z.url().optional(),
			/** Draft: only visible with `npm run dev`, never on the live site. */
			draft: z.boolean().default(false),
		}),
});

/** News from src/content/news/, edited in Pages CMS. Only German is required. */
const news = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/news' }),
	schema: z.object({
		date: z.coerce.date(),
		title: localized,
		text: localized,
	}),
});

export const collections = { products, news };
