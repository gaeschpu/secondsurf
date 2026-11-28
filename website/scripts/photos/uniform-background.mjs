// Same studio background on every model photo: cuts out the person (ISNet, the model rembg uses; runs locally, free),
// puts them on one uniform colour with a soft floor shadow. The person and the clothes are not changed: their pixels are
// copied 1:1 from the original; only the background around them is replaced. Size and ratio stay the same.
//
//   npm run photos:background -- 0013                 every model photo of piece 0013 (photo numbers from "models:" in index.md)
//   npm run photos:background -- 0013 --photos 1,2    only these photos
//   npm run photos:background -- --all                every piece
//   add --preview <folder>                            write before/after into that folder instead of changing anything
//   add --seller                                      sellers' photos (any floor): process all but the ones listed in "labels"
//   npm run photos:background -- --pending            approved seller pieces waiting for photos: flat-lay + ironing, then online
//                                                     (GitHub runs this after every push: .github/workflows/seller-photos.yml)
//
// Before a photo is replaced, the original is copied to ../raw-docs/photo-originals/<piece>/ (not in the repository; the
// originals are also in the git history). A photo that was already processed is skipped (list in .uniform-background.json
// in the piece's folder), so running it again is safe.
//
// The model (180 MB) is downloaded once into ~/.cache/secondsurf/.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import ort from 'onnxruntime-node';

// Windows: sharp's file cache keeps the original open, and the photo can't be overwritten.
sharp.cache(false);

/** The background: a warm light grey between the site's sand (#f5f2ea) and a neutral studio grey. */
export const BACKGROUND = { r: 0xec, g: 0xea, b: 0xe5 }; // #ECEAE5

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PRODUCTS = path.join(ROOT, 'src/content/products');
const BACKUP = path.resolve(ROOT, '../raw-docs/photo-originals');
const MODEL_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx';
const MODEL = path.join(os.homedir(), '.cache/secondsurf/isnet-general-use.onnx');
const SIZE = 1024;

async function session() {
	if (!fs.existsSync(MODEL)) {
		console.log('Downloading the cut-out model (180 MB, once)…');
		fs.mkdirSync(path.dirname(MODEL), { recursive: true });
		const res = await fetch(MODEL_URL);
		if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
		fs.writeFileSync(MODEL, Buffer.from(await res.arrayBuffer()));
	}
	return ort.InferenceSession.create(MODEL);
}

