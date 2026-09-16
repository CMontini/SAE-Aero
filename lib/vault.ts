import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export const SUBSYSTEMS = ['Wings', 'Fuselage', 'Empennage', 'Propulsion', 'Landing gear'];
export const MAX_BYTES = 50 * 1024 * 1024;
export class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export function database(): D1Database { if (!env.DB)
    throw new HttpError(503, 'The workspace is temporarily unavailable. Please try again.'); return env.DB; }
export function bucket(): R2Bucket { if (!env.BUCKET)
    throw new HttpError(503, 'File storage is temporarily unavailable. Please try again.'); return env.BUCKET; }
export function failure(e: unknown) { if (e instanceof HttpError)
    return Response.json({ error: e.message }, { status: e.status }); console.error('Vault request failed', e); return Response.json({ error: 'We could not complete that action. Please try again.' }, { status: 503 }); }
export async function identity() { const u = await getChatGPTUser(); if (!u)
    throw new HttpError(401, 'Please sign in to continue.'); return u; }
export type Member = {
    id: string;
    user_id: string | null;
    email: string;
    name: string;
    role: string;
};
export async function member() { const u = await identity(); const m = await database().prepare('SELECT * FROM members WHERE user_id=?').bind(u.userId).first<Member>(); if (!m)
    throw new HttpError(403, 'Your account does not have access to this workspace.'); return m; }
export function writable(m: Member) { if (m.role === 'viewer')
    throw new HttpError(403, 'Viewers cannot change design packages.'); }
export function administrator(m: Member) { if (m.role !== 'admin')
    throw new HttpError(403, 'Only the team administrator can do that.'); }
export function mutation(r: Request) { const origin = r.headers.get('origin'); if (!origin || origin !== new URL(r.url).origin)
    throw new HttpError(403, 'Please make this change from the workspace.'); }
export function value(v: unknown, label: string, max = 160) { if (typeof v !== 'string' || !v.trim() || v.trim().length > max)
    throw new HttpError(400, `Enter a valid ${label} (up to ${max} characters).`); return v.trim(); }
export function event(actor: string, message: string, packageId: string | null = null) { return database().prepare('INSERT INTO activity (id,package_id,actor,message,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), packageId, actor, message, new Date().toISOString()); }
export async function payload(request: Request): Promise<Record<string, any>> { let b: unknown; try {
    b = await request.json();
}
catch {
    throw new HttpError(400, 'Send valid request details.');
} if (!b || typeof b !== 'object' || Array.isArray(b))
    throw new HttpError(400, 'Send valid request details.'); return b as Record<string, any>; }
