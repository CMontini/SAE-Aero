'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSolidWorks } from './native/use-solidworks';
import { Plane, Folder, Upload, Lock, Unlock, History, Users, LayoutGrid, ChevronRight, ArrowUpRight, FileBox, Download, RefreshCw, Check, Plus, ShieldCheck, Activity, Loader2, Info, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import { toast, Toaster } from 'sonner';
const MAIN_ASSEMBLIES='system-main-assemblies';
const DEFAULT_SUBSYSTEMS = ['Wings', 'Fuselage', 'Empennage', 'Propulsion', 'Landing gear'];
type Package = {
    id: string;
    name: string;
    subsystem: string;
    status: string;
    system_key?: string;
    assembly_message?: string;
    version: number;
    current_version_id: string;
    locked_by: string | null;
    locked_name: string | null;
    updated_at: string;
};
type Version = {
    id: string;
    package_id: string;
    revision: number;
    filename: string;
    size: number;
    note: string;
    author_name: string;
    created_at: string;
};
type Member = {
    id: string;
    user_id: string | null;
    email: string;
    name: string;
    role: string;
};
type Event = {
    id: string;
    package_id: string | null;
    actor: string;
    message: string;
    created_at: string;
};
type Data = {
    assemblies?: Array<{id:string;needsUpdate:boolean;linked:number}>;
    setup?: boolean;
    join?: boolean;
    denied?: boolean;
    member?: Member;
    packages?: Package[];
    versions?: Version[];
    activity?: Event[];
    members?: Member[];
    subsystems?: { labels: Record<string, string>; revision: number };
};
const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const date = (s: string) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function Choice({ value, onChange, options, labels = {}, disabled = false }: {
    value: string;
    onChange: (v: string) => void;
    options: string[];
    labels?: Record<string, string>;
    disabled?: boolean;
}) { return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger className="w-full h-11 bg-white"><SelectValue /></SelectTrigger><SelectContent>{options.map(x => <SelectItem key={x} value={x}>{labels[x] || x}</SelectItem>)}</SelectContent></Select>; }
export default function Workspace({ user }: {
    user: {
        id: string;
        name: string;
        email: string;
    };
}) {
    const native = useSolidWorks(user.id);
    const [data, setData] = useState<Data | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [view, setView] = useState('Design files'), [folder, setFolder] = useState('All subsystems'), [selected, setSelected] = useState<string | null>(null), [upload, setUpload] = useState<Package | 'new' | null>(null), [invite, setInvite] = useState(false);
    const [name, setName] = useState(''), [subsystem, setSubsystem] = useState('Wings'), [note, setNote] = useState(''), [file, setFile] = useState<File | null>(null), [progress, setProgress] = useState(0), [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState('');
    const [inviteName, setInviteName] = useState(''), [email, setEmail] = useState(''), [role, setRole] = useState('editor');
    const [rename, setRename] = useState<{kind:'folder'|'package'|'new-folder';id:string;previousName:string;revision:number} | null>(null);
    const [renameName, setRenameName] = useState(''), [renameError, setRenameError] = useState(''), [renaming, setRenaming] = useState(false);
    const labels = data?.subsystems?.labels || {};
    const subsystemIds = data?.subsystems ? Object.keys(labels) : DEFAULT_SUBSYSTEMS;
    const folderLabel = (id: string) => labels[id] || id;
    function startRename(kind: 'folder'|'package'|'new-folder', id: string, name: string) {
        setRename({kind,id,previousName:name,revision:data?.subsystems?.revision || 0});
        setRenameName(name); setRenameError('');
    }
    async function saveRename(e: React.FormEvent) {
        e.preventDefault(); if (!rename || renaming) return;
        setRenaming(true); setRenameError('');
        try {
            const response = await fetch(rename.kind !== 'package' ? '/api/subsystems' : '/api/packages', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({action:rename.kind === 'new-folder' ? 'create' : 'rename',id:rename.id,name:renameName,previousName:rename.previousName,revision:rename.revision})
            });
            const result = await response.json() as {error?:string;id?:string};
            if (!response.ok) throw new Error(result.error || 'Could not save the name.');
            setRename(null); await refresh();
            if (rename.kind === 'new-folder' && result.id) { setFolder(result.id); setView('Design files'); }
            toast.success(rename.kind === 'new-folder' ? 'Subsystem folder created' : rename.kind === 'folder' ? 'Folder renamed' : 'Package renamed');
        } catch(e) { setRenameError(e instanceof Error ? e.message : 'Could not save the name.'); await refresh(); }
        finally { setRenaming(false); }
    }
    const refresh = useCallback(async () => { try {
        const r = await fetch('/api/workspace', { cache: 'no-store' }), d = await r.json() as Data & {
            error?: string;
        };
        if (!r.ok)
            throw new Error(d.error);
        setData(d);
        setError('');
        return d;
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the workspace.');
        return null;
    } }, []);
    useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 10000); const onSync = () => void refresh(); window.addEventListener('aerovault:changed', onSync); return () => { clearInterval(timer); window.removeEventListener('aerovault:changed', onSync); }; }, [refresh]);
    const act = async (path: string, body: unknown, message: string) => { setBusy(true); try {
        const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), d = await r.json() as Data & {
            error?: string;
        };
        if (!r.ok)
            throw new Error(d.error);
        await refresh();
        toast.success(message);
        return true;
    }
    catch (e) {
        toast.error(e instanceof Error ? e.message : 'Please try again.');
        await refresh();
        return false;
    }
    finally {
        setBusy(false);
    } };
    const packages = data?.packages || [], versions = data?.versions || [], events = data?.activity || [], members = data?.members || [];
    const current = packages.find(p => p.id === selected), isAdmin = data?.member?.role === 'admin', canEdit = !!data?.member && data.member.role !== 'viewer';
    const filtered = packages.filter(p => (folder === 'All subsystems' || p.subsystem === folder) && (view !== 'Editing now' || !!p.locked_by));
    const startUpload = (p: Package | 'new') => { setUpload(p); setName(p === 'new' ? '' : p.name); setSubsystem(p === 'new' ? (subsystemIds.includes(folder) ? folder : 'Wings') : p.subsystem); setNote(''); setFile(null); setProgress(0); setUploadError(''); };
    useEffect(() => { const context = (document as any).modelContext; if (!context?.registerTool)
        return; const lifecycle = new AbortController(); try {
        Promise.resolve(context.registerTool({ name: 'view_aero_subsystem', title: 'View subsystem', description: 'Select a subsystem in the CAD workspace. Does not change files.', inputSchema: { type: 'object', properties: { subsystem: { type: 'string', enum: ['All subsystems', ...subsystemIds.map(folderLabel)] } }, required: ['subsystem'], additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async (input: any) => { const id = input?.subsystem === 'All subsystems' ? 'All subsystems' : subsystemIds.find(id => folderLabel(id) === input?.subsystem); if (!id)
                throw new Error('Unknown subsystem'); setFolder(id); setView('Design files'); return { subsystem: input.subsystem }; } }, { signal: lifecycle.signal })).catch(() => { });
    }
    catch { } return () => lifecycle.abort(); }, [data?.subsystems?.revision]);
    async function sendUpload(e: React.FormEvent) { e.preventDefault(); if (!file || !upload)
        return; if (file.size === 0 || file.size > 50 * 1024 * 1024) {
        setUploadError('Choose a file between 1 byte and 50 MB.');
        return;
    } setUploading(true); setUploadError(''); const query = new URLSearchParams({ action: 'upload', filename: file.name, name, subsystem, note }); if (upload !== 'new') {
        query.set('id', upload.id);
        query.set('base', String(upload.version));
    } try {
        const saved = await new Promise<{id:string;version:number;revisionId:string;currentVersion:number}>((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/packages?' + query); xhr.setRequestHeader('Content-Type', 'application/octet-stream'); for(const [key,value] of Object.entries(native.uploadHeaders(file)))xhr.setRequestHeader(key,value); xhr.timeout = 300000; xhr.upload.onprogress = e => { if (e.lengthComputable)
            setProgress(Math.round(e.loaded / e.total * 100)); }; xhr.onerror = () => reject(new Error('The connection was interrupted. Your selected file is still here; try again.')); xhr.ontimeout = () => reject(new Error('The upload timed out. Please try again.')); xhr.onload = () => { let d; try {
            d = JSON.parse(xhr.responseText);
        }
        catch {
            reject(new Error('The upload could not be confirmed. Refresh before retrying.'));
            return;
        } if (xhr.status >= 200 && xhr.status < 300) {
            setSelected(d.id);
            resolve(d);
        }
        else
            reject(new Error(d.error || 'Upload failed.')); }; xhr.send(file); });
        await native.linkUploaded(file, saved, name, subsystem);
        setUpload(null);
        await refresh();
        toast.success('Revision saved');
    }
    catch (e) {
        setUploadError(e instanceof Error ? e.message : 'Upload failed.');
    }
    finally {
        setUploading(false);
    } }
    function EventList({ items }: {
        items: Event[];
    }) { return items.length ? <div className="divide-y">{items.map(e => <div className="py-4 flex gap-3" key={e.id}><span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700"><Activity size={15}/></span><div className="min-w-0"><p className="text-sm leading-6"><strong>{e.actor}</strong> {e.message}</p><p className="text-xs quiet mt-1">{date(e.created_at)}</p></div></div>)}</div> : <div className="py-8 text-sm quiet">Team updates will appear here when you start working.</div>; }
    return <SidebarProvider className={native.available ? "native-workspace" : ""}><Toaster richColors position="bottom-right"/><Sidebar className="border-0"><SidebarHeader className="px-6 pt-8 pb-7"><div className="flex items-center gap-3"><div className="size-10 rounded-xl bg-blue-500 flex items-center justify-center"><Plane size={23}/></div><div><span className="text-xl tracking-tight font-bold">Aero Vault</span><p className="text-xs text-slate-400 mt-1">SAE AERO · TEAM WORKSPACE</p></div></div></SidebarHeader><SidebarContent><SidebarGroup className="px-4"><SidebarGroupLabel>WORKSPACE</SidebarGroupLabel><SidebarMenu>{[['Design files', LayoutGrid], ['Editing now', Lock], ['Activity', History], ['Team', Users]].map(([label, Icon]) => <SidebarMenuItem key={String(label)}><SidebarMenuButton className="h-11 px-3 text-sm" isActive={view === label} onClick={() => { setView(String(label)); setFolder('All subsystems'); }}><Icon /><span>{String(label)}</span>{label === 'Editing now' && packages.some(p => p.locked_by) && <span className="ml-auto text-xs">{packages.filter(p => p.locked_by).length}</span>}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup><SidebarGroup className="px-4 mt-5"><SidebarGroupLabel>SUBSYSTEMS</SidebarGroupLabel><SidebarMenu>{subsystemIds.map(s => <SidebarMenuItem key={s}><SidebarMenuButton className="h-10 px-3 text-slate-300" isActive={folder === s} onClick={() => { setFolder(s); setView('Design files'); }}><Folder /><span className="truncate" title={folderLabel(s)}>{folderLabel(s)}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup></SidebarContent><SidebarFooter className="p-5 gap-5"><div className="rounded-lg border border-slate-600/50 p-3 text-sm text-slate-300"><div className="flex items-center gap-2 text-white mb-1"><ShieldCheck size={16}/>Team access</div><p className="text-xs leading-5">{members.length} of 9 places assigned</p></div><div className="flex gap-3 items-center"><div className="size-9 shrink-0 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold">{user.name.slice(0, 2).toUpperCase()}</div><div className="min-w-0"><div className="text-sm truncate">{user.name}</div><div className="text-xs text-slate-400 capitalize">{data?.member?.role || 'Workspace owner'}</div></div></div></SidebarFooter></Sidebar>
 <SidebarInset><header className="h-20 border-b bg-white px-5 lg:px-9 flex items-center justify-between gap-3"><div className="flex items-center gap-3 text-sm"><SidebarTrigger className="md:hidden"/><span className="quiet hidden sm:inline">SAE Aero</span><ChevronRight size={14} className="text-slate-400 hidden sm:block"/><span className="font-semibold">Aircraft workspace</span></div><div className="flex items-center gap-4"><span className="text-xs quiet hidden sm:flex items-center gap-1.5"><Lock size={13}/>Private workspace</span><Button variant="ghost" size="icon" aria-label="Refresh workspace" disabled={busy} onClick={() => void refresh()}><RefreshCw size={17}/></Button></div></header>
 <div className="p-5 lg:p-9 max-w-[1600px] w-full mx-auto">{native.available && <nav aria-label="Workspace navigation" className="grid gap-3 mb-5"><label className="field">Workspace view<Choice value={view} onChange={v => { setView(v); setFolder('All subsystems'); }} options={['Design files', 'Editing now', 'Activity', 'Team']}/></label>{view === 'Design files' && <label className="field">Subsystem<Choice value={folder} onChange={setFolder} options={['All subsystems', ...subsystemIds]} labels={labels}/></label>}</nav>}<div className="flex flex-wrap justify-between gap-4 items-start mb-7"><div><p className="kicker mb-2">AIRCRAFT DEVELOPMENT</p><h1 className="text-3xl font-semibold tracking-tight">{folder === 'All subsystems' ? view : folderLabel(folder)}</h1><p className="quiet text-sm mt-2">{view === 'Team' ? 'Manage the people who can access your designs.' : view === 'Activity' ? 'A shared record of your team’s design changes.' : view === 'Editing now' ? 'See who has each design open for editing.' : 'One place for your team’s latest designs.'}</p></div>{view === 'Team' ? <Button className="h-11 px-5" disabled={!isAdmin || members.length >= 9} onClick={() => setInvite(true)}><Plus size={17}/>Add teammate</Button> : view !== 'Activity' && <Button className="h-11 px-5" disabled={!canEdit} onClick={() => startUpload('new')}><Upload size={17}/>Upload package</Button>}</div>
 {isAdmin && view === 'Design files' && <div className="flex flex-wrap gap-2 mb-5"><Button variant="outline" onClick={() => startRename('new-folder', '', '')}><Plus size={16}/>Add subsystem folder</Button><Button variant="outline" onClick={() => { const id = subsystemIds.includes(folder) && folder !== MAIN_ASSEMBLIES ? folder : 'Wings'; startRename('folder', id, folderLabel(id)); }}><Pencil size={16}/>Rename folders</Button></div>}
 {view === 'Design files' && folder === MAIN_ASSEMBLIES && <section className="panel p-5 mb-5 space-y-3"><h2 className="font-semibold">Aircraft master assembly</h2><p className="quiet text-sm">Add saved subassemblies with “Use active SolidWorks design”. Pack and Go includes their parts. Create SAEAEROMAIN once, then position and mate the subassemblies in SolidWorks. Future revisions preserve its existing components and mates.</p><p className="quiet text-sm">To link an individual part, upload it first and insert that exact local file into its assembly. Unlinked files stay embedded in the ZIP. Use unique CAD filenames. Save and close your designs while leaving SolidWorks and Aero Vault open to process queued rebuilds.</p>{native.assemblies ? <p className="text-sm" aria-live="polite">{native.assemblyStatus}</p> : <p className="text-sm">Install Aero Vault 0.4 to create the master and process linked revisions.</p>}{canEdit && !packages.some(p=>p.system_key==='master') && <Button disabled={!native.assemblies||native.preparing} onClick={async()=>{startUpload('new');setName('SAEAEROMAIN');setSubsystem(MAIN_ASSEMBLIES);setNote('Initial aircraft master. Position and mates require review.');try{setFile(await native.createMaster());}catch(e){setUploadError(e instanceof Error?e.message:'Could not create the master.');}}}>Create SAEAEROMAIN</Button>}</section>}
 {native.available && !native.automatic && <div className="panel p-4 mb-5 text-sm">Install Aero Vault 0.3 in Windows to enable automatic saves and editing status.</div>}
 {native.automatic && native.syncRows.some(r => r.open || r.pending || r.blocked) && <section className="panel p-4 mb-5" aria-label="SolidWorks sync status" aria-live="polite"><h2 className="font-semibold text-sm mb-2">SolidWorks sync</h2>{native.syncRows.filter(r => r.open || r.pending || r.blocked).map(r => <div key={r.packageId} className="py-2 text-sm"><strong>{packages.find(p => p.id === r.packageId)?.name || r.name}</strong><p className={r.blocked ? 'text-amber-800 mt-1' : 'quiet mt-1'}>{r.message}</p>{r.blocked && <Button variant="outline" size="sm" className="mt-2" onClick={() => native.disconnect(r)}>Disconnect local copy</Button>}</div>)}</section>}
 {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 mb-5">{error} <button className="underline ml-2" onClick={() => void refresh()}>Retry</button></div>}
 {!data && !error ? <div className="space-y-4"><Skeleton className="h-24 w-full"/><Skeleton className="h-80 w-full"/></div> : data?.denied ? <div className="panel p-8"><h2 className="font-semibold text-xl">This workspace is invite-only</h2><p className="quiet mt-2">Ask your team administrator to add {user.email}.</p></div> : <>
 {(data?.setup || data?.join) && <div className="panel p-6 mb-6 border-blue-200 flex flex-wrap gap-5 items-center justify-between"><div><h2 className="font-semibold">{data.setup ? 'Your team starts here' : 'Your team workspace is ready'}</h2><p className="quiet text-sm mt-2">{data.setup ? 'Create your workspace to start uploading designs. You’ll be the administrator.' : 'Your account is on the team access list. Join to open the shared designs.'}</p></div><Button disabled={busy} onClick={() => void act('/api/workspace', { action: data.setup ? 'setup' : 'join' }, data.setup ? 'Workspace created' : 'Welcome to the team')}>{busy ? <Loader2 className="animate-spin"/> : <Plus size={16}/>} {data.setup ? 'Create workspace' : 'Join workspace'}</Button></div>}
 {(view === 'Design files' || view === 'Editing now') && <><div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">{([['Design packages', packages.length, FileBox], ['Editing now', packages.filter(p => p.locked_by).length, Lock], ['Ready for review', packages.filter(p => p.status === 'Ready for review').length, Check], ['Stored revisions', versions.length, History]] as const).map(([label, n, Icon]) => <div className="panel p-4 sm:p-5" key={String(label)}><div className="flex justify-between items-center quiet"><span className="text-sm">{String(label)}</span><Icon size={17} className="text-blue-600"/></div><p className="text-3xl mt-3 tracking-tight font-semibold mono">{String(n).padStart(2, '0')}</p></div>)}</div>
 {view === 'Design files' && folder === 'All subsystems' && <div className="mb-7"><h2 className="text-sm font-semibold mb-3">Subsystems</h2><div className="grid grid-cols-2 xl:grid-cols-5 gap-3">{subsystemIds.map((s, i) => <button key={s} className="panel text-left p-4 hover:border-blue-400 transition-colors group" onClick={() => setFolder(s)}><div className="flex justify-between items-center mb-5"><Folder size={23} className="text-blue-600"/><span className="mono text-xs text-slate-400">0{i + 1}</span></div><p className="font-semibold text-sm break-words">{folderLabel(s)}</p><p className="quiet text-xs mt-1.5">{packages.filter(p => p.subsystem === s).length} packages</p></button>)}</div></div>}
 <div className="grid xl:grid-cols-[minmax(0,1fr)_280px] gap-6"><section className="panel overflow-hidden min-w-0"><div className="p-5 border-b flex justify-between items-center"><h2 className="font-semibold text-base">{view === 'Editing now' ? 'Active editors' : 'Design packages'}</h2><span className="text-xs quiet">{filtered.length} total</span></div>{filtered.length ? <Table><TableHeader><TableRow><TableHead className="pl-5">Package</TableHead><TableHead>Revision</TableHead><TableHead>Status</TableHead><TableHead>Editing</TableHead></TableRow></TableHeader><TableBody>{filtered.map(p => <TableRow key={p.id}><TableCell className="pl-5"><button className="text-left py-2" onClick={() => setSelected(p.id)}><p className="font-semibold text-blue-700">{p.name}</p><p className="quiet text-xs mt-1">{folderLabel(p.subsystem)}</p></button></TableCell><TableCell className="mono text-sm">R{String(p.version).padStart(2, '0')}</TableCell><TableCell><span className={`text-xs px-2 py-1 rounded-md ${p.status === 'Approved' ? 'bg-emerald-50 text-emerald-800' : p.status === 'Ready for review' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{p.status}</span></TableCell><TableCell className="text-xs quiet">{p.locked_by ? p.locked_by === user.id ? 'You' : p.locked_name : 'No active editor'}</TableCell></TableRow>)}</TableBody></Table> : <Empty className="py-14"><EmptyHeader><EmptyMedia variant="icon" className="size-14 rounded-2xl bg-blue-50 text-blue-600"><FileBox size={27}/></EmptyMedia><EmptyTitle>{view === 'Editing now' ? 'No active editors' : 'Ready for your first design'}</EmptyTitle><EmptyDescription className="max-w-sm">{view === 'Editing now' ? 'Designs open for editing will appear here.' : 'Upload a SolidWorks Pack and Go ZIP to keep your assembly and its linked parts together.'}</EmptyDescription></EmptyHeader>{view === 'Design files' && <Button variant="outline" disabled={!canEdit} onClick={() => startUpload('new')}><Plus size={16}/>Upload first package</Button>}<p className="text-xs quiet">ZIP, SLDPRT, SLDASM, SLDDRW · up to 50 MB</p></Empty>}</section>
 <aside className="space-y-5"><div className="panel p-5"><div className="flex items-center gap-2 font-semibold text-sm mb-4"><Info size={16} className="text-blue-600"/>Working with CAD</div>{[['01', 'Link your design once', 'Upload the active SolidWorks design and choose a subsystem.'], ['02', 'Open and edit', 'Open for editing from the panel. Your teammates see your name automatically.'], ['03', 'Save to update', 'Save in SolidWorks and keep it open until Aero Vault confirms the revision.']].map(([n, title, desc]) => <div className="flex gap-3 mt-5" key={n}><span className="mono text-xs text-blue-600 mt-1">{n}</span><div><p className="text-sm font-semibold">{title}</p><p className="text-xs leading-5 quiet mt-1">{desc}</p></div></div>)}</div><div className="px-1"><h2 className="font-semibold text-sm">Recent activity</h2><EventList items={events.slice(0, 3)}/>{events.length > 3 && <button className="text-sm text-blue-700" onClick={() => setView('Activity')}>View all activity <ArrowUpRight className="inline" size={14}/></button>}</div></aside></div></>}
 {view === 'Activity' && <section className="panel p-6 max-w-4xl"><EventList items={events}/></section>}
 {view === 'Team' && <section className="panel overflow-hidden"><div className="p-5 border-b"><h2 className="font-semibold">Team access <span className="quiet font-normal">· {members.length} / 9</span></h2><p className="text-sm quiet mt-2">Add the email each teammate uses to sign in with ChatGPT. No email is sent automatically.</p><p className="text-sm quiet mt-2">The prototype is private to its owner. Teammates also need access through the site’s sharing settings.</p></div><Table><TableHeader><TableRow><TableHead className="pl-5">Teammate</TableHead><TableHead>Role</TableHead><TableHead>Membership</TableHead></TableRow></TableHeader><TableBody>{members.map(m => <TableRow key={m.id}><TableCell className="pl-5 py-5"><p className="font-semibold">{m.name}</p><p className="quiet text-xs mt-1">{m.email}</p></TableCell><TableCell className="capitalize">{m.role}</TableCell><TableCell className="text-sm quiet">{m.user_id ? 'Joined' : 'Awaiting first sign-in'}</TableCell></TableRow>)}</TableBody></Table></section>}
 </>}
 <footer className="mt-8 text-xs quiet flex flex-wrap justify-between gap-3"><span>AERO VAULT <span className="mx-2 text-slate-300">/</span> SAE Aero</span><span>{native.available ? "Automatic saves · Revision history · Live editing status" : "Revision uploads · Revision history · Live editing status"}</span></footer></div></SidebarInset>
 <Dialog open={!!upload} onOpenChange={o => { if (!o && !uploading && !native.preparing)
        setUpload(null); }}><DialogContent showCloseButton={!uploading && !native.preparing}><DialogHeader><DialogTitle>{upload === 'new' ? 'Upload a design package' : 'Upload a new revision'}</DialogTitle><DialogDescription>{upload === 'new' ? 'Keep linked parts together with a Pack and Go ZIP.' : 'Previous revisions stay available. Designs linked in SolidWorks upload automatically when saved.'}</DialogDescription></DialogHeader><form onSubmit={sendUpload} className="space-y-4"><label className="field">Package name<input required maxLength={100} value={name} disabled={upload !== 'new' || uploading} onChange={e => setName(e.target.value)} placeholder="e.g. Main wing assembly"/></label><label className="field">Subsystem<Choice value={subsystem} onChange={setSubsystem} options={subsystemIds} labels={labels} disabled={upload !== 'new' || uploading}/></label>{native.available && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4"><Button type="button" variant="outline" className="w-full" disabled={uploading || native.preparing} onClick={async () => { setUploadError(''); try { const prepared = await native.packageActive(); setFile(prepared); if (!name.trim()) setName(prepared.name.replace(/\.zip$/i, '')); } catch (e) { setUploadError(e instanceof Error ? e.message : 'Could not prepare the active design.'); } }}>{native.preparing ? <Loader2 size={16} className="animate-spin"/> : <FileBox size={16}/>} {native.preparing ? 'Preparing active design…' : 'Use active SolidWorks design'}</Button><p className="text-xs quiet mt-2">Save your design and linked parts first. Upload once to enable automatic updates on future saves.</p></div>}<label className="field">Design file<input type="file" required={!file} accept=".zip,.sldprt,.sldasm,.slddrw" disabled={uploading || native.preparing} onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm"/><span className="text-sm font-normal">{file ? `Selected: ${file.name} · ${bytes(file.size)}` : native.available ? "Choose a file or prepare the active design." : "Choose your design file."}</span><span className="text-xs quiet font-normal">Up to 50 MB. Individual assembly files do not include their linked parts.</span></label><label className="field">Change notes<textarea required maxLength={2000} value={note} disabled={uploading} onChange={e => setNote(e.target.value)} rows={3} placeholder="What is included or what changed?"/></label>{uploadError && <p role="alert" className="text-sm text-red-700">{uploadError}</p>}{uploading && <div aria-live="polite"><Progress value={progress}/><p className="text-xs quiet mt-2">{progress === 100 ? 'Saving your revision…' : `Uploading · ${progress}%`}</p></div>}<Button type="submit" className="w-full h-11" disabled={uploading || native.preparing || !file}>{uploading ? <Loader2 className="animate-spin" size={16}/> : <Upload size={16}/>} {uploading ? 'Saving…' : upload === 'new' ? 'Upload package' : 'Save revision'}</Button></form></DialogContent></Dialog>
 <Sheet open={!!current} onOpenChange={o => { if (!o)
        setSelected(null); }}><SheetContent className="sm:max-w-xl overflow-y-auto p-0">{current && <><SheetHeader className="p-6 border-b"><p className="kicker mb-2">{folderLabel(current.subsystem)}</p><SheetTitle className="text-2xl break-words">{current.name}</SheetTitle><SheetDescription>Revision {current.version} · Updated {date(current.updated_at)}</SheetDescription></SheetHeader><div className="p-6 space-y-7">{data?.assemblies?.find(a=>a.id===current.id) && <div className="rounded-lg border p-4 text-sm"><strong>{data.assemblies.find(a=>a.id===current.id)?.needsUpdate ? 'Linked revisions pending' : 'Linked revisions current'}</strong><p className="quiet mt-2">{data.assemblies.find(a=>a.id===current.id)?.linked} tracked packages. Embedded files without a package link do not follow separate uploads.</p>{current.assembly_message && <p className="text-amber-800 mt-2">{current.assembly_message}</p>}</div>}<div className="rounded-lg bg-slate-50 border p-4"><p className="text-sm font-semibold flex items-center gap-2"><Users size={16}/> {current.locked_by ? `Editing by ${current.locked_by === user.id ? 'you' : current.locked_name}` : 'No one is editing'}</p><p className="text-sm quiet mt-2">Open for editing to show your name automatically. Save in SolidWorks to update the cloud revision. Others can open a read-only copy.</p></div><div className="flex flex-wrap gap-2">{canEdit && !current.system_key && <Button variant="outline" disabled={busy} onClick={() => startRename('package', current.id, current.name)}><Pencil size={16}/>Rename</Button>}{native.available && <><Button disabled={busy || native.preparing || !canEdit || !native.automatic || !!current.locked_by} onClick={() => void native.openRevision(current, false)}>Open for editing</Button><Button variant="outline" disabled={native.preparing} onClick={() => void native.openRevision(current, true)}>Open read-only</Button></>}<Button asChild variant="outline"><a href={'/api/download?id=' + current.current_version_id}><Download size={16}/>Download latest</a></Button>{canEdit && !current.locked_by && <Button variant="ghost" disabled={busy} onClick={() => startUpload(current)}><Upload size={16}/>Upload revision</Button>}</div><div className="field">Design status<Choice value={current.status} onChange={status => void act('/api/packages', { id: current.id, action: 'status', status, base: current.version }, 'Status updated')} options={isAdmin ? ['In progress', 'Ready for review', 'Approved'] : current.status === 'Approved' ? ['Approved'] : ['In progress', 'Ready for review']} disabled={!canEdit || !!current.locked_by || busy || (!isAdmin && current.status === 'Approved')}/></div><section><h3 className="font-semibold mb-4 flex gap-2 items-center"><History size={17}/>Revision history</h3><div className="space-y-3">{versions.filter(v => v.package_id === current.id).map(v => <div key={v.id} className="rounded-lg border p-4"><div className="flex justify-between gap-3"><span className="text-sm font-semibold">Revision {v.revision}{v.revision === current.version && <span className="ml-2 text-xs text-blue-600">Latest</span>}</span><a className="text-blue-700 text-sm flex items-center gap-1" href={'/api/download?id=' + v.id}><Download size={14}/>Download</a></div><p className="text-sm leading-6 mt-3 whitespace-pre-wrap break-words">{v.note}</p><p className="text-xs quiet mt-3 break-all">{v.filename} · {bytes(v.size)}</p><p className="text-xs quiet mt-1">{v.author_name} · {date(v.created_at)}</p></div>)}</div></section></div></>}</SheetContent></Sheet>
 <Dialog open={invite} onOpenChange={setInvite}><DialogContent><DialogHeader><DialogTitle>Add a teammate</DialogTitle><DialogDescription>Grant access to a specific ChatGPT sign-in email. No invitation email will be sent.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (await act('/api/members', { name: inviteName, email, role }, 'Teammate added')) {
        setInvite(false);
        setInviteName('');
        setEmail('');
    } }}><label className="field">Name<input required maxLength={100} value={inviteName} onChange={e => setInviteName(e.target.value)}/></label><label className="field">Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)}/></label><label className="field">Role<Choice value={role} onChange={setRole} options={['editor', 'viewer']}/></label><p className="text-sm quiet">Editors can edit designs and upload revisions. Viewers can browse and download.</p><Button type="submit" disabled={busy} className="w-full">Add to team access list</Button></form></DialogContent></Dialog>
 <Dialog open={!!rename} onOpenChange={open => { if (!open && !renaming) setRename(null); }}><DialogContent showCloseButton={!renaming}><DialogHeader><DialogTitle>{rename?.kind === 'new-folder' ? 'Add subsystem folder' : rename?.kind === 'folder' ? 'Rename subsystem folder' : 'Rename design package'}</DialogTitle><DialogDescription>{rename?.kind === 'new-folder' ? 'Create a shared folder for your team’s design packages.' : rename?.kind === 'folder' ? 'This name is shared across your team. Existing packages stay in this folder.' : 'Change the name shown in Aero Vault. SolidWorks filenames, assembly references, and revision history stay the same.'}</DialogDescription></DialogHeader><form onSubmit={saveRename} className="space-y-4">
 {rename?.kind === 'folder' && <label className="field">Folder<Choice value={rename.id} options={subsystemIds.filter(id=>id!==MAIN_ASSEMBLIES)} labels={labels} disabled={renaming} onChange={id => { setRename({...rename,id}); setRenameName(folderLabel(id)); setRenameError(''); }}/></label>}
 <label className="field">{rename?.kind === 'new-folder' ? 'Folder name' : 'New name'}<input autoFocus required maxLength={rename?.kind === 'package' ? 100 : 60} value={renameName} disabled={renaming} onChange={e => setRenameName(e.target.value)}/></label>
 {renameError && <p role="alert" className="text-sm text-red-700">{renameError}</p>}
 <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={renaming} onClick={() => setRename(null)}>Cancel</Button><Button type="submit" disabled={renaming || !renameName.trim()}>{renaming ? 'Saving…' : rename?.kind === 'new-folder' ? 'Create folder' : 'Save name'}</Button></div>
 </form></DialogContent></Dialog>
 </SidebarProvider>;
}
