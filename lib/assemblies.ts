import { database, HttpError, MAIN_ASSEMBLIES } from '@/lib/vault';
export type Reference = { packageId:string; revision:number; root:string; files:string[] };
export type Manifest = { protocol:1; root:string; files:string[]; refs:Reference[] };
const cad = (s:unknown):s is string => typeof s==='string' && s.length<=180 && !/[\\/:*?"<>|\x00-\x1f]/.test(s) && !/[. ]$/.test(s) && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s) && /\.(sldasm|sldprt|slddrw)$/i.test(s);
export function parseManifest(raw:string|null):Manifest|null {
 if(!raw)return null;
 try {
  if(raw.length>48000)throw 0;
  const m=JSON.parse(raw);
  const files=(a:unknown)=>Array.isArray(a)&&a.length>0&&a.length<=512&&a.every(cad)&&new Set(a.map((f:string)=>f.toLowerCase())).size===a.length;
  if(m.protocol!==1||!cad(m.root)||!files(m.files)||!m.files.includes(m.root)||!Array.isArray(m.refs)||m.refs.length>64)throw 0;
  if(m.refs.some((r:Reference)=>!r||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(r.packageId)||!Number.isInteger(r.revision)||r.revision<1||!cad(r.root)||!files(r.files)||!r.files.includes(r.root)||r.files.some(f=>!m.files.includes(f))))throw 0;
  if(new Set(m.refs.map((r:Reference)=>r.packageId)).size!==m.refs.length||m.refs.some((r:Reference)=>r.files.includes(m.root)))throw 0;
  return {protocol:1,root:m.root,files:m.files,refs:m.refs.map((r:Reference)=>({packageId:r.packageId,revision:r.revision,root:r.root,files:r.files}))};
 }catch{throw new HttpError(400,'Invalid assembly reference manifest. Prepare the design again with the latest add-in.');}
}
export async function assemblyRows(){
 const result=await database().prepare('SELECT p.*,v.manifest FROM packages p JOIN versions v ON v.id=p.current_version_id').all<any>();
 return result.results.map(r=>({...r,manifest:parseManifest(r.manifest)}));
}
export async function validateManifest(m:Manifest|null,id:string,previous:Manifest|null){
 const rows=await assemblyRows(), byId=new Map<string,any>(rows.map(r=>[r.id,r]));
 if(previous&&!m)throw new HttpError(400,'Use the latest SolidWorks add-in to update this linked design.');
 if(previous&&m&&previous.root!==m.root)throw new HttpError(409,'Keep the CAD root filename unchanged to preserve assembly references. Upload Save As as a new package.');
 if(!m)return rows;
 const walk=(next:string,seen:Set<string>):boolean=>{
  if(next===id)return true;if(seen.has(next))return false;seen.add(next);
  return (byId.get(next)?.manifest?.refs||[]).some((r:Reference)=>walk(r.packageId,seen));
 };
 for(const ref of m.refs){
  const target=byId.get(ref.packageId);
  if(!target||walk(ref.packageId,new Set()))throw new HttpError(409,'Assembly references must exist and cannot form a cycle.');
  const v=await database().prepare('SELECT manifest FROM versions WHERE package_id=? AND revision=?').bind(ref.packageId,ref.revision).first<{manifest:string}>();
  const expected=v&&parseManifest(v.manifest);
  if(!expected||expected.root!==ref.root||JSON.stringify([...expected.files].sort())!==JSON.stringify([...ref.files].sort()))throw new HttpError(409,'A linked revision does not match its package. Sync the referenced design first.');
 }
 return rows;
}
export function assemblyPlans(rows:any[]){
 const byId=new Map<string,any>(rows.map(r=>[r.id,r]));
 const stale=(p:any,seen=new Set<string>()):boolean=>{
  if(seen.has(p.id))return true;seen.add(p.id);
  return !!p.manifest?.refs.some((r:Reference)=>{const child=byId.get(r.packageId);return !child||child.version!==r.revision||stale(child,new Set(seen));});
 };
 const descriptor=(p:any)=>({packageId:p.id,revisionId:p.current_version_id,version:p.version,name:p.name,subsystem:p.subsystem,manifest:p.manifest});
 const mains=rows.filter(p=>p.subsystem===MAIN_ASSEMBLIES&&!p.system_key);
 const master=rows.find(p=>p.system_key==='master');
 const eligible=mains.every(p=>p.manifest&&/\.sldasm$/i.test(p.manifest.root));
 const jobs=rows.filter(p=>p.manifest&&/\.sldasm$/i.test(p.manifest.root)).map(p=>{
  const refs=p.manifest.refs.map((r:Reference)=>byId.get(r.packageId));
  if(p.system_key==='master')for(const child of mains)if(!refs.some((r:any)=>r?.id===child.id))refs.push(child);
  const changed=stale(p)||refs.length!==p.manifest.refs.length;
  const ready=changed&&refs.every((r:any)=>r?.manifest&&!stale(r))&&(!p.system_key||eligible);
  return {...descriptor(p),needsUpdate:changed,ready,editing:!!p.locked_by&&Date.parse(p.locked_at)>Date.now()-120000,dependencies:refs.filter(Boolean).map(descriptor)};
 });
 return {jobs,canCreate:!master&&mains.length>0&&eligible&&mains.every(p=>!stale(p)),components:mains.filter(p=>p.manifest).map(descriptor)};
}
