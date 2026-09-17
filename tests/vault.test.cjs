// Exercise the actual route handlers with SQLite and an in-memory R2 adapter.
// Run: node tests/vault.test.cjs. No production accounts, data, or network used.
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const ts = require('typescript');
// Node adapter only; upload-worker.test.cjs verifies the native workerd/R2 contract.
globalThis.FixedLengthStream = class extends TransformStream {
    constructor(length) {
        let received = 0;
        super({ transform(chunk, controller) {
            received += chunk.byteLength;
            if (received > length) throw new Error('Excess upload bytes');
            controller.enqueue(chunk);
        }, flush() { if (received !== length) throw new Error('Incomplete upload'); } });
    }
};
const identity = new AsyncLocalStorage();
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for (const f of fs.readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort())
    sqlite.exec(fs.readFileSync('drizzle/' + f, 'utf8'));
function statement(sql, args = []) { return { bind(...values) { return statement(sql, values); }, async first() { return sqlite.prepare(sql).get(...args) || null; }, async run() { return this.execute(); }, execute() { const s = sqlite.prepare(sql); if (/^\s*SELECT/i.test(sql))
        return { results: s.all(...args), meta: { changes: 0 } }; const r = s.run(...args); return { results: [], meta: { changes: Number(r.changes) } }; } }; }
;
const DB = { prepare: statement, async batch(list) { sqlite.exec('BEGIN'); try {
        const r = list.map(s => s.execute());
        sqlite.exec('COMMIT');
        return r;
    }
    catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
    } } };
