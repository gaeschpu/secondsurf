// Source of public/scanner.js: scans a parcel barcode with the phone camera (ZXing, works on iPhone and Android).
// Rebuild after changing: npm run build:scanner
// Used by the seller's profile (src/components/SellerSection.astro) and the dashboard (public/admin/admin.js):
//   const code = await window.secondsurfScan();   // the scanned text, or null when cancelled
// Styles are set through element.style (allowed by the dashboard's Content-Security-Policy, unlike inline <style>).

import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

function overlay() {
	const box = document.createElement('div');
	Object.assign(box.style, {
		position: 'fixed',
		inset: '0',
		zIndex: '1000',
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '1rem',
		padding: '1rem',
		background: 'rgba(0,0,0,0.85)',
		color: '#fff',
		font: '600 1rem system-ui, sans-serif',
		textAlign: 'center',
	});
	const video = document.createElement('video');
	video.setAttribute('playsinline', '');
	video.muted = true;
	Object.assign(video.style, { width: 'min(100%, 32rem)', maxHeight: '60vh', borderRadius: '12px', background: '#000', objectFit: 'cover' });
	const hint = document.createElement('p');
	hint.textContent = document.documentElement.lang.startsWith('fr')
		? 'Vise le code-barres du colis'
		: document.documentElement.lang.startsWith('it')
			? 'Inquadra il codice a barre del pacco'
			: document.documentElement.lang.startsWith('en')
				? 'Point the camera at the parcel barcode'
				: 'Halte die Kamera auf den Strichcode des Pakets';
	Object.assign(hint.style, { margin: '0' });
	const cancel = document.createElement('button');
	cancel.type = 'button';
	cancel.textContent = '✕';
	Object.assign(cancel.style, { width: '3rem', height: '3rem', border: '0', borderRadius: '50%', background: '#fff', color: '#000', fontSize: '1.2rem', cursor: 'pointer' });
	box.append(video, hint, cancel);
	document.body.append(box);
	return { box, video, cancel };
}

window.secondsurfScan = function scan() {
	const hints = new Map([
		[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13]],
		[DecodeHintType.TRY_HARDER, true],
	]);
	const reader = new BrowserMultiFormatReader(hints);
	const { box, video, cancel } = overlay();
	return new Promise((resolve) => {
		let controls = null;
		const finish = (value) => {
			controls?.stop();
			box.remove();
			resolve(value);
		};
		cancel.addEventListener('click', () => finish(null));
		reader
			.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video, (result) => {
				if (result) finish(result.getText());
			})
			.then((c) => {
				controls = c;
				if (!box.isConnected) c.stop();
			})
			.catch(() => finish(null));
	});
};
