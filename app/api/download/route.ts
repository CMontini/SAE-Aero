import { database, bucket, member, failure, HttpError } from '@/lib/vault';
export async function GET(request: Request) { try {
    await member();
    const id = new URL(request.url).searchParams.get('id');
    const v = await database().prepare('SELECT storage_key,filename FROM versions WHERE id=?').bind(id).first<{
        storage_key: string;
        filename: string;
    }>();
    if (!v)
        throw new HttpError(404, 'This revision was not found.');
    const o = await bucket().get(v.storage_key);
    if (!o)
        throw new HttpError(404, 'The file is unavailable. Contact your team administrator.');
    return new Response(o.body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(v.filename)}`, 'Content-Length': String(o.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
catch (e) {
    return failure(e);
} }
