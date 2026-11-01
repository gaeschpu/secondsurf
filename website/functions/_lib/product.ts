// Reads and writes the frontmatter of src/content/products/<id>/index.md (schema: src/content.config.ts).

import { CATEGORIES, CONDITIONS, SIZES } from '../../src/config.ts';

export const PRODUCT_ID = /^\d{4,}-[a-z0-9-]+$/;
export const BLOB_SHA = /^[0-9a-f]{40}$/;
export const MAX_PHOTOS = 8;

export interface NewProduct {
	brand: string;
	title: string;
	category: string;
	size: string;
	condition: string;
	price: number;
	measurements: string;
	description: string;
	staffPick: boolean;
	photos: string[];
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Returns the cleaned piece, or a message saying what is wrong with it. */
export function parseNewProduct(body: any): NewProduct | string {
	const product: NewProduct = {
		brand: text(body?.brand, 80),
		title: text(body?.title, 120),
		category: text(body?.category, 40),
		size: text(body?.size, 20),
		condition: text(body?.condition, 20),
		price: Number(body?.price),
		measurements: text(body?.measurements, 200),
		description: text(body?.description, 2000),
		staffPick: body?.staffPick === true,
		photos: Array.isArray(body?.photos) ? body.photos : [],
	};
	if (!product.brand) return 'Brand is missing.';
	if (!product.title) return 'Title is missing.';
	if (!CATEGORIES.some((c) => c.id === product.category)) return 'Pick a category.';
	if (!(SIZES as readonly string[]).includes(product.size)) return 'Pick a size.';
	if (!Object.keys(CONDITIONS).includes(product.condition)) return 'Pick a condition.';
	if (!Number.isFinite(product.price) || product.price <= 0 || product.price > 100000) return 'Enter a price above 0.';
	if (product.photos.length < 1 || product.photos.length > MAX_PHOTOS) return `Add 1 to ${MAX_PHOTOS} photos.`;
	if (!product.photos.every((sha) => typeof sha === 'string' && BLOB_SHA.test(sha))) return 'A photo did not upload correctly.';
	return product;
}

/** "0007-oneill-white-tee": the number sorts it, the rest becomes the address. */
export function folderName(number: number, product: Pick<NewProduct, 'brand' | 'title'>) {
	const slug = `${product.brand} ${product.title}`
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 50)
		.replace(/-+$/, '');
	return `${String(number).padStart(4, '0')}-${slug || 'piece'}`;
}

export function nextNumber(names: string[]) {
	return Math.max(0, ...names.map((name) => Number(name.match(/^(\d+)-/)?.[1] ?? 0))) + 1;
}

/** JSON strings are valid YAML, so quotes and colons in a title can't break the file. */
export function toMarkdown(product: NewProduct, drop: number) {
	const lines = [
		'---',
		`brand: ${JSON.stringify(product.brand)}`,
		`title: ${JSON.stringify(product.title)}`,
		`category: ${product.category}`,
		`size: ${JSON.stringify(product.size)}`,
		`condition: ${product.condition}`,
		`price: ${product.price}`,
		...(product.measurements ? [`measurements: ${JSON.stringify(product.measurements)}`] : []),
		...(product.description ? [`description: ${JSON.stringify(product.description)}`] : []),
		'photos:',
		...product.photos.map((_, i) => `  - ./${i + 1}.jpg`),
		`drop: ${drop}`,
		...(product.staffPick ? ['staffPick: true'] : []),
		'---',
		'',
	];
	return lines.join('\n');
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---/;

export function setSold(markdown: string, sold: boolean) {
	return markdown.replace(FRONTMATTER, (_, body: string) => {
		const kept = body.split(/\r?\n/).filter((line) => !/^sold:/.test(line));
		return ['---', ...kept, ...(sold ? ['sold: true'] : []), '---'].join('\n');
	});
}

function unquote(value: string) {
	const trimmed = value.trim();
	if (!trimmed.startsWith('"')) return trimmed.replace(/^'|'$/g, '');
	try {
		return JSON.parse(trimmed) as string;
	} catch {
		return trimmed;
	}
}

/** Just enough to show the piece in the dashboard list. Handles hand-written files as well as our own. */
export function summarize(id: string, markdown: string) {
	const body = markdown.match(FRONTMATTER)?.[1] ?? '';
	const scalar = (key: string) => body.match(new RegExp(`^${key}:[ \\t]*(.+)$`, 'm'))?.[1];
	const titleLine = scalar('title') ?? '';
	const german = /de:\s*("(?:[^"\\]|\\.)*"|[^,}\n]+)/;
	const title = titleLine.startsWith('{')
		? titleLine.match(german)?.[1]
		: titleLine || body.match(/^title:\s*\n\s+de:\s*(.+)$/m)?.[1];
	return {
		id,
		brand: unquote(scalar('brand') ?? ''),
		title: unquote(title ?? ''),
		price: Number(scalar('price')) || 0,
		size: unquote(scalar('size') ?? ''),
		sold: /^sold:\s*true\b/m.test(body),
		draft: /^draft:\s*true\b/m.test(body),
		photo: body.match(/^\s+-\s+\.\/(\S+)/m)?.[1] ?? null,
	};
}
