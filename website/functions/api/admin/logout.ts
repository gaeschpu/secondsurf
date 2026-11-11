// Logs the dashboard out on every device (cookies issued before now stop working), not only on this one.
import { clearedCookie, json, logoutEverywhere, type Handler } from '../../_lib/auth.ts';

export const onRequestPost: Handler = async ({ env }) => {
	await logoutEverywhere(env);
	return json({ ok: true }, 200, { 'Set-Cookie': clearedCookie });
};
