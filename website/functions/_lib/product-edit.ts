// Editing a published piece from the dashboard: reads all fields of src/content/products/<id>/index.md for the edit form,
// and writes changes back into the frontmatter. Uses the yaml package's document API, so everything not edited (photos,
// models, drop, comments) keeps its place and format.

import { parseDocument } from 'yaml';
import { CATEGORIES, CONDITIONS, SIZES } from '../../src/config.ts';
import { isValidPrice } from './product.ts';

const LANGS = ['de', 'fr', 'it', 'en'] as const;
type Localized = Record<(typeof LANGS)[number], string>;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/;

/** A localized field ("text" or { de, fr, it, en }) as four strings ('' = not translated). */
function localized(value: unknown): Localized {
	if (typeof value === 'string') return { de: value, fr: '', it: '', en: '' };
	const v = (value ?? {}) as Record<string, unknown>;
	return Object.fromEntries(LANGS.map((l) => [l, typeof v[l] === 'string' ? (v[l] as string) : ''])) as Localized;
}

/** The fields the edit form shows. */
export function readPiece(markdown: string) {
	const match = markdown.match(FRONTMATTER);
	if (!match) throw new Error('This piece file has no frontmatter.');
	const data = (parseDocument(match[1]).toJS() ?? {}) as Record<string, any>;
	return {
		brand: String(data.brand ?? ''),
		title: localized(data.title),
		category: String(data.category ?? ''),
		size: String(data.size ?? ''),
		sizeNote: String(data.sizeNote ?? ''),
		condition: String(data.condition ?? ''),
		price: Number(data.price ?? 0),
		measurements: String(data.measurements ?? ''),
		description: localized(data.description),
		staffPick: data.staffPick === true,
		auctionOnly: data.auctionOnly === true,
		sold: data.sold === true,
		photos: Array.isArray(data.photos) ? data.photos.length : 0,
	};
}

export type PieceFields = ReturnType<typeof readPiece>;

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Cleans what the form sent. Returns the fields, or a message saying what is wrong. */
export function parseEdit(body: any): Omit<PieceFields, 'sold' | 'photos'> | string {
	const loc = (value: unknown, max: number) => {
		const v = (value ?? {}) as Record<string, unknown>;
		return Object.fromEntries(LANGS.map((l) => [l, text(v[l], max)])) as Localized;
	};
	const edit = {
		brand: text(body?.brand, 80),
		title: loc(body?.title, 120),
		category: text(body?.category, 40),
		size: text(body?.size, 20),
		sizeNote: text(body?.sizeNote, 60),
		condition: text(body?.condition, 20),
		price: Number(body?.price),
		measurements: text(body?.measurements, 200),
		description: loc(body?.description, 2000),
		staffPick: body?.staffPick === true,
		auctionOnly: body?.auctionOnly === true,
	};
	if (!edit.brand) return 'Brand is missing.';
	if (!edit.title.de) return 'The German title is missing.';
	if (!CATEGORIES.some((c) => c.id === edit.category)) return 'Pick a category.';
	if (!(SIZES as readonly string[]).includes(edit.size)) return 'Pick a size.';
	if (!Object.keys(CONDITIONS).includes(edit.condition)) return 'Pick a condition.';
	if (!isValidPrice(edit.price)) return 'Enter a price above 0.';
	return edit;
}

/** Writes the edited fields into the piece file. Empty optional fields are removed; empty translations fall back to German. */
export function writePiece(markdown: string, edit: Exclude<ReturnType<typeof parseEdit>, string>) {
	const match = markdown.match(FRONTMATTER);
	if (!match) throw new Error('This piece file has no frontmatter.');
	const doc = parseDocument(match[1]);
	const setOrDelete = (key: string, value: unknown) => (value === '' || value === false || value === undefined ? doc.delete(key) : doc.set(key, value));
	const localizedValue = (v: Localized) => {
		const filled = Object.fromEntries(LANGS.filter((l) => v[l]).map((l) => [l, v[l]]));
		return Object.keys(filled).length === 1 ? v.de : filled;
	};

	doc.set('brand', edit.brand);
	const title = doc.createNode(localizedValue(edit.title));
	if (typeof title === 'object' && title && 'flow' in title) (title as { flow: boolean }).flow = true;
	doc.set('title', title);
	doc.set('category', edit.category);
	doc.set('size', edit.size);
	setOrDelete('sizeNote', edit.sizeNote);
	doc.set('condition', edit.condition);
	doc.set('price', edit.price);
	setOrDelete('measurements', edit.measurements);
	if (edit.description.de) doc.set('description', localizedValue(edit.description));
	else doc.delete('description');
	setOrDelete('staffPick', edit.staffPick);
	setOrDelete('auctionOnly', edit.auctionOnly);

	const body = doc.toString({ lineWidth: 0 }).replace(/\n$/, '');
	return markdown.replace(FRONTMATTER, `---\n${body}\n---${match[2]}`);
}
