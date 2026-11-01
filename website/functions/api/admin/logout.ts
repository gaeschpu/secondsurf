import { clearedCookie, json, type Handler } from '../../_lib/auth.ts';

export const onRequestPost: Handler = () => json({ ok: true }, 200, { 'Set-Cookie': clearedCookie });
