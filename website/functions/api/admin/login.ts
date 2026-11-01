import { checkPassword, json, sessionCookie, type Handler } from '../../_lib/auth.ts';

export const onRequestPost: Handler = async ({ request, env }) => {
	const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
	const password = typeof body?.password === 'string' ? body.password : '';
	if (!(await checkPassword(env, password))) return json({ error: 'Wrong password.' }, 401);
	return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(env) });
};
