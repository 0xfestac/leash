export const YOCTO = 10n ** 24n;
export const MAX_RECORDS = 500;
export const MAX_AGENTS = 16;
export type DenialCode = 'MALFORMED' | 'UNKNOWN_AGENT' | 'REVOKED' | 'NOT_APPROVED' | 'PER_PAYMENT' | 'TOTAL_LIMIT' | 'DAILY_LIMIT' | 'INSUFFICIENT_FUNDS' | 'ID_CONFLICT' | 'CAPACITY';
export class PolicyError extends Error {
  constructor(public code: DenialCode, message: string) { super(message); }
}
export interface Policy { perPayment: string; total: string; daily: string; bindings: Record<string, string>; }
export interface AgentState { policy: Policy; active: boolean; spent: string; days: Record<string, string>; }
export interface PaymentRequest { requestId: string; apiId: string; recipient: string; amount: string; payloadHash: string; }
export interface Receipt extends PaymentRequest {
  agentKey: string; status: 'pending' | 'succeeded' | 'failed'; day: string;
  createdAt: number; settledAt?: number; mode: 'local' | 'testnet' | 'mainnet';
}
export interface WalletState {
  version: 1; agents: Record<string, AgentState>; receipts: Record<string, Receipt>;
  balance: string; reserved: string;
}
export function initialState(balance: string): WalletState {
  integer(balance, false); return { version: 1, agents: {}, receipts: {}, balance, reserved: '0' };
}
export function integer(value: unknown, positive = true): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,35})$/.test(value) || (positive && value === '0'))
    throw new PolicyError('MALFORMED', 'Amounts must be canonical positive integer yoctoNEAR strings.');
  return BigInt(value);
}
export function accountId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 64 || !/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value))
    throw new PolicyError('MALFORMED', 'Recipient must be a valid NEAR account identifier.');
}
export function validatePolicy(input: unknown): Policy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PolicyError('MALFORMED', 'Policy must be an object.');
  const p = input as Policy;
  integer(p.perPayment); integer(p.total); integer(p.daily);
  if (BigInt(p.perPayment) > BigInt(p.total) || BigInt(p.perPayment) > BigInt(p.daily))
    throw new PolicyError('MALFORMED', 'Per-payment cap must fit both total and daily caps.');
  if (!p.bindings || typeof p.bindings !== 'object' || Array.isArray(p.bindings) || Object.keys(p.bindings).length < 1 || Object.keys(p.bindings).length > 8)
    throw new PolicyError('MALFORMED', 'Approve between one and eight API-to-recipient bindings.');
  const bindings: Record<string, string> = {};
  for (const [api, recipient] of Object.entries(p.bindings)) {
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(api)) throw new PolicyError('MALFORMED', 'Invalid API identifier.');
    accountId(recipient); bindings[api] = recipient;
  }
  return { perPayment: p.perPayment, total: p.total, daily: p.daily, bindings };
}
export function validateRequest(input: unknown): PaymentRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PolicyError('MALFORMED', 'Payment request must be an object.');
  const r = input as PaymentRequest;
  if (typeof r.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(r.requestId)) throw new PolicyError('MALFORMED', 'Request id needs 8–64 letters, digits, underscores or dashes.');
  if (typeof r.apiId !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(r.apiId)) throw new PolicyError('MALFORMED', 'Invalid API identifier.');
  accountId(r.recipient); integer(r.amount);
  if (typeof r.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(r.payloadHash)) throw new PolicyError('MALFORMED', 'Payload hash must be SHA-256 hex.');
  return { requestId: r.requestId, apiId: r.apiId, recipient: r.recipient, amount: r.amount, payloadHash: r.payloadHash };
}
export function utcDay(now: number): string {
  if (!Number.isSafeInteger(now) || now < 0) throw new PolicyError('MALFORMED', 'Invalid timestamp.');
  return String(Math.floor(now / 86_400_000));
}
export function receiptKey(agentKey: string, requestId: string): string { return `${agentKey}|${requestId}`; }
export function setPolicy(state: WalletState, key: string, policy: unknown): void {
  if (!key || key.length > 128 || key.includes('|') || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new PolicyError('MALFORMED', 'Invalid agent key.');
  const parsed = validatePolicy(policy);
  const existing = Object.prototype.hasOwnProperty.call(state.agents, key) ? state.agents[key] : undefined;
  if (!existing && Object.keys(state.agents).length >= MAX_AGENTS) throw new PolicyError('CAPACITY', 'Agent registry is full.');
  state.agents[key] = existing ? { ...existing, policy: parsed } : { policy: parsed, active: true, spent: '0', days: {} };
}
export function revoke(state: WalletState, key: string): void {
  const agent = Object.prototype.hasOwnProperty.call(state.agents, key) ? state.agents[key] : undefined;
  if (!agent) throw new PolicyError('UNKNOWN_AGENT', 'Agent is not registered.');
  agent.active = false;
}
export function reserve(state: WalletState, agentKey: string, input: unknown, now: number, mode: Receipt['mode']): { receipt: Receipt; fresh: boolean } {
  const r = validateRequest(input);
  const id = receiptKey(agentKey, r.requestId);
  const previous = state.receipts[id];
  if (previous) {
    if (previous.apiId !== r.apiId || previous.recipient !== r.recipient || previous.amount !== r.amount || previous.payloadHash !== r.payloadHash)
      throw new PolicyError('ID_CONFLICT', 'Request id already belongs to a different payment.');
    return { receipt: previous, fresh: false };
  }
  const agent = Object.prototype.hasOwnProperty.call(state.agents, agentKey) ? state.agents[agentKey] : undefined;
  if (!agent) throw new PolicyError('UNKNOWN_AGENT', 'Agent is not registered.');
  if (!agent.active) throw new PolicyError('REVOKED', 'Agent capability has been revoked.');
  if (agent.policy.bindings[r.apiId] !== r.recipient) throw new PolicyError('NOT_APPROVED', 'API and recipient are not an approved pair.');
  const amount = BigInt(r.amount), day = utcDay(now);
  if (amount > BigInt(agent.policy.perPayment)) throw new PolicyError('PER_PAYMENT', 'Payment exceeds the per-payment cap.');
  if (amount + BigInt(agent.spent) > BigInt(agent.policy.total)) throw new PolicyError('TOTAL_LIMIT', 'Payment exceeds the remaining total allowance.');
  if (amount + BigInt(agent.days[day] || '0') > BigInt(agent.policy.daily)) throw new PolicyError('DAILY_LIMIT', 'Payment exceeds today’s UTC allowance.');
  if (amount > BigInt(state.balance) - BigInt(state.reserved)) throw new PolicyError('INSUFFICIENT_FUNDS', 'Wallet has insufficient available funds.');
  if (Object.keys(state.receipts).length >= MAX_RECORDS) throw new PolicyError('CAPACITY', 'Receipt store is full; rotate to a new wallet.');
  const receipt: Receipt = { ...r, agentKey, day, status: 'pending', createdAt: now, mode };
  agent.spent = (BigInt(agent.spent) + amount).toString();
  agent.days[day] = (BigInt(agent.days[day] || '0') + amount).toString();
  state.reserved = (BigInt(state.reserved) + amount).toString();
  state.receipts[id] = receipt;
  return { receipt, fresh: true };
}
export function finalize(state: WalletState, agentKey: string, requestId: string, succeeded: boolean, now: number): Receipt {
  const receipt = state.receipts[receiptKey(agentKey, requestId)];
  if (!receipt) throw new PolicyError('MALFORMED', 'No reservation exists.');
  if (receipt.status !== 'pending') return receipt;
  utcDay(now);
  if (now < receipt.createdAt) throw new PolicyError('MALFORMED', 'Settlement cannot precede reservation.');
  const amount = BigInt(receipt.amount), agent = state.agents[agentKey];
  state.reserved = (BigInt(state.reserved) - amount).toString();
  if (succeeded) state.balance = (BigInt(state.balance) - amount).toString();
  else {
    agent.spent = (BigInt(agent.spent) - amount).toString();
    agent.days[receipt.day] = (BigInt(agent.days[receipt.day] || '0') - amount).toString();
  }
  receipt.status = succeeded ? 'succeeded' : 'failed'; receipt.settledAt = now;
  return receipt;
}
export function parseNear(value: string): string {
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,24})?$/.test(value)) throw new PolicyError('MALFORMED', 'Use a non-negative NEAR decimal with at most 24 decimal places.');
  const [whole, fractional = ''] = value.split('.');
  return (BigInt(whole) * YOCTO + BigInt(fractional.padEnd(24, '0'))).toString();
}
export function formatNear(value: string): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,47})$/.test(value)) throw new PolicyError('MALFORMED', 'Invalid exact amount for display.');
  const n = BigInt(value), frac = (n % YOCTO).toString().padStart(24, '0').replace(/0+$/, '');
  return `${n / YOCTO}${frac ? `.${frac}` : ''}`;
}
