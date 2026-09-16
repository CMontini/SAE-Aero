import { payload, database, bucket, member, writable, administrator, mutation, value, event, failure, HttpError, SUBSYSTEMS, MAX_BYTES } from '@/lib/vault';
export async function POST(request: Request) {
    let stored: string | null = null;
    try {
        mutation(request);
        const m = await member();
        writable(m);
        const db = database(), url = new URL(request.url);
        if (url.searchParams.get('action') === 'upload') {
            const filename = value(url.searchParams.get('filename'), 'filename', 180);
            if (!/\.(zip|sldprt|sldasm|slddrw)$/i.test(filename) || /[\\/\r\n]/.test(filename))
                throw new HttpError(400, 'Choose a ZIP, SLDPRT, SLDASM, or SLDDRW file.');
            const length = Number(request.headers.get('content-length'));
            if (!Number.isInteger(length) || length <= 0 || length > MAX_BYTES || !request.body)
                throw new HttpError(413, 'Choose a file between 1 byte and 50 MB.');
            const name = value(url.searchParams.get('name'), 'package name', 100), subsystem = value(url.searchParams.get('subsystem'), 'subsystem');
            if (!SUBSYSTEMS.includes(subsystem))
                throw new HttpError(400, 'Choose a subsystem.');
            const note = value(url.searchParams.get('note'), 'change notes', 2000), existing = url.searchParams.get('id'), id = existing || crypto.randomUUID(), versionId = crypto.randomUUID(), now = new Date().toISOString();
            let p: any = null;
            if (existing) {
                p = await db.prepare('SELECT * FROM packages WHERE id=?').bind(existing).first();
                if (!p)
                    throw new HttpError(404, 'Package not found.');
                if (p.locked_by !== m.user_id)
                    throw new HttpError(409, 'Check out this package before uploading a revision.');
                if (p.version !== Number(url.searchParams.get('base')))
                    throw new HttpError(409, 'A newer revision is available. Refresh and download it before continuing.');
            }
            const rev = p ? p.version + 1 : 1, key = `packages/${id}/${versionId}`;
            await bucket().put(key, request.body, { httpMetadata: { contentType: 'application/octet-stream' } });
            stored = key;
            const object = await bucket().head(key);
            if (!object || object.size !== length)
                throw new HttpError(400, 'The upload was incomplete. Please try again.');
            if (p) {
                const result = await db.batch([
                    db.prepare('INSERT INTO versions (id,package_id,revision,filename,size,storage_key,note,author_id,author_name,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM packages WHERE id=? AND locked_by=? AND lock_token=? AND version=?)').bind(versionId, id, rev, filename, length, key, note, m.user_id, m.name, now, id, m.user_id, p.lock_token, p.version),
                    db.prepare("UPDATE packages SET version=?,current_version_id=?,locked_by=NULL,lock_token=NULL,locked_at=NULL,updated_at=?,status='In progress' WHERE id=? AND EXISTS (SELECT 1 FROM versions WHERE id=?)").bind(rev, versionId, now, id, versionId)
                ]);
                if (!result[0].meta.changes)
                    throw new HttpError(409, 'The checkout changed during upload. Refresh and try again.');
            }
            else {
                await db.batch([db.prepare("INSERT INTO packages (id,name,subsystem,status,version,current_version_id,updated_at) VALUES (?,?,?,'In progress',1,?,?)").bind(id, name, subsystem, versionId, now), db.prepare('INSERT INTO versions (id,package_id,revision,filename,size,storage_key,note,author_id,author_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(versionId, id, rev, filename, length, key, note, m.user_id, m.name, now)]);
            }
            stored = null;
            await event(m.name, `${p ? 'checked in' : 'uploaded'} ${p?.name || name} · revision ${rev}`, id).run();
            return Response.json({ ok: true, id });
        }
        const b = await payload(request), id = value(b.id, 'package ID');
        const p = await db.prepare('SELECT * FROM packages WHERE id=?').bind(id).first<any>();
        if (!p)
            throw new HttpError(404, 'Package not found.');
        if (b.action === 'checkout') {
            const r = await db.prepare('UPDATE packages SET locked_by=?,lock_token=?,locked_at=? WHERE id=? AND locked_by IS NULL').bind(m.user_id, crypto.randomUUID(), new Date().toISOString(), id).run();
            if (!r.meta.changes)
                throw new HttpError(409, 'Someone has already checked out this package. Refresh to see who.');
            await event(m.name, `checked out ${p.name}`, id).run();
        }
        else if (b.action === 'release') {
            if (p.locked_by !== m.user_id)
                administrator(m);
            const r = await db.prepare('UPDATE packages SET locked_by=NULL,lock_token=NULL,locked_at=NULL WHERE id=? AND lock_token=?').bind(id, p.lock_token).run();
            if (!r.meta.changes)
                throw new HttpError(409, 'The checkout has changed. Refresh to continue.');
            await event(m.name, `released the checkout on ${p.name}`, id).run();
        }
        else if (b.action === 'status') {
            if (!['In progress', 'Ready for review', 'Approved'].includes(b.status))
                throw new HttpError(400, 'Choose a valid design status.');
            if (b.status === 'Approved' || p.status === 'Approved')
                administrator(m);
            const r = await db.prepare('UPDATE packages SET status=?,updated_at=? WHERE id=? AND version=? AND locked_by IS NULL').bind(b.status, new Date().toISOString(), id, b.base).run();
            if (!r.meta.changes)
                throw new HttpError(409, 'Release the checkout and refresh before changing the status.');
            await event(m.name, `marked ${p.name} ${b.status.toLowerCase()}`, id).run();
        }
        else
            throw new HttpError(400, 'Unknown package action.');
        return Response.json({ ok: true });
    }
    catch (e) {
        if (stored)
            await bucket().delete(stored).catch(() => { });
        return failure(e);
    }
}
