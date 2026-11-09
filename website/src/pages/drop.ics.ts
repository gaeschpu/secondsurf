// /drop.ics: the next drop as a calendar event (Apple Calendar, Outlook), with an alarm at the start.
// Built from nextDropAt in src/settings/site.json, so it changes with every new drop.

import type { APIRoute } from 'astro';
import { DROP, SITE } from '../config';

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export const GET: APIRoute = () => {
	const at = DROP.at;
	if (!at) return new Response('No drop planned.', { status: 404 });
	const link = new URL('/new/', SITE.url).href;
	const ics = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//secondsurf//New Drop//DE',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:drop-${DROP.number}@secondsurf.ch`,
		`DTSTAMP:${stamp(new Date())}`,
		`DTSTART:${stamp(at)}`,
		`DTEND:${stamp(new Date(at.getTime() + 3600_000))}`,
		'SUMMARY:secondsurf ☆ New Drop',
		`DESCRIPTION:Der neue Drop ist live: ${link}`,
		`URL:${link}`,
		'BEGIN:VALARM',
		'ACTION:DISPLAY',
		'DESCRIPTION:secondsurf New Drop',
		'TRIGGER:PT0M',
		'END:VALARM',
		'END:VEVENT',
		'END:VCALENDAR',
	].join('\r\n');
	return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
};
