import { payload, database, member, administrator, mutation, displayName, event, failure, HttpError, SUBSYSTEMS, subsystemNames } from '@/lib/vault';
export async function POST(request: Request) {
    try {
        mutation(request);
        const m = await member(); administrator(m);
        const body = await payload(request);
        if (!SUBSYSTEMS.includes(body.id) || !Number.isInteger(body.revision) || body.revision < 0)
            throw new HttpError(400, 'Choose a valid subsystem folder.');
        const name = displayName(body.name, 60), current = await subsystemNames();
        if (current.revision !== body.revision) throw new HttpError(409, 'Folder names changed. Close this dialog and try again.');
        const normalized = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
        if (normalized(name) === 'all subsystems' || SUBSYSTEMS.some(id => id !== body.id && normalized(current.labels[id]) === normalized(name)))
            throw new HttpError(400, 'Another folder already uses that name. Choose a different name.');
        const previous = current.labels[body.id];
        if (previous === name) return Response.json({ok:true});
        const labels = {...current.labels, [body.id]:name};
        const result = await database().prepare("INSERT INTO workspace_settings (id,value,revision) VALUES ('subsystems',?,1) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=workspace_settings.revision+1 WHERE workspace_settings.revision=?").bind(JSON.stringify(labels), body.revision).run();
        if (!result.meta.changes) throw new HttpError(409, 'Folder names changed. Close this dialog and try again.');
        await event(m.name, `renamed subsystem ${previous} to ${name}`).run().catch(() => {});
        return Response.json({ok:true});
    } catch (e) { return failure(e); }
}
