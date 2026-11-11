// Server-side check of uploaded photos (dashboard and sellers). Only JPEG is accepted (no SVG, PNG or anything else);
// file names are always chosen by the server (1.jpg, 2.jpg …).
//
// cleanJpeg() checks the structure (starts with a JPEG header, ends with the end-of-image marker, nothing appended after it)
// and removes metadata segments: EXIF (camera, GPS location), XMP, IPTC/Photoshop and comments. The browser already redraws
// every photo (which drops them too), but the server doesn't rely on that.
//
// To stay within the Workers CPU limit, only the header (up to the start of the image data) is decoded and rebuilt; the
// image data itself is passed through as base64. Workers have no image library to re-encode the pixels.

const HEADER_LIMIT = 256 * 1024; // base64 characters decoded to find the image data (metadata larger than this: refused)
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Segments kept in the header: quantization/huffman tables, frame info, restart interval, JFIF (APP0), colour profile (APP2), Adobe (APP14). */
const DROP = new Set([0xe1, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xef, 0xfe]);

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function encode(bytes: Uint8Array) {
	let text = '';
	for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
}

/** The cleaned photo as base64, or null if it isn't a well-formed JPEG. */
export function cleanJpeg(b64: unknown, maxLength: number): string | null {
	if (typeof b64 !== 'string' || b64.length < 100 || b64.length > maxLength || b64.length % 4 !== 0 || !BASE64.test(b64)) return null;

	// The end: FF D9 (end of image) in the last bytes, so nothing (a script, an archive) hides behind the picture.
	const tail = decode(b64.slice(-8));
	if (!(tail[tail.length - 2] === 0xff && tail[tail.length - 1] === 0xd9)) return null;

	const n = b64.length <= HEADER_LIMIT ? b64.length : HEADER_LIMIT;
	const head = decode(b64.slice(0, n));
	if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return null;

	const kept: Uint8Array[] = [head.subarray(0, 2)];
	let keptLength = 2;
	let i = 2;
	let sos = -1;
	while (i < head.length) {
		if (head[i] !== 0xff) return null;
		const start = i;
		while (head[i] === 0xff) i++; // fill bytes
		const marker = head[i++];
		if (marker === 0xda) {
			sos = start;
			break;
		}
		if (marker === 0xd8 || marker === 0xd9 || marker === undefined) return null;
		if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
		if (i + 2 > head.length) return null;
		const end = i + ((head[i] << 8) | head[i + 1]);
		if (end > head.length || end < i + 2) return null;
		if (!DROP.has(marker)) {
			kept.push(Uint8Array.of(0xff, marker), head.subarray(i, end));
			keptLength += 2 + (end - i);
		}
		i = end;
	}
	if (sos < 0) return null;

	// The rebuilt header plus the image data up to a 3-byte boundary (where base64 can be joined), plus a tiny empty
	// comment segment so the lengths line up. The rest of the original base64 is appended unchanged.
	const cut = Math.ceil(sos / 3) * 3;
	if (cut > head.length || (cut / 3) * 4 > n) return null;
	const pad = (3 - ((keptLength + 4 + cut - sos) % 3)) % 3;
	const filler = new Uint8Array(4 + pad);
	filler.set([0xff, 0xfe, 0x00, 2 + pad]);
	const out = new Uint8Array(keptLength + filler.length + (cut - sos));
	let at = 0;
	for (const part of kept) {
		out.set(part, at);
		at += part.length;
	}
	out.set(filler, at);
	out.set(head.subarray(sos, cut), at + filler.length);
	return encode(out) + b64.slice((cut / 3) * 4);
}
