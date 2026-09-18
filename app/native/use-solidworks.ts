'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Manifest } from '@/lib/assemblies';
import { NativeTransfer } from '@/lib/native-transfer';
type Bridge = { postMessage:(data:unknown)=>void; addEventListener:(type:string,listener:(event:MessageEvent)=>void)=>void; removeEventListener:(type:string,listener:(event:MessageEvent)=>void)=>void };
type PackageInfo = { id:string; name:string; subsystem:string; version:number; current_version_id:string };
type Saved = { id:string; version:number; revisionId:string; currentVersion:number };
export type SyncRow = {packageId:string; session:string; version:number; name:string; open:boolean; pending:boolean; blocked:boolean; message:string};
type Auto = { packageId:string; session:string; version:number; packageName:string; subsystem:string; manifest?:Manifest; rebuild?:boolean };
type Pending = {id:string; transfer:NativeTransfer; automatic?:Auto; resolve?:(file:File)=>void; reject?:(error:Error)=>void; timer:ReturnType<typeof setTimeout>; uploading?:boolean; manifest?:Manifest};
class ApiError extends Error { constructor(message:string, readonly status:number){super(message)} }
function bridge():Bridge|undefined { return (window as unknown as {chrome?:{webview?:Bridge}}).chrome?.webview; }
function changed(){ window.dispatchEvent(new Event('aerovault:changed')); }
async function api(body:unknown){
 const r=await fetch('/api/packages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const d=await r.json() as Saved & {error?:string};if(!r.ok)throw new ApiError(d.error||'Could not update editing status.',r.status);return d;
}
export function useSolidWorks(ownerId:string) {
 const [assemblies,setAssemblies]=useState(false),[assemblyStatus,setAssemblyStatus]=useState('');
 const [available,setAvailable]=useState(false),[automatic,setAutomatic]=useState(false),[preparing,setPreparing]=useState(false),[syncRows,setSyncRows]=useState<SyncRow[]>([]);
 const pending=useRef(new Map<string,Pending>()), prepared=useRef(new WeakMap<File,string>()), busy=useRef(new Set<string>()), manifests=useRef(new WeakMap<File,Manifest>());
 const post=(message:Record<string,unknown>)=>bridge()?.postMessage(message);
 const fail=(id:string,message:string)=>{const p=pending.current.get(id);if(p){clearTimeout(p.timer);pending.current.delete(id);p.reject?.(new Error(message));if(!p.automatic)setPreparing(false)}};
 useEffect(()=>{
  const channel=bridge();if(!channel)return;
  let alive=true;
  const send=(m:Record<string,unknown>)=>{if(alive)channel.postMessage(m)};
  const upload=async(p:Pending,file:File)=>{
   const a=p.automatic!;p.uploading=true;clearTimeout(p.timer);
   while(alive&&busy.current.has(a.packageId))await new Promise(resolve=>setTimeout(resolve,100));
   if(!alive)return;busy.current.add(a.packageId);
   try{
    const query=new URLSearchParams({action:'upload',id:a.packageId,base:String(a.version),operation:p.id,session:a.session,filename:file.name,name:a.packageName,subsystem:a.subsystem,note:'Saved automatically from SolidWorks.'});
    const attempt=async()=>{
     const r=await fetch('/api/packages?'+query,{method:'POST',headers:{'Content-Type':'application/octet-stream',...(a.manifest?{'X-AeroVault-Manifest':encodeURIComponent(JSON.stringify(a.manifest))}:{}),...(a.rebuild?{'X-AeroVault-Rebuild':'1'}:{})},body:file,signal:AbortSignal.timeout(90000)});
     const d=await r.json() as Saved & {error?:string};if(!r.ok)throw new ApiError(d.error||'Upload pending.',r.status);return d as Saved;
    };
    let result:Saved;
    try{result=await attempt()}catch(e){
     if(!(e instanceof ApiError)||e.status!==409)throw e;
     await api({action:'editing',id:a.packageId,session:a.session,base:a.version});
     result=await attempt();
    }
    send({type:'aerovault:sync-result',requestId:p.id,success:true,version:result.version,currentVersion:result.currentVersion});
    changed();
   }catch(e){
    send({type:'aerovault:sync-result',requestId:p.id,success:false,conflict:e instanceof ApiError&&[400,403,409,413].includes(e.status),message:e instanceof Error?e.message:'Upload pending. Your local file is safe.'});
   }finally{busy.current.delete(a.packageId);pending.current.delete(p.id)}
  };
  const presence=async(rows:SyncRow[])=>{
   setSyncRows(rows);
   await Promise.all(rows.map(async row=>{
    if(busy.current.has(row.packageId))return;
    busy.current.add(row.packageId);
    try{
     if(row.open||row.pending){
      if(row.blocked)return;
      await api({action:'editing',id:row.packageId,session:row.session,base:row.version});
      send({type:'aerovault:lease-result',requestId:crypto.randomUUID(),packageId:row.packageId,session:row.session,version:row.version,success:true});
     }else await api({action:'finished',id:row.packageId,session:row.session});
    }catch(e){send({type:'aerovault:lease-result',requestId:crypto.randomUUID(),packageId:row.packageId,session:row.session,version:row.version,success:false,conflict:e instanceof ApiError&&[403,409].includes(e.status),message:e instanceof Error?e.message:'Editing status is offline.'})}
    finally{busy.current.delete(row.packageId)}
   }));
   if(alive)changed();
  };
  const receive=(event:MessageEvent)=>{
   const m=event.data;if(!m||typeof m!=='object')return;
   if(m.type==='aerovault:ready'&&(m.protocol===1||m.protocol===2)){setAvailable(true);setAutomatic(m.protocol===2);setAssemblies(m.assemblies===true);return}
   if(m.type==='aerovault:ended'&&typeof m.packageId==='string'&&typeof m.session==='string'){
    setSyncRows(rows=>rows.filter(r=>r.packageId!==m.packageId||r.session!==m.session));
    void api({action:'finished',id:m.packageId,session:m.session}).then(changed).catch(()=>{});return;
   }
   if(m.type==='aerovault:presence'&&Array.isArray(m.designs)){
    const rows=m.designs.filter((r:SyncRow)=>r&&typeof r.packageId==='string'&&typeof r.session==='string'&&Number.isInteger(r.version)&&typeof r.open==='boolean'&&typeof r.pending==='boolean');
    void presence(rows);return;
   }
   if(m.type==='aerovault:error'){
    const message=typeof m.message==='string'?m.message:'The SolidWorks action failed.';
    if(pending.current.has(m.requestId))fail(m.requestId,message);else toast.error(message);return;
   }
   if(m.type==='aerovault:file-begin'&&m.automatic===true&&!pending.current.has(m.requestId)){
    if(typeof m.requestId!=='string'||typeof m.packageId!=='string'||typeof m.session!=='string'||!Number.isInteger(m.version)||typeof m.packageName!=='string'||typeof m.subsystem!=='string')return;
    const id=m.requestId;
    pending.current.set(id,{id,transfer:new NativeTransfer(id),automatic:{packageId:m.packageId,session:m.session,version:m.version,packageName:m.packageName,subsystem:m.subsystem,manifest:m.manifest,rebuild:m.rebuild===true},timer:setTimeout(()=>fail(id,'The saved package transfer timed out.'),60000)});
   }
   const p=pending.current.get(m.requestId);if(!p||p.uploading)return;
   try{
    if(m.type==='aerovault:file-begin'&&m.manifest)p.manifest=m.manifest;
    const result=p.transfer.consume(m);if(!result)return;
    if(result.ack!==undefined)send({type:'aerovault:ack',requestId:p.id,index:result.ack});
    if(result.file){
     if(p.automatic)void upload(p,result.file);
     else{clearTimeout(p.timer);pending.current.delete(p.id);prepared.current.set(result.file,p.id);if(p.manifest)manifests.current.set(result.file,p.manifest);setPreparing(false);p.resolve?.(result.file)}
    }
   }catch(e){fail(p.id,e instanceof Error?e.message:'The file transfer failed.')}
  };
  channel.addEventListener('message',receive);
  channel.postMessage({type:'aerovault:hello',protocol:2,ownerId});
  channel.postMessage({type:'aerovault:hello',protocol:1}); // Identify older installations so the UI can explain the required update.
  return()=>{alive=false;channel.removeEventListener('message',receive);for(const p of pending.current.values()){clearTimeout(p.timer);p.reject?.(new Error('The panel closed.'))}pending.current.clear()};
 },[ownerId]);
 function packageActive(command:Record<string,unknown>={type:'aerovault:package-active'}):Promise<File>{
  if(!available||!bridge())return Promise.reject(new Error('Open Aero Vault from the SolidWorks add-in.'));
  if([...pending.current.values()].some(p=>!p.automatic))return Promise.reject(new Error('A design is already being prepared.'));
  const id=crypto.randomUUID();setPreparing(true);
  return new Promise((resolve,reject)=>{
   pending.current.set(id,{id,transfer:new NativeTransfer(id),resolve,reject,timer:setTimeout(()=>fail(id,'Preparing the design timed out.'),180000)});
   try{post({...command,requestId:id,ownerId})}catch{fail(id,'Could not contact the add-in.')}
  });
 }
 async function openRevision(pkg:PackageInfo,readOnly:boolean){
  if(!available||preparing)return;
  if(!automatic&&!readOnly){toast.error('Install Aero Vault 0.3 to use automatic saves.');return}
  const session=crypto.randomUUID();
  try{
   if(!readOnly)await api({action:'editing',id:pkg.id,base:pkg.version,session});
   post({type:'aerovault:open-revision',requestId:crypto.randomUUID(),revisionId:pkg.current_version_id,packageId:pkg.id,version:pkg.version,name:pkg.name,subsystem:pkg.subsystem,session,readOnly,ownerId});
   changed();
  }catch(e){toast.error(e instanceof Error?e.message:'Could not open this package.');changed()}
 }
 async function linkUploaded(file:File,result:Saved,name:string,subsystem:string){
  const preparedId=prepared.current.get(file);if(!automatic||!preparedId)return;
  const session=crypto.randomUUID();
  post({type:'aerovault:link-prepared',requestId:crypto.randomUUID(),preparedId,packageId:result.id,version:result.version,name,subsystem,session,ownerId});
 }
 function disconnect(row:SyncRow){post({type:'aerovault:disconnect-design',requestId:crypto.randomUUID(),packageId:row.packageId,session:row.session})}
 useEffect(()=>{
  if(!assemblies)return;
  let alive=true, running=false, active:{requestId:string;packageId:string;session:string;version:number}|null=null;
  let watchdog:ReturnType<typeof setTimeout>|undefined, heartbeat:ReturnType<typeof setInterval>|undefined;
  const channel=bridge()!;
  const release=()=>{if(watchdog)clearTimeout(watchdog);if(heartbeat)clearInterval(heartbeat);if(active)void api({action:'finished',id:active.packageId,session:active.session}).catch(()=>{});active=null;running=false;};
  const receive=(event:MessageEvent)=>{const m=event.data;if((m?.type==='aerovault:assembly-result'||m?.type==='aerovault:error')&&active&&m.requestId===active.requestId){setAssemblyStatus(m.message);if(!m.success&&active)void fetch('/api/assemblies',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({id:active.packageId,session:active.session,base:active.version,message:String(m.message).slice(0,1600)})}).finally(()=>{release();changed();});else{release();changed();}}};
  channel.addEventListener('message',receive);
  const tick=async()=>{
   if(running||!alive)return;running=true;
   try{
    const response=await fetch('/api/assemblies',{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok)return;
    const plan=await response.json() as {canCreate:boolean;components:unknown[];jobs:Array<any>};
    const job=plan.jobs.find((j:any)=>j.ready&&!j.editing&&!busy.current.has(j.packageId));
    if(!job){setAssemblyStatus(plan.jobs.some((j:any)=>j.needsUpdate)?'Updates queued. Waiting for linked subassemblies.':'Linked assemblies are up to date.');return;}
    const session=crypto.randomUUID(),requestId=crypto.randomUUID();
    await api({action:'editing',id:job.packageId,base:job.version,session});
    if(!alive){await api({action:'finished',id:job.packageId,session});return;}
    active={requestId,packageId:job.packageId,version:job.version,session};
    setAssemblyStatus('Preparing '+job.name+' with the latest linked revisions…');
    heartbeat=setInterval(()=>{if(active)void api({action:'editing',id:active.packageId,base:active.version,session:active.session}).catch(()=>{});},30000);
    watchdog=setTimeout(()=>{setAssemblyStatus('Assembly build is taking longer than expected. Check SolidWorks.');release();},600000);
    channel.postMessage({type:'aerovault:assembly-build',requestId,ownerId,packageId:job.packageId,version:job.version,revisionId:job.revisionId,name:job.name,subsystem:job.subsystem,manifest:job.manifest,dependencies:job.dependencies,session});
   }catch(e){if(alive)setAssemblyStatus(e instanceof Error?e.message:'Assembly updates are waiting for a connection.');}
   finally{if(!active)running=false;}
  };
  const timer=setInterval(()=>void tick(),30000);void tick();
  return()=>{alive=false;clearInterval(timer);release();channel.removeEventListener('message',receive);};
 },[assemblies,ownerId]);
 async function createMaster():Promise<File>{
  const response=await fetch('/api/assemblies',{cache:'no-store'});const plan=await response.json() as {canCreate:boolean;components:unknown[];jobs:Array<any>};
  if(!response.ok||!plan.canCreate)throw new Error('Add tracked assemblies to Main Assemblies and let their linked updates finish first. Only one SAEAEROMAIN can exist.');
  return packageActive({type:'aerovault:assembly-build',dependencies:plan.components});
 }
 function uploadHeaders(file:File):Record<string,string>{const m=manifests.current.get(file);return m?{'X-AeroVault-Manifest':encodeURIComponent(JSON.stringify(m))}:{};}
 return {assemblies,assemblyStatus,createMaster,uploadHeaders,available,automatic,preparing,syncRows,packageActive,openRevision,linkUploaded,disconnect};
}
