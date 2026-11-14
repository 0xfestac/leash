import { JsonRpcProvider, Account, baseEncode, type Provider } from 'near-api-js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { integer, validatePolicy, validateRequest, PolicyError, type Policy, type PaymentRequest } from './policy.js';
export const HARD_CAP = '1000000000000000000000';
export const MAX_AGENT_GAS = '20000000000000000000000';
export const MAINNET_RPC = 'https://free.rpc.fastnear.com';
export interface LiveConfig { network:'mainnet';rpcUrl:string;walletId:string;ownerAccountId:string;merchantId:string;receiptPublicKey:string;maxExposure:string; }
export interface ChainAgent { public_key: string; name: string; policy: Policy; active: boolean; spent: string; days: Record<string,string>; }
export interface ChainReceipt extends PaymentRequest { agentKey: string; status: 'pending' | 'succeeded' | 'failed'; day: string; createdAt: number; settledAt: number | null; }
export interface ChainWallet { version: number; ownerAccountId: string; recoveryKey: string; hardCap: string; reserved: string; available: string; receiptCount: number; agentKeys: string[]; storageUsage: number; safetyReserve: string; }
export function validateLivePolicy(input: unknown): Policy {
  const policy = validatePolicy(input);
  if (BigInt(policy.perPayment)>BigInt(HARD_CAP)) throw new PolicyError('PER_PAYMENT','The immutable maximum is 0.001 NEAR per payment.');
  return policy;
}
export function validateLiveRequest(input: unknown): PaymentRequest {
  const request=validateRequest(input);
  if (BigInt(request.amount)>BigInt(HARD_CAP)) throw new PolicyError('PER_PAYMENT','The immutable maximum is 0.001 NEAR per payment.');
  return request;
}
export function explorer(network: string, hash: string): string { return `https://${network==='mainnet'?'':'testnet.'}nearblocks.io/txns/${encodeURIComponent(hash)}`; }
export async function loadLiveConfig(path = '.runtime/public/native-config.json'): Promise<LiveConfig | null> {
  try {
    const c=JSON.parse(await readFile(path,'utf8')) as LiveConfig;
    if (c.network!=='mainnet' || !['https://free.rpc.fastnear.com','https://rpc.mainnet.near.org'].includes(c.rpcUrl) || !c.ownerAccountId || !c.walletId || c.walletId!==c.ownerAccountId || !c.receiptPublicKey) throw new Error('Invalid mainnet deployment configuration.');
    return c;
  } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT') return null; throw e; }
}
import {SignerClient} from './signer-client.js';
import {PublicKey} from 'near-api-js';
import {verifyCrypto} from './intent.js';
export const keyId=(pk:string)=>'00'+Buffer.from(PublicKey.fromString(pk).data).toString('hex');
export class Chain {
 readonly provider:Provider;
 constructor(readonly config:LiveConfig,readonly broker:SignerClient,provider?:Provider){this.provider=provider||new JsonRpcProvider({url:config.rpcUrl},{retries:2,wait:200,backoff:1.5});}
 async verifyNetwork(){if(await this.provider.getNetworkId()!==this.config.network)throw new Error('RPC network mismatch.');}
 async account(id:string){await this.verifyNetwork();const a=new Account(id,this.provider);const[state,keys]=await Promise.all([a.getState(),a.getAccessKeyList()]);return {accountId:id,balance:{total:state.balance.total.toString(),available:state.balance.available.toString(),storage:state.balance.usedOnStorage.toString(),locked:state.balance.locked.toString()},storageUsage:state.storageUsage,codeHash:state.codeHash,keys:keys.keys};}
 async requireDeployment():Promise<ChainWallet>{const snap=await this.snapshot();if(!snap.signer.approved)throw new Error('Native setup approval is pending.');return snap.wallet;}
 async snapshot(){const[account,signer]=await Promise.all([this.account(this.config.ownerAccountId),this.broker.call('snapshot')]);if(signer.ownerAccountId!==this.config.ownerAccountId||signer.receiptPublicKey!==this.config.receiptPublicKey)throw new Error('Private signer identity mismatch.');const grants=signer.grants as any[];const agents:[string,ChainAgent][]=grants.map(g=>{const access=account.keys.find(k=>k.public_key===g.agentPublicKey);const p=access?.access_key.permission;const scoped=p&&p!=='FullAccess'&&'FunctionCall'in p&&p.FunctionCall.receiver_id===this.config.ownerAccountId&&p.FunctionCall.method_names.length===1&&p.FunctionCall.method_names[0]==='request_payment'&&p.FunctionCall.allowance!=null&&BigInt(p.FunctionCall.allowance)>0n&&BigInt(p.FunctionCall.allowance)<=1000000000000000000000n;return[keyId(g.agentPublicKey),{public_key:g.agentPublicKey,name:g.name,policy:g.policy,active:g.active&&Boolean(scoped),spent:(signer.policies||{})[g.agentPublicKey]?.spent||'0',days:(signer.policies||{})[g.agentPublicKey]?.days||{}}];});const receipts=(signer.receipts as any[]).map(r=>this.present(r));const remaining=BigInt(this.config.maxExposure)-BigInt(signer.setupExposure)-BigInt(signer.spentPayments)-BigInt(signer.spentGas)-BigInt(signer.agentGasExposure);const wallet:ChainWallet={version:3,ownerAccountId:this.config.ownerAccountId,recoveryKey:account.keys.find(k=>k.access_key.permission==='FullAccess')?.public_key||'',hardCap:HARD_CAP,reserved:signer.reserved,available:(remaining>0n?remaining:0n).toString(),receiptCount:receipts.length,agentKeys:agents.map(([k])=>k),storageUsage:account.storageUsage,safetyReserve:'0'};return {config:this.config,wallet,agents,receipts,account,owner:account,signer,checkedAt:new Date().toISOString()};}
 present(r:any){const{receiptSignature,...body}=r;verifyCrypto('receipt',body,this.config.ownerAccountId,receiptSignature,this.config.receiptPublicKey);return {...r,agentKey:keyId(r.agentKey),agentPublicKey:r.agentKey,attestation:r};}
 async agents(){return(await this.snapshot()).agents;}
 async agent(key:string){return(await this.agents()).find(([k])=>k===key)?.[1]||null;}
 async receipts(){return(await this.snapshot()).receipts;}
 async receipt(key:string,id:string){return(await this.receipts()).find(r=>r.agentKey===key&&r.requestId===id)||null;}
 async trustedReceipt(key:string,request:PaymentRequest){const r=await this.receipt(key,request.requestId);if(!r)return null;if(r.apiId!==request.apiId||r.amount!==request.amount||r.recipient!==request.recipient||r.payloadHash!==request.payloadHash)throw new Error('Receipt binding mismatch.');return r;}
}
