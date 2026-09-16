'use client';
import {useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {NativeTransfer} from '@/lib/native-transfer';
type Bridge = { postMessage:(data:unknown)=>void; addEventListener:(type:string,listener:(event:MessageEvent)=>void)=>void; removeEventListener:(type:string,listener:(event:MessageEvent)=>void)=>void };
type Pending = {id:string;transfer:NativeTransfer;resolve:(file:File)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
function getBridge():Bridge|undefined { return (window as unknown as {chrome?:{webview?:Bridge}}).chrome?.webview; }
export function useSolidWorks() {
 const [available,setAvailable]=useState(false),[preparing,setPreparing]=useState(false);
 const pending=useRef<Pending|null>(null);
 const fail=(message:string)=>{const p=pending.current;if(p){clearTimeout(p.timer);pending.current=null;p.reject(new Error(message));setPreparing(false)}};
 useEffect(()=>{
  const bridge=getBridge();if(!bridge)return;
  const receive=(event:MessageEvent)=>{
   const m=event.data;if(!m||typeof m!=='object')return;
   if(m.type==='aerovault:ready'&&m.protocol===1){setAvailable(true);return}
   if(m.type==='aerovault:error'){
    const message=typeof m.message==='string'?m.message:'The SolidWorks action failed.';
    if(pending.current&&m.requestId===pending.current.id)fail(message);else toast.error(message);
    return;
   }
   const p=pending.current;if(!p)return;
   try { const result=p.transfer.consume(m);if(!result)return;
    if(result.ack!==undefined)bridge.postMessage({type:'aerovault:ack',requestId:p.id,index:result.ack});
    if(result.file){clearTimeout(p.timer);pending.current=null;setPreparing(false);p.resolve(result.file)}
   } catch(e){fail(e instanceof Error?e.message:'The file transfer failed.')}
  };
  bridge.addEventListener('message',receive);
  bridge.postMessage({type:'aerovault:hello',protocol:1});
  return()=>{bridge.removeEventListener('message',receive);const p=pending.current;if(p){clearTimeout(p.timer);pending.current=null;p.reject(new Error('The panel was closed.'))}};
 },[]);
 function packageActive():Promise<File>{
  const bridge=getBridge();if(!available||!bridge)return Promise.reject(new Error('Open Aero Vault from the SolidWorks add-in.'));
  if(pending.current)return Promise.reject(new Error('A design is already being prepared.'));
  const id=crypto.randomUUID();setPreparing(true);
  return new Promise((resolve,reject)=>{
   pending.current={id,transfer:new NativeTransfer(id),resolve,reject,timer:setTimeout(()=>fail('Preparing the design timed out. Check SolidWorks and try again.'),180000)};
   try { bridge.postMessage({type:'aerovault:package-active',requestId:id}); }
   catch { fail('Could not contact the SolidWorks add-in. Reload the panel and try again.'); }
  });
 }
 function openRevision(id:string,readOnly:boolean){
  if(!available||preparing)return;
  getBridge()?.postMessage({type:'aerovault:open-revision',requestId:crypto.randomUUID(),revisionId:id,readOnly});
 }
 return {available,preparing,packageActive,openRevision};
}
