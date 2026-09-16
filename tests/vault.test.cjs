// Exercise the actual route handlers with SQLite and an in-memory R2 adapter.
// Run: node tests/vault.test.cjs. No production accounts, data, or network used.
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const ts = require('typescript');
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
const BUCKET = { async put(k, b) { const bytes = new Uint8Array(await new Response(b).arrayBuffer()); files.set(k, bytes); }, async head(k) { return files.has(k) ? { size: files.get(k).length } : null; }, async get(k) { const b = files.get(k); return b ? { body: b, size: b.length } : null; }, async delete(k) { files.delete(k); } };
let vault;
function compile(path) { const out = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const module = { exports: {} }; new Function('require', 'module', 'exports', out)(name => name === 'cloudflare:workers' ? { env: { DB, BUCKET } } : name === '@/app/chatgpt-auth' ? { getChatGPTUser: async () => identity.getStore() || null } : name === '@/lib/vault' ? vault : require(name), module, module.exports); return module.exports; }
vault = compile('lib/vault.ts');
const workspace = compile('app/api/workspace/route.ts'), packages = compile('app/api/packages/route.ts'), members = compile('app/api/members/route.ts'), download = compile('app/api/download/route.ts');
const admin = { userId: 'admin', email: 'admin@example.test', displayName: 'Admin' }, editor = { userId: 'editor', email: 'editor@example.test', displayName: 'Editor' }, viewer = { userId: 'viewer', email: 'viewer@example.test', displayName: 'Viewer' }, outsider = { userId: 'outsider', email: 'outsider@example.test', displayName: 'Outsider' };
function call(route, user, body, query = '', raw = false, origin = 'https://vault.test') { return identity.run(user, () => { const headers = { origin }; if (body !== undefined) {
    headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json';
    headers['Content-Length'] = String(raw ? body.length : JSON.stringify(body).length);
} const req = new Request('https://vault.test/api/test' + query, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) }); return route[body === undefined ? 'GET' : 'POST'](req); }); }
function upload(user, id, base, content = 'test CAD package', filename = 'wing.zip') { const q = new URLSearchParams({ action: 'upload', name: 'Main wing', subsystem: 'Wings', note: 'Test revision', filename }); if (id) {
    q.set('id', id);
    q.set('base', String(base));
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
    assert.equal((await upload(viewer)).status, 403);
    assert.equal((await upload(admin, null, null, 'data', 'bad.exe')).status, 400);
    const first = await upload(admin);
    assert.equal(first.status, 200);
    const { id } = await first.json();
    const initial = await (await call(workspace, admin)).json();
    const v1 = initial.versions[0].id;
    assert.equal((await call(download, outsider, undefined, '?id=' + v1)).status, 403);
    assert.equal(await (await call(download, viewer, undefined, '?id=' + v1)).text(), 'test CAD package');
    const attempts = await Promise.all([call(packages, editor, { action: 'checkout', id }), call(packages, admin, { action: 'checkout', id })]);
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
    const holder = sqlite.prepare('SELECT locked_by FROM packages WHERE id=?').get(id).locked_by === 'admin' ? admin : editor;
    const other = holder === admin ? editor : admin;
    assert.equal((await upload(other, id, 1)).status, 409);
    assert.equal((await upload(holder, id, 0)).status, 409);
    const concurrent = await Promise.all([upload(holder, id, 1, 'revision A'), upload(holder, id, 1, 'revision B')]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM versions').get().n, 2);
    assert.equal(files.size, 2);
    assert.equal(sqlite.prepare('SELECT locked_by FROM packages').get().locked_by, null);
    assert.equal(await (await call(download, viewer, undefined, '?id=' + v1)).text(), 'test CAD package');
    assert.equal((await call(packages, editor, { action: 'status', id, base: 2, status: 'Approved' })).status, 403);
    assert.equal((await call(packages, admin, { action: 'status', id, base: 1, status: 'Approved' })).status, 409);
    assert.equal((await call(packages, admin, { action: 'status', id, base: 2, status: 'Approved' })).status, 200);
    assert.equal((await call(packages, editor, { action: 'checkout', id })).status, 200);
    assert.equal((await call(packages, admin, { action: 'release', id })).status, 200);
    assert.equal((await upload(editor, id, 2)).status, 409);
    for (let i = 0; i < 6; i++)
        assert.equal((await call(members, admin, { name: 'Member ' + i, email: `m${i}@example.test`, role: 'editor' })).status, 200);
    assert.equal((await call(members, admin, { name: 'Too many', email: 'extra@example.test', role: 'editor' })).status, 409);
    console.log('PASS: sign-in, membership, roles, 9-person limit, cross-origin protection, uploads/downloads, competing checkouts, concurrent revisions, stale revisions, historical bytes, status approval, and admin lock recovery.');
})().catch(e => { console.error(e); process.exitCode = 1; });
