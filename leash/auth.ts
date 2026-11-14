import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { verifyMessage } from 'near-api-js/nep413';
import type { Provider } from 'near-api-js';
export interface Session { id:string; ownerAccountId:string; publicKey:string; csrf:string; expiresAt:number; createdAt:number; lastSeenAt:number; }
interface Challenge { id:string; ownerAccountId:string; anonymous:string; message:string; recipient:string; nonce:string; expiresAt:number; }
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export class Auth {
  private challenges=new Map<string,Challenge>();private sessions=new Map<string,Session>();
  constructor(readonly ownerAccountId:string,readonly walletId:string,readonly origin:string,readonly provider:Provider,readonly clock:()=>number=Date.now){}
  challenge(accountId:string,anonymous:string):Challenge {
    if(accountId!==this.ownerAccountId)throw new Error('Only the configured contract owner can authorize operations.');
    const now=this.clock();for(const[id,c]of this.challenges)if(c.expiresAt<now)this.challenges.delete(id);if(this.challenges.size>=100)throw new Error('Too many pending authorizations.');
    const c:Challenge={id:randomUUID(),ownerAccountId:accountId,anonymous,message:`Authorize Leash owner session.\nNetwork: mainnet\nWallet: ${this.walletId}\nOrigin: ${this.origin}\nExpires: ${new Date(now+300000).toISOString()}`,recipient:new URL(this.origin).host,nonce:randomBytes(32).toString('base64'),expiresAt:now+300000};this.challenges.set(c.id,c);return c;
  }
  async verify(id:string,anonymous:string,signed:{accountId:string;publicKey:string;signature:string}):Promise<{token:string;session:Session}> {
    const c=this.challenges.get(id);if(!c || c.anonymous!==anonymous || c.expiresAt<this.clock())throw new Error('Authorization challenge expired or invalid.');this.challenges.delete(id);
    if(signed.accountId!==c.ownerAccountId || signed.signature.length>200 || signed.publicKey.length>110)throw new Error('Signer does not match the contract owner.');
    await verifyMessage({signerAccountId:signed.accountId,signerPublicKey:signed.publicKey,payload:{message:c.message,recipient:c.recipient,nonce:Buffer.from(c.nonce,'base64')},signature:Buffer.from(signed.signature,'base64'),provider:this.provider});
    const token=randomBytes(32).toString('base64url');const session={id:randomUUID(),createdAt:this.clock(),lastSeenAt:this.clock(),ownerAccountId:c.ownerAccountId,publicKey:signed.publicKey,csrf:randomBytes(24).toString('base64url'),expiresAt:this.clock()+900000};this.sessions.set(hash(token),session);return{token,session};
  }
  async session(token:string|undefined):Promise<Session|null>{if(!token)return null;const key=hash(token),s=this.sessions.get(key);if(!s || s.expiresAt<this.clock()){this.sessions.delete(key);return null;}const access=await this.provider.viewAccessKey({accountId:s.ownerAccountId,publicKey:s.publicKey,finalityQuery:{finality:'final'}});if(access.permission!=='FullAccess'){this.sessions.delete(key);return null;}s.lastSeenAt=this.clock();return s;}
  list(owner:string,currentId:string){return [...this.sessions.values()].filter(s=>s.ownerAccountId===owner&&s.expiresAt>this.clock()).map(({id,publicKey,createdAt,lastSeenAt,expiresAt})=>({id,publicKey,createdAt,lastSeenAt,expiresAt,current:id===currentId}));}
  removeSession(owner:string,id:string):void{for(const[k,s]of this.sessions)if(s.ownerAccountId===owner&&s.id===id)this.sessions.delete(k);}
  revoke(token:string|undefined):void{if(token)this.sessions.delete(hash(token));}
}
export function equalSecret(a:string,b:string):boolean{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length && timingSafeEqual(aa,bb);}
export function tokenHash(token:string):string{return hash(token);}
