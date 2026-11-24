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
			// Headings: a bold condensed sans in capitals, 90s surf-shop style (italic for the big hero title).
			name: 'Barlow Condensed',
			cssVariable: '--font-serif',
			weights: ['600', '700', '800'],
			styles: ['normal', 'italic'],
			subsets: ['latin'],
			fallbacks: ['Arial Narrow', 'system-ui', 'sans-serif'],
		},
		{
			provider: fontProviders.fontsource(),
			// Body text: a narrow, plain sans that goes with the condensed headings.
			name: 'Archivo Narrow',
			cssVariable: '--font-sans',
			weights: ['400', '500', '600', '700'],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['Arial Narrow', 'system-ui', 'sans-serif'],
		},
	],
});
