import { payload, database, identity, mutation, event, failure, HttpError, subsystemNames } from '@/lib/vault';
export const dynamic = 'force-dynamic';
export async function GET() { try {
    const u = await identity(), db = database();
    const count = await db.prepare('SELECT COUNT(*) AS n FROM members').first<{
        n: number;
    }>();
    if (!count?.n)
        return Response.json({ setup: true }, { headers: { 'Cache-Control': 'no-store' } });
    const m = await db.prepare('SELECT * FROM members WHERE user_id=?').bind(u.userId).first();
    if (!m) {
        const invitation = await db.prepare('SELECT id FROM members WHERE email=? AND user_id IS NULL').bind(u.email.toLowerCase()).first();
        return Response.json({ join: !!invitation, denied: !invitation }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const [p, v, a, t] = await db.batch([db.prepare('SELECT p.id,p.name,p.subsystem,p.status,p.version,p.current_version_id,p.updated_at,CASE WHEN p.locked_at>? THEN p.locked_by ELSE NULL END AS locked_by,CASE WHEN p.locked_at>? THEN m.name ELSE NULL END AS locked_name FROM packages p LEFT JOIN members m ON p.locked_by=m.user_id ORDER BY p.updated_at DESC').bind(new Date(Date.now()-120000).toISOString(),new Date(Date.now()-120000).toISOString()), db.prepare('SELECT id,package_id,revision,filename,size,note,author_name,created_at FROM versions ORDER BY created_at DESC'), db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT 60'), db.prepare('SELECT id,user_id,name,email,role FROM members ORDER BY created_at')]);
    return Response.json({ subsystems: await subsystemNames(), member: m, packages: p.results, versions: v.results, activity: a.results, members: t.results }, { headers: { 'Cache-Control': 'no-store' } });
}
catch (e) {
    return failure(e);
} }
export async function POST(request: Request) { try {
    mutation(request);
    const u = await identity(), db = database();
    const body = await payload(request);
    if (body.action === 'setup') {
        const r = await db.prepare("INSERT INTO members (id,user_id,email,name,role,created_at) SELECT ?,?,?,?,'admin',? WHERE NOT EXISTS (SELECT 1 FROM members)").bind(crypto.randomUUID(), u.userId, u.email.toLowerCase(), u.displayName, new Date().toISOString()).run();
        if (!r.meta.changes)
            throw new HttpError(409, 'The workspace has already been created. Refresh to continue.');
        await event(u.displayName, 'created the team workspace').run();
        return Response.json({ ok: true });
    }
    if (body.action === 'join') {
        const r = await db.prepare('UPDATE members SET user_id=?,name=? WHERE email=? AND user_id IS NULL').bind(u.userId, u.displayName, u.email.toLowerCase()).run();
        if (!r.meta.changes)
            throw new HttpError(403, 'No invitation is available for this account.');
        await event(u.displayName, 'joined the team').run();
        return Response.json({ ok: true });
    }
    throw new HttpError(400, 'Unknown workspace action.');
}
catch (e) {
    return failure(e);
} }
