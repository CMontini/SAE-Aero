import { parseManifest, validateManifest } from '@/lib/assemblies';
import { payload, database, bucket, member, writable, administrator, mutation, value, event, failure, HttpError, displayName, subsystemNames, MAX_BYTES, MAIN_ASSEMBLIES } from '@/lib/vault';
const TTL = 120000;
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function POST(request: Request) {
    let stored: string | null = null;
    try {
        mutation(request);
        const m = await member(); writable(m);
        const db = database(), url = new URL(request.url);
        const now = new Date().toISOString(), cutoff = new Date(Date.now() - TTL).toISOString();
        if (url.searchParams.get('action') === 'upload') {
            const filename = value(url.searchParams.get('filename'), 'filename', 180);
            if (!/\.(zip|sldprt|sldasm|slddrw)$/i.test(filename) || /[\\/\r\n]/.test(filename)) throw new HttpError(400, 'Choose a ZIP, SLDPRT, SLDASM, or SLDDRW file.');
            const length = Number(request.headers.get('content-length'));
            if (!Number.isInteger(length) || length <= 0 || length > MAX_BYTES || !request.body) throw new HttpError(413, 'Choose a file between 1 byte and 50 MB.');
            const name = value(url.searchParams.get('name'), 'package name', 100), subsystem = value(url.searchParams.get('subsystem'), 'subsystem');
            if (!Object.hasOwn((await subsystemNames()).labels, subsystem)) throw new HttpError(400, 'Choose a subsystem.');
            const note = value(url.searchParams.get('note'), 'change notes', 2000);
            const existing = url.searchParams.get('id'), id = existing || crypto.randomUUID();
            const operation = url.searchParams.get('operation'), session = url.searchParams.get('session');
            if (operation && (!existing || !uuid(operation) || !uuid(session))) throw new HttpError(400, 'Invalid automatic save session.');
            if (session && !uuid(session)) throw new HttpError(400, 'Invalid editing session.');
            const manifest = parseManifest(request.headers.get('X-AeroVault-Manifest') ? decodeURIComponent(request.headers.get('X-AeroVault-Manifest')!) : null);
            const manifestText = manifest ? JSON.stringify(manifest) : null;
            const versionId = operation || crypto.randomUUID();
            const base = Number(url.searchParams.get('base'));
            // A queued, immutable native ZIP keeps its operation ID until acknowledged.
            // Lost responses can be retried without creating a duplicate revision.
            const completed = async () => {
                if (!operation) return null;
                const v = await db.prepare('SELECT * FROM versions WHERE id=?').bind(operation).first<any>();
                if (!v) return null;
                if (v.package_id !== id || v.author_id !== m.user_id || v.revision !== base + 1 || v.filename !== filename || v.size !== length || v.note !== note || (v.manifest || null) !== manifestText)
                    throw new HttpError(409, 'This save identifier already belongs to a different revision.');
                const latest = await db.prepare('SELECT version FROM packages WHERE id=?').bind(id).first<any>();
                return { ok: true, id, version: v.revision, revisionId: v.id, currentVersion: latest.version, replayed: true };
            };
            const prior = await completed(); if (prior) return Response.json(prior);
            const p = existing ? await db.prepare('SELECT * FROM packages WHERE id=?').bind(id).first<any>() : null;
            if (existing && !p) throw new HttpError(404, 'Package not found.');
            if (p) {
                if (p.version !== base) throw new HttpError(409, 'A newer cloud revision exists. Your local save is safe; open the latest revision before continuing.');
                const active = p.locked_by && p.locked_at > cutoff;
                if (session ? !active || p.locked_by !== m.user_id || p.lock_token !== session : active)
                    throw new HttpError(409, 'The editing session changed or another editor is active. Your local file has not been overwritten.');
            }
            const previousManifest = p ? parseManifest((await db.prepare('SELECT manifest FROM versions WHERE id=?').bind(p.current_version_id).first<any>())?.manifest) : null;
            const graph = await validateManifest(manifest, id, previousManifest);
            const topologyChanged = JSON.stringify((manifest?.refs || []).map(r=>r.packageId).sort()) !== JSON.stringify((previousManifest?.refs || []).map(r=>r.packageId).sort());
            if ((p?.subsystem || subsystem) === MAIN_ASSEMBLIES && (!manifest || !/\.sldasm$/i.test(manifest.root))) throw new HttpError(400,'Prepare an assembly with Aero Vault 0.4 or later. Pack and Go includes its referenced files.');
            const master = p?.system_key === 'master' || (!p && (name.toUpperCase() === 'SAEAEROMAIN' || manifest?.root.toUpperCase() === 'SAEAEROMAIN.SLDASM'));
            if (master && (subsystem !== MAIN_ASSEMBLIES || name !== 'SAEAEROMAIN' || manifest?.root !== 'SAEAEROMAIN.SLDASM')) throw new HttpError(400,'The master must be named SAEAEROMAIN with root SAEAEROMAIN.SLDASM.');
            if (master && !p && await db.prepare("SELECT id FROM packages WHERE system_key='master'").first()) throw new HttpError(409,'SAEAEROMAIN already exists. Open its current revision.');
            const rev = p ? p.version + 1 : 1;
            // Separate object keys even for simultaneous retries of the same operation.
            const key = `packages/${id}/${versionId}/${crypto.randomUUID()}`;
            stored = key;
            // R2 requires a known-length stream. A generic TransformStream loses
            // that metadata; FixedLengthStream also rejects short or excess data.
            const bounded = new FixedLengthStream(length);
            const controller = new AbortController();
            const pumping = request.body.pipeTo(bounded.writable, { signal: controller.signal });
            const writing = Promise.resolve().then(() => bucket().put(key, bounded.readable, { httpMetadata: { contentType: 'application/octet-stream' } }));
            try {
                await Promise.all([pumping, writing]);
            } catch (error) {
                controller.abort(error);
                // Finish both operations before the outer catch removes the object.
                await Promise.allSettled([pumping, writing]);
                throw error;
            }
            const object = await bucket().head(key);
            if (!object || object.size !== length) throw new HttpError(400, 'The upload was incomplete. Please try again.');
            if (p) {
                const fresh = new Date().toISOString(), freshCutoff = new Date(Date.now() - TTL).toISOString();
                const guard = session ? 'locked_by=? AND lock_token=? AND locked_at>?' : '(locked_by IS NULL OR locked_at<=?)';
                const args = session ? [m.user_id, session, freshCutoff] : [freshCutoff];
                const rebuilding = request.headers.get('X-AeroVault-Rebuild') === '1';
                const refs = rebuilding ? manifest?.refs || [] : [];
                const graphGuard = " AND NOT EXISTS (SELECT 1 FROM json_each(?) j JOIN packages gp ON gp.id=json_extract(j.value,'$.id') WHERE gp.version<>json_extract(j.value,'$.version'))";
                const snapshot = JSON.stringify(topologyChanged ? graph.map(r=>({id:r.id,version:r.version})) : []);
                const dependencyGuard = refs.map(() => ' AND EXISTS (SELECT 1 FROM packages WHERE id=? AND version=?)').join('');
                const pins = refs.flatMap(r => [r.packageId,r.revision]);
                const result = await db.batch([
                    db.prepare(`INSERT OR IGNORE INTO versions (id,package_id,revision,filename,size,storage_key,note,author_id,author_name,created_at,manifest) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM packages WHERE id=? AND version=? AND ${guard})${dependencyGuard}${graphGuard}`).bind(versionId, id, rev, filename, length, key, note, m.user_id, m.name, fresh, manifestText, id, base, ...args, ...pins, snapshot),
                    db.prepare("UPDATE packages SET version=?,current_version_id=?,locked_by=?,lock_token=?,locked_at=?,updated_at=?,status='In progress',assembly_message=NULL WHERE id=? AND version=? AND EXISTS (SELECT 1 FROM versions WHERE id=? AND storage_key=?)").bind(rev, versionId, session ? m.user_id : null, session || null, session ? fresh : null, fresh, id, base, versionId, key)
                ]);
                if (!result[0].meta.changes) {
                    const replay = await completed();
                    if (replay) { await bucket().delete(key); stored = null; return Response.json(replay); }
                    throw new HttpError(409, 'The editing session or cloud revision changed during upload. Your local save is safe.');
                }
            } else {
                await db.batch([db.prepare("INSERT INTO packages (id,name,subsystem,status,version,current_version_id,updated_at,system_key) VALUES (?,?,?,'In progress',1,?,?,?)").bind(id, name, subsystem, versionId, now, master ? 'master' : null), db.prepare('INSERT INTO versions (id,package_id,revision,filename,size,storage_key,note,author_id,author_name,created_at,manifest) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(versionId, id, rev, filename, length, key, note, m.user_id, m.name, now, manifestText)]);
            }
            stored = null;
            // Revision commit is authoritative; activity failure must not report a failed save.
            await event(m.name, `${operation ? 'automatically saved' : p ? 'updated' : 'uploaded'} ${p?.name || name} · revision ${rev}`, id).run().catch(() => {});
            return Response.json({ ok: true, id, version: rev, revisionId: versionId, currentVersion: rev });
        }
        const b = await payload(request), id = value(b.id, 'package ID');
        const p = await db.prepare('SELECT * FROM packages WHERE id=?').bind(id).first<any>();
        if (!p) throw new HttpError(404, 'Package not found.');
        if (b.action === 'rename') {
            if (p.system_key) throw new HttpError(403,'SAEAEROMAIN is a protected system assembly.');
            const name = displayName(b.name), previous = value(b.previousName, 'previous name', 100);
            if (p.name === name) return Response.json({ ok: true });
            const result = await db.prepare('UPDATE packages SET name=?,updated_at=? WHERE id=? AND name=?')
                .bind(name, now, id, previous).run();
            if (!result.meta.changes) throw new HttpError(409, 'This package was renamed by someone else. Close this dialog and try again.');
            await event(m.name, `renamed ${previous} to ${name}`, id).run().catch(() => {});
            return Response.json({ ok: true });
        }
        if (b.action === 'editing') {
            if (!uuid(b.session) || !Number.isInteger(b.base) || b.base < 1) throw new HttpError(400, 'Invalid editing session.');
            const r = await db.prepare('UPDATE packages SET locked_by=?,lock_token=?,locked_at=? WHERE id=? AND version=? AND (locked_by IS NULL OR locked_at<=? OR (locked_by=? AND lock_token=?))').bind(m.user_id, b.session, now, id, b.base, cutoff, m.user_id, b.session).run();
            if (!r.meta.changes) {
                const editor = await db.prepare('SELECT p.version,m.name FROM packages p LEFT JOIN members m ON m.user_id=p.locked_by WHERE p.id=?').bind(id).first<any>();
                throw new HttpError(409, editor.version !== b.base ? 'A newer cloud revision exists. Open the latest revision to edit.' : `${editor.name || 'Another teammate'} is editing this package. Open it read-only for now.`);
            }
            return Response.json({ ok: true, id, version: p.version, revisionId: p.current_version_id, expiresAt: new Date(Date.now() + TTL).toISOString() });
        }
        if (b.action === 'finished') {
            if (!uuid(b.session)) throw new HttpError(400, 'Invalid editing session.');
            await db.prepare('UPDATE packages SET locked_by=NULL,lock_token=NULL,locked_at=NULL WHERE id=? AND locked_by=? AND lock_token=?').bind(id, m.user_id, b.session).run();
            return Response.json({ ok: true });
        }
        if (b.action === 'status') {
            if (!['In progress', 'Ready for review', 'Approved'].includes(b.status)) throw new HttpError(400, 'Choose a valid design status.');
            if (b.status === 'Approved' || p.status === 'Approved') administrator(m);
            const r = await db.prepare('UPDATE packages SET status=?,updated_at=? WHERE id=? AND version=? AND (locked_by IS NULL OR locked_at<=?)').bind(b.status, now, id, b.base, cutoff).run();
            if (!r.meta.changes) throw new HttpError(409, 'Someone is editing this package, or a newer revision exists. Refresh before changing its status.');
            await event(m.name, `marked ${p.name} ${b.status.toLowerCase()}`, id).run();
            return Response.json({ ok: true });
        }
        throw new HttpError(400, 'Update your Aero Vault add-in. Manual checkout and check-in have been replaced by automatic editing sessions.');
    } catch (e) {
        if (stored) await bucket().delete(stored).catch(() => {});
        return failure(e);
    }
}
