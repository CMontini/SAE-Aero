// Actual upload route in workerd with local D1 and R2 (no production data).
// Run: node tests/upload-worker.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const ts = require('typescript');
const { Miniflare } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
function source(path) {
    return ts.transpileModule(fs.readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText.replaceAll('@/lib/vault', './vault.js').replaceAll('@/app/chatgpt-auth', './auth.js');
}
const mf = new Miniflare({
    compatibilityDate: '2026-05-15', modulesRoot: '/',
    modules: [
        { type: 'ESModule', path: '/entry.js', contents: `
            import { POST } from './route.js';
            export default { async fetch(request) {
                // Construct the request inside workerd so malformed lengths reach
                // the handler instead of being rejected by the HTTP client.
                const spec = await request.json();
                const bytes = new Uint8Array(spec.size).fill(42);
                const body = new ReadableStream({start(c) {
                    for (let i=0; i<bytes.length; i+=16384) c.enqueue(bytes.slice(i,i+16384));
                    if (spec.broken) c.error(new Error('Interrupted upload')); else c.close();
                }});
                return POST(new Request('https://vault.test/api/packages?' + spec.query, {
                    method:'POST', headers:{origin:'https://vault.test', 'content-length':String(spec.length)}, body
                }));
            }};` },
        { type: 'ESModule', path: '/route.js', contents: source('app/api/packages/route.ts') },
        { type: 'ESModule', path: '/vault.js', contents: source('lib/vault.ts') },
        { type: 'ESModule', path: '/auth.js', contents: `export async function getChatGPTUser() { return {userId:'test-editor'}; }` }
    ], d1Databases: ['DB'], r2Buckets: ['BUCKET']
});
(async () => {
    const db = await mf.getD1Database('DB'), bucket = await mf.getR2Bucket('BUCKET');
    for (const f of fs.readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) {
        const sql = fs.readFileSync('drizzle/' + f, 'utf8');
        for (const stmt of sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
    }
    await db.prepare("INSERT INTO members (id,user_id,email,name,role,created_at) VALUES ('test-member','test-editor','editor@example.test','Editor','editor',?)").bind(new Date().toISOString()).run();
    const query = new URLSearchParams({action:'upload', filename:'wing.zip', name:'Wing', subsystem:'Wings', note:'Saved automatically from SolidWorks'});
    const upload = async (size, length = size, broken = false) => mf.dispatchFetch('https://test/', {
        method:'POST', body:JSON.stringify({size, length, broken, query:query.toString()})
    });
    const first = await upload(121573);
    assert.equal(first.status, 200, await first.clone().text());
    const {id} = await first.json();
    const session = crypto.randomUUID(), operation = crypto.randomUUID();
    await db.prepare('UPDATE packages SET locked_by=?,lock_token=?,locked_at=? WHERE id=?').bind('test-editor',session,new Date().toISOString(),id).run();
    query.set('id', id); query.set('base','1'); query.set('session',session); query.set('operation',operation);
    const saved = await upload(121573);
    assert.equal(saved.status,200,await saved.clone().text());
    assert.equal((await saved.json()).version,2);
    assert.equal((await (await upload(121573)).json()).replayed,true);
    const revision = await db.prepare('SELECT * FROM versions WHERE id=?').bind(operation).first();
    assert.equal((await bucket.head(revision.storage_key)).size,121573);
    assert.equal(new Uint8Array(await (await bucket.get(revision.storage_key)).arrayBuffer()).every(b => b===42),true);
    query.set('base','2'); query.set('operation',crypto.randomUUID());
    for (const [size,length,broken] of [[3,4,false],[5,4,false],[4,4,true],[1,50*1024*1024+1,false]]) {
        const rejected = await upload(size,length,broken);
        assert.notEqual(rejected.status,200);
        assert.equal((await db.prepare('SELECT version FROM packages WHERE id=?').bind(id).first()).version,2);
        assert.equal((await bucket.list()).objects.length,2);
    }
    console.log('PASS: workerd/R2 streamed upload, automatic revision, idempotent retry, exact stored bytes, short/long/interrupted/oversized rejection and orphan cleanup.');
})().catch(e => { console.error(e); process.exitCode=1; }).finally(() => mf.dispose());
