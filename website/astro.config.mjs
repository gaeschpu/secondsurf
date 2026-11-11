// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://secondsurf.ch',
	prefetch: true,
	// Content Security Policy as a <meta> tag on every page, with hashes of every inline script and style Astro renders,
	// so script-src needs no 'unsafe-inline'. frame-ancestors can't go in a <meta>: public/_headers sends it (and the rest).
	// Turnstile (bot check) loads from challenges.cloudflare.com; checkout forms post to /api and redirect to Stripe.
	security: {
		csp: {
			algorithm: 'SHA-256',
			directives: [
				"default-src 'self'",
				"img-src 'self' data: blob:",
				"font-src 'self'",
				"connect-src 'self'",
				"frame-src https://challenges.cloudflare.com",
				"object-src 'none'",
				"base-uri 'self'",
				"form-action 'self' https://checkout.stripe.com",
				"manifest-src 'self'",
			],
			scriptDirective: { resources: ["'self'", 'https://challenges.cloudflare.com'] },
			// style="" attributes set by scripts and by the Turnstile widget.
			styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }] },
		},
	},
	// Small site: inline CSS so the first paint doesn't wait for a stylesheet request.
	build: { inlineStylesheets: 'always' },
	integrations: [
		sitemap({
			// The start pages redirect to the New Drop (see public/_redirects); profile pages are private.
			filter: (page) => !/^https:\/\/secondsurf\.ch\/((fr|it|en)\/)?(account\/|thanks\/|offer\/)?$/.test(page),
			i18n: {
				defaultLocale: 'de',
				locales: { de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en' },
			},
		}),
	],
	// Fonts are downloaded at build time and self-hosted (no requests to Google).
	fonts: [
		{
			provider: fontProviders.fontsource(),
			name: 'Bricolage Grotesque',
			cssVariable: '--font-serif',
			// Only the heading weight, to keep the download small.
			weights: ['700'],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['system-ui', 'sans-serif'],
		},
		{
			provider: fontProviders.fontsource(),
			name: 'Inter',
			cssVariable: '--font-sans',
			// One file per weight: Safari draws bold too thin from the single variable-font file.
			weights: ['400', '500', '600', '700', '900'],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['system-ui', 'sans-serif'],
		},
	],
});