const files = new Map();
let duringUpload = null;
const BUCKET = { async put(k, b) { const bytes = new Uint8Array(await new Response(b).arrayBuffer()); files.set(k, bytes); if (duringUpload) { const hook = duringUpload; duringUpload = null; await hook(); } }, async head(k) { return files.has(k) ? { size: files.get(k).length } : null; }, async get(k) { const b = files.get(k); return b ? { body: b, size: b.length } : null; }, async delete(k) { files.delete(k); } };
let vault;
function compile(path) { const out = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const module = { exports: {} }; new Function('require', 'module', 'exports', out)(name => name === 'cloudflare:workers' ? { env: { DB, BUCKET } } : name === '@/app/chatgpt-auth' ? { getChatGPTUser: async () => identity.getStore() || null } : name === '@/lib/vault' ? vault : require(name), module, module.exports); return module.exports; }
vault = compile('lib/vault.ts');
const subsystems = compile('app/api/subsystems/route.ts');
const workspace = compile('app/api/workspace/route.ts'), packages = compile('app/api/packages/route.ts'), members = compile('app/api/members/route.ts'), download = compile('app/api/download/route.ts');
const admin = { userId: 'admin', email: 'admin@example.test', displayName: 'Admin' }, editor = { userId: 'editor', email: 'editor@example.test', displayName: 'Editor' }, viewer = { userId: 'viewer', email: 'viewer@example.test', displayName: 'Viewer' }, outsider = { userId: 'outsider', email: 'outsider@example.test', displayName: 'Outsider' };
function call(route, user, body, query = '', raw = false, origin = 'https://vault.test') { return identity.run(user, () => { const headers = { origin }; if (body !== undefined) {
    headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json';
    headers['Content-Length'] = String(raw ? body.length : JSON.stringify(body).length);
} const req = new Request('https://vault.test/api/test' + query, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) }); return route[body === undefined ? 'GET' : 'POST'](req); }); }
function upload(user, id, base, content = 'test CAD package', filename = 'wing.zip', session = null, operation = null, subsystem = 'Wings') { const q = new URLSearchParams({ action: 'upload', name: 'Main wing', subsystem, note: 'Test revision', filename }); if (id) {
    q.set('id', id);
    q.set('base', String(base)); if (session) q.set('session', session); if (operation) q.set('operation', operation);
} return call(packages, user, content, '?' + q, true); }
(async () => {
    assert.equal((await call(workspace, null)).status, 401);
    assert.equal((await call(workspace, admin)).status, 200);
    assert.equal((await call(workspace, admin, { action: 'setup' }, '', false, 'https://wrong.test')).status, 403);
    assert.equal((await call(workspace, admin, { action: 'setup' })).status, 200);
    assert.equal((await call(workspace, admin, { action: 'setup' })).status, 409);
    assert.equal((await upload(outsider)).status, 403);
    for (const [u, role] of [[editor, 'editor'], [viewer, 'viewer']]) {
        assert.equal((await call(members, admin, { name: u.displayName, email: u.email, role })).status, 200);
        assert.equal((await call(workspace, u, { action: 'join' })).status, 200);
    }
    const renameFolder = (user, id, name, revision) => call(subsystems, user, {id,name,revision});
    assert.equal((await renameFolder(outsider, 'Wings', 'Wing structures', 0)).status,403);
    assert.equal((await renameFolder(editor, 'Wings', 'Wing structures', 0)).status,403);
    assert.equal((await renameFolder(viewer, 'Wings', 'Wing structures', 0)).status,403);
    assert.equal((await renameFolder(admin, 'Wings', 'fuselage', 0)).status,400);
    assert.equal((await renameFolder(admin, 'Wings', 'All subsystems', 0)).status,400);
    assert.equal((await renameFolder(admin, 'Wings', 'bad\nname', 0)).status,400);
    assert.equal((await renameFolder(admin, 'Wings', 'Wing structures', 0)).status,200);
    assert.equal((await renameFolder(admin, 'Fuselage', 'Airframe', 0)).status,409);
    const folderNames = (await (await call(workspace, viewer)).json()).subsystems;
    assert.equal(folderNames.labels.Wings,'Wing structures');
    assert.equal(folderNames.labels.Fuselage,'Fuselage');
    assert.equal(folderNames.revision,1);
    const folderRace = await Promise.all([renameFolder(admin,'Fuselage','Airframe',1),renameFolder(admin,'Propulsion','Powertrain',1)]);
    assert.deepEqual(folderRace.map(r=>r.status).sort(),[200,409]);
    const createFolder = (user, name, revision) => call(subsystems,user,{action:'create',name,revision});
    for (const user of [outsider,viewer,editor]) assert.equal((await createFolder(user,'Avionics',2)).status,403);
    assert.equal((await createFolder(admin,'  ',2)).status,400);
    assert.equal((await createFolder(admin,'Wing structures',2)).status,400);
    const createdFolder = await createFolder(admin,'Avionics',2);
    assert.equal(createdFolder.status,200);
    const customSubsystem = (await createdFolder.json()).id;
    assert.match(customSubsystem,/^subsystem-/);
    assert.equal((await (await call(workspace,viewer)).json()).subsystems.labels[customSubsystem],'Avionics');
    assert.equal((await createFolder(admin,'AVIONICS',3)).status,400);
    assert.equal((await renameFolder(admin,customSubsystem,'Electronics',3)).status,200);
    const createRace = await Promise.all([createFolder(admin,'Controls',4),createFolder(admin,'Payload',4)]);
    assert.deepEqual(createRace.map(r=>r.status).sort(),[200,409]);
    assert.equal(Object.keys((await (await call(workspace,admin)).json()).subsystems.labels).length,7);
    assert.equal((await upload(viewer)).status, 403);
    assert.equal((await upload(admin, null, null, 'data', 'bad.exe')).status, 400);
    const first = await upload(admin);
    assert.equal(first.status, 200);
    const { id } = await first.json();
    const initial = await (await call(workspace, admin)).json();
    const v1 = initial.versions[0].id;
    assert.equal((await call(download, outsider, undefined, '?id=' + v1)).status, 403);
    assert.equal(await (await call(download, viewer, undefined, '?id=' + v1)).text(), 'test CAD package');
    const sessionA = crypto.randomUUID(), sessionB = crypto.randomUUID();
    const edit = (user, session, base) => call(packages, user, { action: 'editing', id, session, base });
    const finish = (user, session) => call(packages, user, { action: 'finished', id, session });
    assert.equal((await edit(viewer, sessionA, 1)).status, 403);
    assert.equal((await edit(editor, 'bad-session', 1)).status, 400);
    const attempts = await Promise.all([edit(editor, sessionA, 1), edit(admin, sessionB, 1)]);
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
    const holder = sqlite.prepare('SELECT locked_by FROM packages WHERE id=?').get(id).locked_by === 'admin' ? admin : editor;
    const other = holder === admin ? editor : admin;
    const session = holder === admin ? sessionB : sessionA;
    assert.equal((await edit(holder, session, 1)).status, 200);
    assert.equal((await edit(holder, crypto.randomUUID(), 1)).status, 409); // second device, same account
    const visible = await (await call(workspace, holder)).json();
    assert.equal(visible.packages[0].locked_by, holder.userId);
    assert.equal('lock_token' in visible.packages[0], false);
    assert.equal((await upload(other, id, 1)).status, 409);
    assert.equal((await upload(holder, id, 1)).status, 409); // browser cannot impersonate native session
    assert.equal((await upload(holder, id, 0, 'stale', 'wing.zip', session)).status, 409);
    const renamePackage = (user, name, previousName) => call(packages,user,{action:'rename',id,name,previousName});
    const original = sqlite.prepare('SELECT * FROM packages WHERE id=?').get(id);
    assert.equal((await renamePackage(viewer,'New wing','Main wing')).status,403);
    assert.equal((await renamePackage(holder,'   ','Main wing')).status,400);
    assert.equal((await renamePackage(holder,'Main wing assembly','Main wing')).status,200);
    assert.equal((await renamePackage(other,'Stale name','Main wing')).status,409);
    const renamed = sqlite.prepare('SELECT * FROM packages WHERE id=?').get(id);
    assert.equal(renamed.name,'Main wing assembly');
    for (const key of ['id','version','current_version_id','subsystem','locked_by','lock_token','locked_at','status']) assert.equal(renamed[key],original[key]);
    assert.equal(renamed.subsystem,'Wings'); // Stable ID despite the renamed folder.
    assert.equal(files.size,1);
    const op = crypto.randomUUID();
    const saves = await Promise.all([upload(holder, id, 1, 'save A', 'wing.zip', session, op), upload(holder, id, 1, 'save A', 'wing.zip', session, op)]);
    assert.deepEqual(saves.map(r => r.status), [200, 200]);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM versions').get().n, 2);
    assert.equal(files.size, 2);
    assert.equal(sqlite.prepare('SELECT name FROM packages WHERE id=?').get(id).name,'Main wing assembly'); // Old native name cannot undo a rename.
    assert.equal(sqlite.prepare('SELECT locked_by FROM packages').get().locked_by, holder.userId);
    assert.equal((await upload(holder, id, 1, 'different', 'wing.zip', session, op)).status, 409);
    assert.equal(await (await call(download, viewer, undefined, '?id=' + v1)).text(), 'test CAD package');
    assert.equal((await edit(holder, session, 1)).status, 409);
    assert.equal((await edit(holder, session, 2)).status, 200);
    await finish(other, session); // cannot end somebody else's session
    assert.equal(sqlite.prepare('SELECT locked_by FROM packages').get().locked_by, holder.userId);
    assert.equal((await call(packages, admin, { action: 'status', id, base: 2, status: 'Approved' })).status, 409);
    await finish(holder, session);
    assert.equal(sqlite.prepare('SELECT locked_by FROM packages').get().locked_by, null);
    const newer = crypto.randomUUID();
    assert.equal((await edit(other, newer, 2)).status, 200);
    await finish(holder, session); // old close event must not clear the new session
    assert.equal(sqlite.prepare('SELECT lock_token FROM packages').get().lock_token, newer);
    sqlite.prepare('UPDATE packages SET locked_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', id);
    assert.equal((await (await call(workspace, admin)).json()).packages[0].locked_by, null);
    assert.equal((await upload(other, id, 2, 'expired', 'wing.zip', newer)).status, 409);
    assert.equal((await edit(holder, session, 2)).status, 200); // expired session recovered automatically
    const concurrent = await Promise.all([upload(holder, id, 2, 'save B', 'wing.zip', session, crypto.randomUUID()), upload(holder, id, 2, 'save C', 'wing.zip', session, crypto.randomUUID())]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    assert.equal(files.size, 3);
    const beforeRace = files.size;
    duringUpload = async () => { await finish(holder, session); await edit(other, newer, 3); };
    assert.equal((await upload(holder, id, 3, 'racing save', 'wing.zip', session, crypto.randomUUID())).status, 409);
    assert.equal(files.size, beforeRace);
    await finish(other, newer);
    assert.equal((await upload(editor, id, 3, 'manual update')).status, 200); // no checkout required in browser
    assert.equal((await upload(editor, id, 3, 'old local version')).status, 409);
    assert.equal((await call(packages, editor, { action: 'status', id, base: 4, status: 'Approved' })).status, 403);
    assert.equal((await call(packages, admin, { action: 'status', id, base: 4, status: 'Approved' })).status, 200);
    assert.equal((await call(packages, editor, { action: 'checkout', id })).status, 400);
    const replay = await (await upload(holder, id, 1, 'save A', 'wing.zip', session, op)).json();
    assert.equal(replay.version, 2); assert.equal(replay.currentVersion, 4); // lost acknowledgement after others saved
    for (let i = 0; i < 6; i++)
        assert.equal((await call(members, admin, { name: 'Member ' + i, email: `m${i}@example.test`, role: 'editor' })).status, 200);
    assert.equal((await call(members, admin, { name: 'Too many', email: 'extra@example.test', role: 'editor' })).status, 409);
    const newDesign = await upload(editor,null,null,'custom folder bytes','avionics.zip',null,null,customSubsystem);
    assert.equal(newDesign.status,200);
    const newId = (await newDesign.json()).id, customSession = crypto.randomUUID(), customOperation = crypto.randomUUID();
    assert.equal((await call(packages,editor,{action:'editing',id:newId,session:customSession,base:1})).status,200);
    assert.equal((await renameFolder(admin,customSubsystem,'Electrical systems',5)).status,200);
    const autoSave = await upload(editor,newId,1,'saved custom design','avionics.zip',customSession,customOperation,customSubsystem);
    assert.equal(autoSave.status,200);
    assert.equal((await (await upload(editor,newId,1,'saved custom design','avionics.zip',customSession,customOperation,customSubsystem)).json()).replayed,true);
    assert.equal(sqlite.prepare('SELECT subsystem FROM packages WHERE id=?').get(newId).subsystem,customSubsystem);
    assert.equal((await upload(editor,null,null,'bytes','bad.zip',null,null,'unknown-subsystem')).status,400);
    console.log('PASS: admin folder creation, duplicate names, concurrent creation, new-folder uploads/autosaves/retries, persistent folder labels, rename permissions and conflicts, unchanged sync identity and CAD bytes, authorization, 9-person limit, editing presence, session expiry, second-device conflicts, close/reopen races, automatic save retries, concurrent revisions, mid-upload session changes, immutable history, manual updates, and status approval.');
})().catch(e => { console.error(e); process.exitCode = 1; });
