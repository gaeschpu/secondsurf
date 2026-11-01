// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://secondsurf.ch',
	prefetch: true,
	// Small site: inline CSS so the first paint doesn't wait for a stylesheet request.
	build: { inlineStylesheets: 'always' },
	integrations: [
		sitemap({
			// The start pages redirect to the New Drop (see public/_redirects).
			filter: (page) => !/^https:\/\/secondsurf\.ch\/((fr|it|en)\/)?$/.test(page),
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
			weights: ['400 700'],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['system-ui', 'sans-serif'],
		},
	],
});
