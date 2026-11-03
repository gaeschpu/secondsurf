// Looks at the photos of a piece and suggests brand, title, category, size, condition and a
// description in all four languages. Nothing is saved: the dashboard fills the form, the owner checks it.
// Runs on Cloudflare Workers AI, which is free up to a daily allowance (10,000 neurons, roughly 30+ pieces).

import { CATEGORIES, CONDITIONS, SIZES } from '../../../src/config.ts';
import { json, type Handler } from '../../_lib/auth.ts';

const MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const MAX_PHOTOS = 4;
const MAX_BASE64 = 2 * 1024 * 1024; // the dashboard sends 1024 px photos, far below this
const LANGUAGES = ['de', 'fr', 'it', 'en'] as const;

const categoryIds: string[] = CATEGORIES.map((c) => c.id);
const sizes: string[] = [...SIZES];
const conditionIds = Object.keys(CONDITIONS);

const SYSTEM = `You write product listings for secondsurf, a Swiss online shop for second-hand surf clothing. Every piece is one of a kind.

From the photos, fill in the listing. Describe only what you can see: colour, cut, print or logo, material if the care label is readable, and visible wear. Don't invent a size, material or model name you can't read. If something important is unclear, leave it out rather than guess, because the owner checks the result before publishing.

Write like a friendly local shop, addressing the customer informally (du / tu / tu / you). No prices, no hype words, no emojis. German is Swiss Standard German: write "ss", never "ß".

Answer with only one JSON object, no other text, in exactly this shape:
{"brand": "...", "title": {"de": "...", "fr": "...", "it": "...", "en": "..."}, "description": {"de": "...", "fr": "...", "it": "...", "en": "..."}, "category": "...", "size": "...", "condition": "..."}

- brand: exactly as written on the label or logo, or "" if no brand is visible.
- title: short, without the brand, e.g. "Navy hoodie with logo", max. 60 characters.
- description: two or three short sentences.
- category: one of ${categoryIds.map((id) => `"${id}"`).join(', ')} (${CATEGORIES.map((c) => `${c.id} = ${c.label.en}`).join('; ')}).
- size: one of ${sizes.map((s) => `"${s}"`).join(', ')}, from the size label; "unknown" if no size label is readable.
- condition: one of ${Object.entries(CONDITIONS)
	.map(([id, label]) => `"${id}" (${label.en})`)
	.join(', ')}. Choose "new" only if a shop tag is still attached.`;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** The model sometimes wraps the JSON in text or code fences, or the binding already parsed it. */
function readAnswer(answer: unknown): Record<string, unknown> | null {
	if (answer && typeof answer === 'object') return answer as Record<string, unknown>;
	if (typeof answer !== 'string') return null;
	const start = answer.indexOf('{');
	const end = answer.lastIndexOf('}');
	if (start < 0 || end < start) return null;
	try {
		return JSON.parse(answer.slice(start, end + 1));
	} catch {
		return null;
	}
}

function inEveryLanguage(value: unknown) {
	const all = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	return Object.fromEntries(LANGUAGES.map((lang) => [lang, text(all[lang])])) as Record<(typeof LANGUAGES)[number], string>;
}

export const onRequestPost: Handler = async ({ request, env }) => {
	if (!env.AI) return json({ error: 'The AI is not set up yet. Add the Workers AI binding named AI in Cloudflare.' }, 503);
	if (Number(request.headers.get('Content-Length') ?? 0) > MAX_PHOTOS * MAX_BASE64) return json({ error: 'Photos are too big.' }, 413);

	const body = (await request.json().catch(() => null)) as { photos?: unknown } | null;
	const photos = Array.isArray(body?.photos) ? body.photos : [];
	if (photos.length < 1 || photos.length > MAX_PHOTOS) return json({ error: `Send 1 to ${MAX_PHOTOS} photos.` }, 400);
	// "/9j/" is how every JPEG starts once base64-encoded.
	if (!photos.every((p): p is string => typeof p === 'string' && p.startsWith('/9j/') && p.length <= MAX_BASE64)) {
		return json({ error: 'Not a JPEG photo.' }, 400);
	}

	let result: { response?: unknown };
	try {
		result = (await env.AI.run(MODEL, {
			max_tokens: 1500,
			temperature: 0.2,
			messages: [
				{ role: 'system', content: SYSTEM },
				{
					role: 'user',
					content: [
						...photos.map((data) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${data}` } })),
						{ type: 'text', text: 'Write the listing for this piece.' },
					],
				},
			],
		})) as { response?: unknown };
	} catch (error) {
		console.error(error);
		// On the free plan, Workers AI refuses further requests once the daily allowance is used up.
		const message = String((error as Error)?.message ?? error);
		if (/limit|quota|neuron|429|capacity/i.test(message)) {
			return json({ error: 'The free AI allowance for today is used up. Fill in the form yourself or try again tomorrow.' }, 429);
		}
		return json({ error: 'Could not reach the AI. Please try again.' }, 502);
	}

	const piece = readAnswer(result?.response);
	const title = inEveryLanguage(piece?.title);
	if (!piece || !title.de) {
		console.error('Unreadable AI answer', result?.response);
		return json({ error: 'The AI answer could not be read. Please try again or fill in the form yourself.' }, 502);
	}
	const category = text(piece.category);
	const size = text(piece.size);
	const condition = text(piece.condition);
	// Answers outside the lists are left blank for the owner to pick.
	return json({
		brand: text(piece.brand),
		title,
		description: inEveryLanguage(piece.description),
		category: categoryIds.includes(category) ? category : '',
		size: sizes.includes(size) ? size : 'unknown',
		condition: conditionIds.includes(condition) ? condition : '',
	});
};
