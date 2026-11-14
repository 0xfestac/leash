import {test} from 'node:test';import assert from 'node:assert/strict';
import {Worker} from 'near-workspaces';import {Account,JsonRpcProvider,type KeyPairString} from 'near-api-js';import {signMessage} from 'near-api-js/nep413';
import {Auth} from '../leash/auth.js';
test('NEP413 authenticates actual FullAccess membership with fresh cookie-bound nonce', {timeout:90000},async()=>{
 const w=await Worker.init();try{
  const root=w.rootAccount,p=new JsonRpcProvider({url:w.provider.connection.url}),key=(await root.getKey())!;
  const account=new Account(root.accountId,p,key.toString() as KeyPairString);let now=1000000;const auth=new Auth(root.accountId,'wallet.test.near','https://leash.example',p,()=>now);
  const sign=async(c:any,change:Record<string,unknown>={})=>{const s=await signMessage({signerAccount:account,payload:{message:c.message,recipient:c.recipient,nonce:Buffer.from(c.nonce,'base64'),...change}});return {accountId:s.accountId,publicKey:s.publicKey.toString(),signature:Buffer.from(s.signature).toString('base64')};};
  assert.throws(()=>auth.challenge('attacker.test.near','browser-a'),/configured contract owner/);
  const c=auth.challenge(root.accountId,'browser-a'),signed=await sign(c);await assert.rejects(auth.verify(c.id,'browser-b',signed),/challenge expired or invalid/);
  const result=await auth.verify(c.id,'browser-a',signed);assert.equal((await auth.session(result.token))?.ownerAccountId,root.accountId);assert.equal(auth.list(root.accountId,result.session.id).length,1);
  await assert.rejects(auth.verify(c.id,'browser-a',signed),/challenge expired or invalid/);
  const altered=auth.challenge(root.accountId,'browser-a');await assert.rejects(auth.verify(altered.id,'browser-a',await sign(altered,{recipient:'attacker.example'})),/signature|verify|invalid/i);
  const expired=auth.challenge(root.accountId,'browser-a');now+=300001;await assert.rejects(auth.verify(expired.id,'browser-a',await sign(expired)),/expired/);
  auth.revoke(result.token);assert.equal(await auth.session(result.token),null);
 }finally{await w.tearDown();}
});
