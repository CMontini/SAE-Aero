import { member, failure, writable, mutation, payload, database, value, HttpError } from '@/lib/vault';
import { assemblyRows, assemblyPlans } from '@/lib/assemblies';
export const dynamic='force-dynamic';
export async function GET(){try{await member();return Response.json(assemblyPlans(await assemblyRows()),{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}

export async function POST(request:Request){try{
 mutation(request);const m=await member();writable(m);const b=await payload(request);
 const result=await database().prepare('UPDATE packages SET assembly_message=? WHERE id=? AND version=? AND locked_by=? AND lock_token=? AND locked_at>?')
 .bind(value(b.message,'assembly status',1600),value(b.id,'package'),b.base,m.user_id,value(b.session,'session'),new Date(Date.now()-120000).toISOString()).run();
 if(!result.meta.changes)throw new HttpError(409,'Assembly status is from an expired editing session.');
 return Response.json({ok:true});
}catch(e){return failure(e);}}
