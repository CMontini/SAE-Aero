import { payload, database, member, administrator, mutation, displayName, event, failure, HttpError, MAIN_ASSEMBLIES, subsystemNames } from '@/lib/vault';
export async function POST(request: Request) {
    try {
        mutation(request);
        const m = await member(); administrator(m);
        const body = await payload(request);
        const creating = body.action === 'create';
        if (body.action !== undefined && !['create', 'rename'].includes(body.action)) throw new HttpError(400, 'Unknown folder action.');
        if (!Number.isInteger(body.revision) || body.revision < 0)
            throw new HttpError(400, 'Choose a valid subsystem folder.');
        const name = displayName(body.name, 60), current = await subsystemNames();
        if (current.revision !== body.revision) throw new HttpError(409, 'Folder names changed. Close this dialog and try again.');
        if (!creating && body.id === MAIN_ASSEMBLIES) throw new HttpError(403, 'Main Assemblies is a protected system folder.');
        const id = creating ? `subsystem-${crypto.randomUUID()}` : body.id;
        if (!creating && (typeof id !== 'string' || !Object.hasOwn(current.labels, id))) throw new HttpError(400, 'Choose a valid subsystem folder.');
        const normalized = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
        if (normalized(name) === 'all subsystems' || Object.keys(current.labels).some(key => key !== id && normalized(current.labels[key]) === normalized(name)))
            throw new HttpError(400, 'Another folder already uses that name. Choose a different name.');
        const previous = current.labels[id];
        if (!creating && previous === name) return Response.json({ok:true,id});
        const labels = {...current.labels, [id]:name};
        const result = await database().prepare("INSERT INTO workspace_settings (id,value,revision) VALUES ('subsystems',?,1) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=workspace_settings.revision+1 WHERE workspace_settings.revision=?").bind(JSON.stringify(labels), body.revision).run();
        if (!result.meta.changes) throw new HttpError(409, 'Folder names changed. Close this dialog and try again.');
        await event(m.name, creating ? `created subsystem ${name}` : `renamed subsystem ${previous} to ${name}`).run().catch(() => {});
        return Response.json({ok:true,id});
    } catch (e) { return failure(e); }
}