/** Alpha mask (0–255, original size) of the person: ISNet at 1024×1024, normalised like rembg. */
async function personMask(model, file, width, height) {
	const { data } = await sharp(file).removeAlpha().resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
	const input = new Float32Array(3 * SIZE * SIZE);
	for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + i] = data[i * 3 + c] / 255 - 0.5;
	const out = await model.run({ [model.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
	const pred = out[model.outputNames[0]].data;
	let lo = Infinity;
	let hi = -Infinity;
	for (const v of pred) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
	const small = Buffer.alloc(SIZE * SIZE);
	for (let i = 0; i < small.length; i++) small[i] = Math.round(((pred[i] - lo) / (hi - lo || 1)) * 255);
	return sharp(small, { raw: { width: SIZE, height: SIZE, channels: 1 } }).resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).extractChannel(0).raw().toBuffer();
}

/** The new photo: background colour, a soft shadow under the feet, then the original person on top (same pixels). */
export async function processPhoto(model, file) {
	const meta = await sharp(file).metadata();
	const { width, height } = meta;
	const mask = await personMask(model, file, width, height);

	// Where the person stands: the lowest rows of the mask, and their width there.
	let bottom = 0;
	let left = width;
	let right = 0;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			if (mask[y * width + x] > 128) {
				bottom = Math.max(bottom, y);
				if (y > height * 0.5) (left = Math.min(left, x)), (right = Math.max(right, x));
			}
	const cx = (left + right) / 2;
	const rx = Math.max(width * 0.12, (right - left) * 0.55);
	const ry = Math.max(8, height * 0.018);
	const shadowY = Math.min(height - ry, bottom - ry * 0.2);
	// A flat ellipse, blurred as a raster (an SVG blur gets clipped and leaves a visible edge).
	const shadow = await sharp(
		Buffer.from(
			`<svg width="${width}" height="${height}"><ellipse cx="${cx}" cy="${shadowY}" rx="${rx}" ry="${ry}" fill="rgb(40,36,30)" fill-opacity="0.26"/></svg>`,
		),
	)
		.blur(Math.max(4, ry * 1.1))
		.png()
		.toBuffer();

	// Plain RGB first, then the mask as alpha (sharp would otherwise apply removeAlpha after joinChannel).
	const rgb = await sharp(file).removeAlpha().raw().toBuffer();
	const person = await sharp(rgb, { raw: { width, height, channels: 3 } }).joinChannel(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
	const image = sharp({ create: { width, height, channels: 3, background: BACKGROUND } }).composite([{ input: shadow }, { input: person }]);
	return /\.png$/i.test(file) ? image.png().toBuffer() : image.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

// ---------------------------------------------------------------- flat lay (photos of the piece itself)

/** Flat-lay photos: always this size (4:5), the piece centred on a light concrete floor. */
const FLAT = { width: 1200, height: 1500, fill: 0.84 };

/** The concrete floor: grey with soft mottling and fine grain. Same seed = the very same floor on every photo. */
async function concrete(width, height) {
	let seed = 20261124;
	const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
	const layer = async (w, h, amp, blur) => {
		const buf = Buffer.alloc(w * h);
		for (let i = 0; i < buf.length; i++) buf[i] = 128 + Math.round((rand() - 0.5) * 2 * amp);
		let img = sharp(buf, { raw: { width: w, height: h, channels: 1 } }).resize(width, height, { fit: 'fill', kernel: 'cubic' });
		if (blur) img = img.blur(blur);
		// One channel exactly (sharp may hand back three after resizing, which shows as streaks).
		return img.extractChannel(0).raw().toBuffer();
	};
	const [big, mid, fine] = await Promise.all([layer(12, 15, 60, 30), layer(60, 75, 50, 6), layer(width, height, 22, 0.6)]);
	const out = Buffer.alloc(width * height * 3);
	const base = [190, 188, 184]; // #BEBCB8, a light warm concrete
	for (let i = 0; i < width * height; i++) {
		const d = (big[i] - 128) * 0.22 + (mid[i] - 128) * 0.16 + (fine[i] - 128) * 0.35;
		for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.max(0, Math.min(255, Math.round(base[c] + d)));
	}
	return sharp(out, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
let floor = null;

/** True for a photo of the piece on a light background (not a close-up of a label): the corners are nearly white. */
async function isFlatLay(file) {
	const { data, info } = await sharp(file).rotate().removeAlpha().resize(40, 50, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
	const at = (x, y) => data.slice((y * info.width + x) * 3, (y * info.width + x) * 3 + 3);
	const corners = [at(1, 1), at(38, 1), at(1, 48), at(38, 48)];
	return corners.every((px) => px[0] > 215 && px[1] > 215 && px[2] > 215);
}

/** Box mean of a float image (radius r) with an integral image: O(n), any radius. */
function boxMean(src, w, h, r) {
	const sat = new Float64Array((w + 1) * (h + 1));
	for (let y = 0; y < h; y++) {
		let row = 0;
		for (let x = 0; x < w; x++) {
			row += src[y * w + x];
			sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
		}
	}
	const out = new Float32Array(w * h);
	for (let y = 0; y < h; y++) {
		const y0 = Math.max(0, y - r);
		const y1 = Math.min(h, y + r + 1);
		for (let x = 0; x < w; x++) {
			const x0 = Math.max(0, x - r);
			const x1 = Math.min(w, x + r + 1);
			out[y * w + x] = (sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0]) / ((y1 - y0) * (x1 - x0));
		}
	}
	return out;
}

/** Self-guided filter (He et al.): smooths weak, gradual changes, keeps strong edges. */
function guided(p, w, h, r, eps) {
	const meanP = boxMean(p, w, h, r);
	const sq = p.map((v) => v * v);
	const meanPP = boxMean(sq, w, h, r);
	const a = new Float32Array(p.length);
	const b = new Float32Array(p.length);
	for (let i = 0; i < p.length; i++) {
		const v = meanPP[i] - meanP[i] * meanP[i];
		a[i] = v / (v + eps);
		b[i] = meanP[i] - a[i] * meanP[i];
	}
	const ma = boxMean(a, w, h, r);
	const mb = boxMean(b, w, h, r);
	return p.map((v, i) => ma[i] * v + mb[i]);
}

/**
 * --iron: evens out the soft light and shadow of creases, like frequency-separation retouching. Broad shading is flattened
 * by a guided filter, the fine texture (weave, stitches) is added back, and the area around strong edges (prints, logos,
 * seams, colour blocks) is left alone, so nothing gets a halo. Only brightness changes; colours and outline stay.
 * Small marks or stains are fine detail and are not removed (the piece's real condition stays visible).
 */
/** Ironing settings (stronger settings left streaks in the fabric of boardshorts, so one gentle setting for everything). */
const IRON = {
	default: { strength: 0.9, eps: 0.03, radius: 28, edge: 0.12 },
};
export const ironFor = (category) => IRON[category] ?? IRON.default;

export async function iron(png, w, h, { strength, eps, radius, edge: edgeLimit } = IRON.default) {
	const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const n = w * h;
	const lum = new Float32Array(n);
	let sum = 0;
	let count = 0;
	for (let i = 0; i < n; i++) {
		const l = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
		lum[i] = l;
		if (data[i * 4 + 3] > 128) (sum += l), count++;
	}
	const mean = count ? sum / count : 0.5;
	for (let i = 0; i < n; i++) if (data[i * 4 + 3] <= 128) lum[i] = mean;
	const scale = Math.max(w, h) / 1000;
	// Where prints and seams are: strong local contrast between a pixel's neighbours (creases change brightness gently).
	const edge = new Float32Array(n);
	for (let y = 1; y < h - 1; y++)
		for (let x = 1; x < w - 1; x++) {
			const i = y * w + x;
			const g = Math.max(Math.abs(lum[i + 1] - lum[i - 1]), Math.abs(lum[i + w] - lum[i - w]));
			edge[i] = g > edgeLimit ? 1 : 0;
		}
	const protect = boxMean(edge, w, h, Math.round(14 * scale)).map((v) => Math.min(1, v * 6));
	const flat = guided(lum, w, h, Math.round(radius * scale), eps);
	const r = Math.max(2, Math.round(3 * scale));
	const base = boxMean(lum, w, h, r);
	const baseFlat = boxMean(flat, w, h, r);
	const out = Buffer.from(data);
	for (let i = 0; i < n; i++) {
		if (data[i * 4 + 3] === 0) continue;
		const target = baseFlat[i] + (lum[i] - base[i]);
		const k = strength * (1 - protect[i]);
		const mixed = lum[i] + (target - lum[i]) * k;
		const gain = lum[i] > 0.02 ? Math.max(0.7, Math.min(1.45, mixed / lum[i])) : 1;
		for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(data[i * 4 + c] * gain)));
	}
	return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}
let ironing = false;
let leveling = false;

/**
 * The angle (degrees, clockwise like sharp's rotate) that stands the piece upright: the one at which its outline fits the
 * smallest upright rectangle. Garments are roughly rectangular (waistband, shoulders, hems), so that is when they are
 * straight. Searched within ±25°; tiny corrections (< 0.6°) are skipped.
 */
async function uprightAngle(png) {
	const { data, info } = await sharp(png).extractChannel(3).resize({ width: 300, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
	const pts = [];
	for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] > 128) pts.push(x, y);
	// Clothes are mirror-symmetric: upright, the middle of every row (halfway between its left and right edge) lies on one
	// vertical line. For each angle, measure how much those row middles wander; the straightest angle wins.
	let best = 0;
	let bestScore = Infinity;
	for (let deg = -25; deg <= 25; deg += 0.25) {
		const a = (deg * Math.PI) / 180;
		const cos = Math.cos(a);
		const sin = Math.sin(a);
		const rows = new Map();
		for (let i = 0; i < pts.length; i += 2) {
			const x = pts[i] * cos - pts[i + 1] * sin;
			const y = Math.round(pts[i] * sin + pts[i + 1] * cos);
			const r = rows.get(y);
			if (!r) rows.set(y, [x, x]);
			else (r[0] = Math.min(r[0], x)), (r[1] = Math.max(r[1], x));
		}
		const mids = [...rows.values()].filter((r) => r[1] - r[0] > 8).map((r) => (r[0] + r[1]) / 2);
		if (mids.length < 10) continue;
		const mean = mids.reduce((s, m) => s + m, 0) / mids.length;
		const score = mids.reduce((s, m) => s + (m - mean) ** 2, 0) / mids.length;
		if (score < bestScore - 1e-6) (bestScore = score), (best = deg);
	}
	return Math.abs(best) < 0.6 ? 0 : best;
}

/** Categories whose straight edge is at the bottom (the hem of the body); for the others it is the waistband at the top. */
const TOPS = new Set(['hoodies', 'tees', 'longsleeves', 'jackets', 'wetsuits']);

/**
 * Second step: the straight edge of the piece must be level. Tops: the hem of the body (bottom edge of the middle part,
 * so the sleeves don't count). Boardshorts and other bottoms: the waistband (top edge of the middle part). A line is fitted
 * through that edge; if it is really straight (small error) its slope is corrected. Returns degrees for sharp's rotate.
 */
async function levelAngle(png, category) {
	const { data, info } = await sharp(png).extractChannel(3).resize({ width: 300, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
	const { width: w, height: h } = info;
	const top = !TOPS.has(category);
	// Only the middle of the piece: for tops the body between the arms, for shorts the waistband between the side seams.
	const from = Math.round(w * (top ? 0.25 : 0.4));
	const to = Math.round(w * (top ? 0.75 : 0.6));
	const xs = [];
	const ys = [];
	for (let x = from; x < to; x++) {
		let edge = -1;
		if (top) {
			for (let y = 0; y < h; y++) if (data[y * w + x] > 128) ((edge = y), (y = h));
		} else {
			for (let y = h - 1; y >= 0; y--) if (data[y * w + x] > 128) ((edge = y), (y = -1));
		}
		if (edge >= 0) xs.push(x), ys.push(edge);
	}
	if (xs.length < 20) return 0;
	// Line through the edge points; points far off the line (a cuff, a drawstring) are dropped and the line fitted again.
	const fit = (idx) => {
		const n = idx.length;
		const mx = idx.reduce((s, i) => s + xs[i], 0) / n;
		const my = idx.reduce((s, i) => s + ys[i], 0) / n;
		let sxy = 0;
		let sxx = 0;
		for (const i of idx) (sxy += (xs[i] - mx) * (ys[i] - my)), (sxx += (xs[i] - mx) ** 2);
		const slope = sxy / sxx;
		const res = (i) => ys[i] - (my + slope * (xs[i] - mx));
		const rms = Math.sqrt(idx.reduce((s, i) => s + res(i) ** 2, 0) / n);
		return { slope, rms, res };
	};
	let idx = xs.map((_, i) => i);
	let line = fit(idx);
	for (let round = 0; round < 3; round++) {
		const kept = idx.filter((i) => Math.abs(line.res(i)) <= Math.max(2, 2 * line.rms));
		if (kept.length < 20 || kept.length === idx.length) break;
		idx = kept;
		line = fit(idx);
	}
	const { slope, rms } = line;
	// Not a straight edge (a hood, a drawstring hanging over it): leave it to the symmetry step.
	if (rms > h * 0.03 || idx.length < xs.length * 0.6) return 0;
	const deg = (-Math.atan(slope) * 180) / Math.PI;
	return Math.abs(deg) < 0.5 || Math.abs(deg) > 12 ? 0 : deg;
}

/** Turns the cut-out piece upright (transparent corners), trimmed to its new outline: symmetry first, then the level edge. */
async function straighten(png, category = '') {
	const turn = async (src, angle) => sharp(await sharp(src).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()).trim({ threshold: 10 }).png().toBuffer();
	const first = await uprightAngle(png);
	const upright = first ? await turn(png, first) : png;
	// --level (opt-in, e.g. a sweater whose sleeves lie crooked): the hem of the body is made level. Tops only; a waistband
	// has the fly and drawstring in it. Off by default: on most pieces the symmetry alone is better.
	const level = leveling && TOPS.has(category) ? await levelAngle(upright, category) : 0;
	if (!first && !level) return { png, angle: 0 };
	// One rotation from the original (two rotations in a row would blur the photo twice).
	return { png: await turn(png, first + level), angle: first + level };
}

/** The piece's category from its index.md ("category: boardshorts"). */
const categoryOf = (file) => {
	const md = path.join(path.dirname(file), 'index.md');
	const piece = path.basename(path.dirname(file));
	const own = fs.existsSync(md) ? md : path.join(PRODUCTS, piece, 'index.md');
	return fs.existsSync(own) ? (fs.readFileSync(own, 'utf8').match(/^category:\s*(\S+)/m)?.[1] ?? '') : '';
};
export const setIroning = (on) => (ironing = on);

/** The piece cut out (pixels unchanged, or ironed with --iron), centred on the concrete floor with a soft shadow, 1200×1500. */
export async function processFlatLay(model, file) {
	const rotated = await sharp(file).rotate().removeAlpha().toBuffer();
	const { width, height } = await sharp(rotated).metadata();
	const mask = await personMask(model, rotated, width, height);
	const rgb = await sharp(rotated).raw().toBuffer();
	const cut = await sharp(rgb, { raw: { width, height, channels: 3 } }).joinChannel(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
	// Trim to the piece, then scale it to fill most of the frame.
	const trimmed = await sharp(cut).trim({ threshold: 10 }).png().toBuffer();
	const category = categoryOf(file);
	// Stand the piece exactly upright (90°), then scale it to fill most of the frame.
	const upright = (await straighten(trimmed, category)).png;
	const size = await sharp(upright).metadata();
	const scale = Math.min((FLAT.width * FLAT.fill) / size.width, (FLAT.height * FLAT.fill) / size.height);
	const w = Math.round(size.width * scale);
	const h = Math.round(size.height * scale);
	const resized = await sharp(upright).resize(w, h).png().toBuffer();
	const piece = ironing ? await iron(resized, w, h, ironFor(category)) : resized;
	const left = Math.round((FLAT.width - w) / 2);
	const top = Math.round((FLAT.height - h) / 2);
	// Shadow: the piece's own outline, dark, blurred and moved down a little.
	const alpha = await sharp(piece).extractChannel(3).raw().toBuffer();
	const shade = Buffer.alloc(w * h * 4);
	for (let i = 0; i < w * h; i++) (shade[i * 4] = 30), (shade[i * 4 + 1] = 27), (shade[i * 4 + 2] = 24), (shade[i * 4 + 3] = Math.round(alpha[i] * 0.45));
	const shadow = await sharp(shade, { raw: { width: w, height: h, channels: 4 } })
		.extend({ top: 40, bottom: 40, left: 40, right: 40, background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.blur(14)
		.png()
		.toBuffer();
	floor ??= await concrete(FLAT.width, FLAT.height);
	return sharp(floor)
		.composite([
			{ input: shadow, left: left - 40 + 4, top: top - 40 + 12 },
			{ input: piece, left, top },
		])
		.jpeg({ quality: 86, mozjpeg: true })
		.toBuffer();
}

/** Notes a label close-up in the piece's "labels" list (index.md), so the site can hide it (showLabelPhotos). */
function addLabel(dir, n) {
	const file = path.join(dir, 'index.md');
	let md = fs.readFileSync(file, 'utf8');
	const line = md.match(/^labels:\s*\[([^\]]*)\]/m);
	const list = line ? [...line[1].matchAll(/\d+/g)].map(Number) : [];
	if (list.includes(n)) return;
	list.push(n);
	list.sort((x, y) => x - y);
	const text = `labels: [${list.join(', ')}]`;
	if (line) md = md.replace(/^labels:.*$/m, text);
	else if (/^models:.*$/m.test(md)) md = md.replace(/^(models:.*)$/m, `$1\n${text}`);
	else md = md.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (_, body) => `---\n${body}\n${text}\n---`);
	fs.writeFileSync(file, md);
}

// ---------------------------------------------------------------- haul (hero image from the pieces themselves)

/**
 * --haul <file.jpg>: one big flat-lay of many pieces at once (the front photo of each piece, from the originals), cut out,
 * straightened, ironed and laid out loosely overlapping on the concrete floor, with soft shadows. 2400×1350 (16:9).
 */
export async function makeHaul(model, sources, outFile, layoutSeed = 7) {
	const W = 2400;
	const H = 1350;
	let seed = layoutSeed;
	const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
	const pieces = [];
	for (const src of sources) {
		const rotated = await sharp(src).rotate().removeAlpha().toBuffer();
		const { width, height } = await sharp(rotated).metadata();
		const mask = await personMask(model, rotated, width, height);
		const rgb = await sharp(rotated).raw().toBuffer();
		const cut = await sharp(rgb, { raw: { width, height, channels: 3 } }).joinChannel(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
		const category = categoryOf(src);
		const upright = (await straighten(await sharp(cut).trim({ threshold: 10 }).png().toBuffer(), category)).png;
		const meta = await sharp(upright).metadata();
		const target = 560; // similar size for every piece
		const s = target / Math.max(meta.width, meta.height);
		const w = Math.round(meta.width * s);
		const h = Math.round(meta.height * s);
		pieces.push(await iron(await sharp(upright).resize(w, h).png().toBuffer(), w, h, ironFor(category)));
	}
	// Two loose rows, each piece turned a little and moved a little: like clothes laid out on the floor.
	const n = pieces.length;
	const perRow = Math.ceil(n / 2);
	const layers = [];
	for (let i = 0; i < n; i++) {
		const row = i < perRow ? 0 : 1;
		const col = row === 0 ? i : i - perRow;
		const count = row === 0 ? perRow : n - perRow;
		const angle = (rand() - 0.5) * 16;
		const turned = await sharp(pieces[i]).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
		const m = await sharp(turned).metadata();
		const cx = ((col + 0.5) / count) * W + (rand() - 0.5) * 80 + (row ? W / (2 * count) - W / (2 * perRow) : 0);
		const cy = (row === 0 ? 0.33 : 0.7) * H + (rand() - 0.5) * 70;
		const left = Math.round(cx - m.width / 2);
		const top = Math.round(cy - m.height / 2);
		const alpha = await sharp(turned).extractChannel(3).raw().toBuffer();
		const shade = Buffer.alloc(m.width * m.height * 4);
		for (let k = 0; k < m.width * m.height; k++) (shade[k * 4] = 30), (shade[k * 4 + 1] = 27), (shade[k * 4 + 2] = 24), (shade[k * 4 + 3] = Math.round(alpha[k] * 0.42));
		const shadow = await sharp(shade, { raw: { width: m.width, height: m.height, channels: 4 } })
			.extend({ top: 40, bottom: 40, left: 40, right: 40, background: { r: 0, g: 0, b: 0, alpha: 0 } })
			.blur(16)
			.png()
			.toBuffer();
		layers.push({ input: shadow, left: left - 40 + 6, top: top - 40 + 14 }, { input: turned, left, top });
	}
	// Pieces may reach over the edge a little: lay them out on a bigger floor, then cut the frame.
	const pad = 300;
	const big = await sharp(await concrete(W + 2 * pad, H + 2 * pad))
		.composite(layers.map((l) => ({ ...l, left: l.left + pad, top: l.top + pad })))
		.png()
		.toBuffer();
	await sharp(big).extract({ left: pad, top: pad, width: W, height: H }).jpeg({ quality: 86, mozjpeg: true }).toFile(outFile);
}

/** Photo numbers with a model, from "models: { women: [..], men: [..] }" in index.md. */
function modelPhotos(dir) {
	const line = fs.readFileSync(path.join(dir, 'index.md'), 'utf8').match(/^models:\s*(.+)$/m)?.[1] ?? '';
	return [...line.matchAll(/\d+/g)].map(Number).sort((a, b) => a - b);
}

async function main() {
	const args = process.argv.slice(2);
	const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
	const preview = opt('--preview');
	// --haul <file>: the hero flat-lay of all pieces (front photo = first photo that is neither model nor label), from the originals.
	const haul = opt('--haul');
	if (haul) {
		const model = await session();
		const sources = [];
		for (const piece of fs.readdirSync(PRODUCTS).filter((p) => fs.existsSync(path.join(PRODUCTS, p, 'index.md')))) {
			const dir = path.join(PRODUCTS, piece);
			const md = fs.readFileSync(path.join(dir, 'index.md'), 'utf8');
			if (/^sold:\s*true/m.test(md)) continue;
			const labels = [...(md.match(/^labels:\s*\[([^\]]*)\]/m)?.[1] ?? '').matchAll(/\d+/g)].map(Number);
			const skip = new Set([...modelPhotos(dir), ...labels]);
			const files = fs.readdirSync(dir).filter((f) => /^\d+\.(jpe?g|png|webp)$/i.test(f)).sort((x, y) => parseInt(x) - parseInt(y));
			// --side back: the second photo of the piece (usually the back); front by default.
			const views = files.filter((f) => !skip.has(parseInt(f)));
			const front = views[opt('--side') === 'back' ? 1 : 0] ?? views[0];
			if (!front) continue;
			const original = path.join(BACKUP, piece, front);
			sources.push(fs.existsSync(original) ? original : path.join(dir, front));
		}
		await makeHaul(model, sources, haul, opt('--side') === 'back' ? 31 : 7);
		return console.log(`Haul with ${sources.length} pieces: ${haul}`);
	}
	const only = opt('--photos')?.split(',').map(Number);
	// --pending: the seller pieces approved in the dashboard (hidden, "processPhotos: true"). Run by GitHub after every push
	// (.github/workflows/seller-photos.yml): flat-lay + ironing like the shop's own pieces, then the piece goes online.
	const pending = args.includes('--pending');
	const isPending = (name) => /^processPhotos:\s*true\b/m.test(fs.readFileSync(path.join(PRODUCTS, name, 'index.md'), 'utf8'));
	const pieces = fs
		.readdirSync(PRODUCTS)
		.filter((name) => fs.existsSync(path.join(PRODUCTS, name, 'index.md')))
		.filter((name) => (pending ? isPending(name) : args.includes('--all') || args.some((a) => /^\d{4}/.test(a) && name.startsWith(a))));
	if (!pieces.length) return console.log(pending ? 'No seller pieces waiting for photos.' : 'Which piece? e.g. npm run photos:background -- 0013   (or --all)');

	const flat = pending || args.includes('--flatlay');
	const seller = pending || args.includes('--seller');
	ironing = pending || args.includes('--iron');
	leveling = args.includes('--level');
	const model = await session();
	if (pending) {
		for (const piece of pieces) {
			try {
				await processPiece(piece);
			} catch (error) {
				// Never leave a piece hidden because of a photo problem: it goes online with the seller's own photos.
				console.error(`${piece}: photos not changed (${error.message}); the piece goes online with the original photos`);
			}
			const file = path.join(PRODUCTS, piece, 'index.md');
			const md = fs.readFileSync(file, 'utf8');
			fs.writeFileSync(file, md.replace(/^processPhotos:.*\r?\n/m, '').replace(/^draft:\s*true\r?\n/m, ''));
			console.log(`${piece}: online`);
		}
		return;
	}
	for (const piece of pieces) await processPiece(piece);

	async function processPiece(piece) {
		const dir = path.join(PRODUCTS, piece);
		const doneFile = path.join(dir, flat ? '.flatlay.json' : '.uniform-background.json');
		const done = fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, 'utf8')) : [];
		const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
		const models = modelPhotos(dir);
		const ticked = [...(fs.readFileSync(path.join(dir, 'index.md'), 'utf8').match(/^labels:\s*\[([^\]]*)\]/m)?.[1] ?? '').matchAll(/\d+/g)].map(Number);
		const numbers = files.map((f) => Number(f.replace(/\.\w+$/, ''))).filter(Number.isInteger).sort((a, b) => a - b);
		// --flatlay: the photos of the piece itself (not the model photos), only those on a light background (no label close-ups).
		for (const n of only ?? (flat ? numbers.filter((x) => !models.includes(x)) : models)) {
			const file = files.find((f) => f.replace(/\.\w+$/, '') === String(n));
			if (!file) continue;
			// Sellers' photos lie on any floor, so a white-floor test can't find their label close-ups: the owner ticks them
			// when approving (the "labels" list in index.md), and only those are left as they are.
			if (seller && ticked.includes(n)) {
				console.log(`${piece}/${file}: label close-up (ticked), left as it is`);
				continue;
			}
			if (flat && !seller && !only && !done.includes(file) && !(await isFlatLay(path.join(dir, file)))) {
				addLabel(dir, n);
				console.log(`${piece}/${file}: close-up of the label, left as it is (added to "labels")`);
				continue;
			}
			if (!preview && done.includes(file)) {
				console.log(`${piece}/${file}: already done`);
				continue;
			}
			const src = path.join(dir, file);
			const out = flat ? await processFlatLay(model, src) : await processPhoto(model, src);
			if (preview) {
				fs.mkdirSync(preview, { recursive: true });
				fs.copyFileSync(src, path.join(preview, `${piece}-${file.replace(/\.\w+$/, '')}-before${path.extname(file)}`));
				fs.writeFileSync(path.join(preview, `${piece}-${file.replace(/\.\w+$/, '')}-after${path.extname(file)}`), out);
			} else {
				fs.mkdirSync(path.join(BACKUP, piece), { recursive: true });
				const backup = path.join(BACKUP, piece, file);
				if (!fs.existsSync(backup)) fs.copyFileSync(src, backup);
				fs.writeFileSync(src, out);
				done.push(file);
				fs.writeFileSync(doneFile, JSON.stringify(done, null, 1) + '\n');
			}
			console.log(`${piece}/${file}: ok`);
		}
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => (console.error(e), process.exit(1)));
