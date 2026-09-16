import { payload, database, member, mutation, administrator, value, event, failure, HttpError } from '@/lib/vault';
export async function POST(request: Request) { try {
    mutation(request);
    const m = await member();
    administrator(m);
    const b = await payload(request);
    const email = value(b.email, 'email address', 254).toLowerCase(), name = value(b.name, 'name', 100);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['editor', 'viewer'].includes(b.role))
        throw new HttpError(400, 'Enter a valid email and role.');
    const r = await database().prepare('INSERT OR IGNORE INTO members (id,email,name,role,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM members)<9').bind(crypto.randomUUID(), email, name, b.role, new Date().toISOString()).run();
    if (!r.meta.changes)
        throw new HttpError(409, 'That email is already listed, or all nine team places are filled.');
    await event(m.name, `added ${name} to the access list`).run();
    return Response.json({ ok: true });
}
catch (e) {
    return failure(e);
} }
