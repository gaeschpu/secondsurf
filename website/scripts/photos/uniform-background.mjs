// Same studio background on every model photo: cuts out the person (ISNet, the model rembg uses; runs locally, free),
// puts them on one uniform colour with a soft floor shadow. The person and the clothes are not changed: their pixels are
// copied 1:1 from the original; only the background around them is replaced. Size and ratio stay the same.
//
//   npm run photos:background -- 0013                 every model photo of piece 0013 (photo numbers from "models:" in index.md)
//   npm run photos:background -- 0013 --photos 1,2    only these photos
//   npm run photos:background -- --all                every piece
//   add --preview <folder>                            write before/after into that folder instead of changing anything
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
export async function iron(png, w, h, strength = 0.9) {
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
			edge[i] = g > 0.12 ? 1 : 0;
		}
	const protect = boxMean(edge, w, h, Math.round(14 * scale)).map((v) => Math.min(1, v * 6));
	const flat = guided(lum, w, h, Math.round(28 * scale), 0.03);
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
export const setIroning = (on) => (ironing = on);

/** The piece cut out (pixels unchanged, or ironed with --iron), centred on the concrete floor with a soft shadow, 1200×1500. */
export async function processFlatLay(model, file) {
	const rotated = await sharp(file).rotate().removeAlpha().toBuffer();
	const { width, height } = await sharp(rotated).metadata();
	const mask = await personMask(model, rotated, width, height);
	const rgb = await sharp(rotated).raw().toBuffer();
	const cut = await sharp(rgb, { raw: { width, height, channels: 3 } }).joinChannel(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
	// Trim to the piece, then scale it to fill most of the frame.
	const trimmed = await sharp(cut).trim({ threshold: 10 }).png().toBuffer({ resolveWithObject: true });
	const scale = Math.min((FLAT.width * FLAT.fill) / trimmed.info.width, (FLAT.height * FLAT.fill) / trimmed.info.height);
	const w = Math.round(trimmed.info.width * scale);
	const h = Math.round(trimmed.info.height * scale);
	const resized = await sharp(trimmed.data).resize(w, h).png().toBuffer();
	const piece = ironing ? await iron(resized, w, h) : resized;
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

/** Photo numbers with a model, from "models: { women: [..], men: [..] }" in index.md. */
function modelPhotos(dir) {
	const line = fs.readFileSync(path.join(dir, 'index.md'), 'utf8').match(/^models:\s*(.+)$/m)?.[1] ?? '';
	return [...line.matchAll(/\d+/g)].map(Number).sort((a, b) => a - b);
}

async function main() {
	const args = process.argv.slice(2);
	const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
	const preview = opt('--preview');
	const only = opt('--photos')?.split(',').map(Number);
	const pieces = fs
		.readdirSync(PRODUCTS)
		.filter((name) => fs.existsSync(path.join(PRODUCTS, name, 'index.md')))
		.filter((name) => args.includes('--all') || args.some((a) => /^\d{4}/.test(a) && name.startsWith(a)));
	if (!pieces.length) return console.log('Which piece? e.g. npm run photos:background -- 0013   (or --all)');

	const flat = args.includes('--flatlay');
	ironing = args.includes('--iron');
	const model = await session();
	for (const piece of pieces) {
		const dir = path.join(PRODUCTS, piece);
		const doneFile = path.join(dir, flat ? '.flatlay.json' : '.uniform-background.json');
		const done = fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, 'utf8')) : [];
		const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
		const models = modelPhotos(dir);
		const numbers = files.map((f) => Number(f.replace(/\.\w+$/, ''))).filter(Number.isInteger).sort((a, b) => a - b);
		// --flatlay: the photos of the piece itself (not the model photos), only those on a light background (no label close-ups).
		for (const n of only ?? (flat ? numbers.filter((x) => !models.includes(x)) : models)) {
			const file = files.find((f) => f.replace(/\.\w+$/, '') === String(n));
			if (!file) continue;
			if (flat && !only && !done.includes(file) && !(await isFlatLay(path.join(dir, file)))) {
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
