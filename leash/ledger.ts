import { mkdir, open, readFile, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaymentRequest, Policy } from './policy.js';
import type { ReportInput, Report } from './provider.js';
import type { ChainReceipt } from './live.js';
export interface AgentRecord { key: string; publicKey: string; name: string; ownerAccountId: string; walletId: string; credentialFile: string; createdAt: number; registered: boolean; policy: Policy; registrationHash?: string; tokenHash: string; }
export interface Operation { id:string; ownerAccountId:string; walletId:string; agentKey:string; request:PaymentRequest; input:ReportInput; status:'queued'|'signed'|'unknown'|'pending'|'succeeded'|'failed'|'denied'; createdAt:number; updatedAt:number; transactionHash?:string; signedBytes?:string; receipt?:ChainReceipt; report?:Report; code?:string; message?:string; }
export interface OwnerOperation { id:string; ownerAccountId:string; method:string; args:Record<string,unknown>; createdAt:number; transactionHash?:string; confirmed?:boolean; }
export interface Event { id:string; at:number; type:string; ownerAccountId?:string; agentKey?:string; operationId?:string; transactionHash?:string; message:string; }
export interface Data { version:2; agents:Record<string,AgentRecord>; operations:Record<string,Operation>; ownerOperations:Record<string,OwnerOperation>; events:Event[]; }
export class Ledger {
  private lock?: FileHandle; private value!:Data; private tail:Promise<unknown>=Promise.resolve();private failed=false;
  constructor(readonly path:string) {}
  async init():Promise<void> {
    await mkdir(dirname(this.path),{recursive:true,mode:0o700});this.lock=await open(`${this.path}.lock`,'wx',0o600);await this.lock.writeFile(`${process.pid}\n`);
    try{try{this.value=JSON.parse(await readFile(this.path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;this.value={version:2,agents:{},operations:{},ownerOperations:{},events:[]};await this.persist(this.value);}if(this.value.version!==2)throw new Error('Unsupported live ledger.');}catch(e){await this.close();throw e;}
  }
  read():Data{return structuredClone(this.value);}
  async persist(d:Data):Promise<void> {const temp=`${this.path}.${randomUUID()}.tmp`;const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(d));await f.sync();}finally{await f.close();}try{await rename(temp,this.path);}catch(e){await unlink(temp).catch(()=>{});throw e;}const dir=await open(dirname(this.path),'r');try{await dir.sync();}finally{await dir.close();}}
  write<T>(fn:(d:Data)=>T):Promise<T>{const run=async()=>{if(this.failed)throw new Error('Ledger write failed. Restart and reconcile before continuing.');const d=this.read();const result=fn(d);try{await this.persist(d);}catch(e){this.failed=true;throw e;}this.value=d;return structuredClone(result);};const p=this.tail.then(run,run);this.tail=p.catch(()=>{});return p;}
  async close():Promise<void>{await this.tail;if(this.lock){await this.lock.close();this.lock=undefined;await unlink(`${this.path}.lock`);}}
}
export function event(d:Data,type:string,message:string,extra:Partial<Event>={}):void{if(d.events.length>=5000)throw new Error('Audit capacity reached. Archive and stop new operations.');d.events.push({id:randomUUID(),at:Date.now(),type,message,...extra});}
export function publicOperation(o:Operation,revealReport=false){const{signedBytes,input,report,...view}=o;return revealReport?{...view,report}:view;}

export function publicAgent(a:AgentRecord){return {key:a.key,publicKey:a.publicKey,name:a.name,createdAt:a.createdAt,registered:a.registered,registrationHash:a.registrationHash};}
