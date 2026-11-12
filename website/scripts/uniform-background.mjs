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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

	const model = await session();
	for (const piece of pieces) {
		const dir = path.join(PRODUCTS, piece);
		const doneFile = path.join(dir, '.uniform-background.json');
		const done = fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, 'utf8')) : [];
		const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
		for (const n of only ?? modelPhotos(dir)) {
			const file = files.find((f) => f.replace(/\.\w+$/, '') === String(n));
			if (!file) continue;
			if (!preview && done.includes(file)) {
				console.log(`${piece}/${file}: already done`);
				continue;
			}
			const src = path.join(dir, file);
			const out = await processPhoto(model, src);
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
