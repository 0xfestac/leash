import { createHash } from 'node:crypto';
import { parseNear, formatNear, type PaymentRequest, type Receipt } from './policy.js';
export const API_ID = 'risk-report';
export const PRICE = parseNear('0.001');
export interface ReportInput { items: { account: string; amountNear: string }[]; }
export interface Report { source: 'Leash batch analysis API'; itemCount: number; totalNear: string; largestNear: string; flags: { account: string; reason: string }[]; summary: string; }
export function normalizeInput(input: unknown): ReportInput {
  if (!input || typeof input !== 'object' || !Array.isArray((input as ReportInput).items) || (input as ReportInput).items.length < 1 || (input as ReportInput).items.length > 50) throw new Error('Supply between 1 and 50 items.');
  const items = (input as ReportInput).items.map(x => {
    if (!x || typeof x.account !== 'string' || x.account.length < 2 || x.account.length > 64 || !/^[a-z0-9._-]+$/.test(x.account) || typeof x.amountNear !== 'string') throw new Error('Invalid report item.');
    return { account: x.account, amountNear: formatNear(parseNear(x.amountNear)) };
  });
  return { items };
}
export function payloadHash(input: unknown): string { return createHash('sha256').update(JSON.stringify(normalizeInput(input))).digest('hex'); }
export function requestFor(requestId: string, recipient: string, input: unknown): PaymentRequest { return { requestId, apiId: API_ID, recipient, amount: PRICE, payloadHash: payloadHash(input) }; }
export function releaseReport(receipt: Pick<Receipt, 'requestId' | 'apiId' | 'recipient' | 'amount' | 'payloadHash' | 'status'> | null, expected: PaymentRequest, input: unknown): Report {
  if (expected.apiId !== API_ID || expected.amount !== PRICE || !receipt || receipt.status !== 'succeeded' || receipt.requestId !== expected.requestId || receipt.apiId !== API_ID || receipt.amount !== PRICE || receipt.recipient !== expected.recipient || receipt.payloadHash !== payloadHash(input) || expected.payloadHash !== receipt.payloadHash) throw new Error('A succeeded receipt matching this API, price, recipient and exact input is required.');
  const { items } = normalizeInput(input), flags: Report['flags'] = [], counts = new Map<string, number>();
  let total = 0n, largest = 0n;
  for (const item of items) {
    const amount = BigInt(parseNear(item.amountNear)); total += amount; if (amount > largest) largest = amount;
    counts.set(item.account, (counts.get(item.account) || 0) + 1);
    if (amount > BigInt(parseNear('0.5'))) flags.push({ account: item.account, reason: 'Item exceeds the report’s 0.5 NEAR review threshold.' });
  }
  for (const [account, count] of counts) if (count > 1) flags.push({ account, reason: `Recipient appears ${count} times in the supplied batch.` });
  return { source: 'Leash batch analysis API', itemCount: items.length, totalNear: formatNear(total.toString()), largestNear: formatNear(largest.toString()), flags, summary: flags.length ? `${flags.length} review signals found in ${items.length} supplied items. These are input checks, not on-chain reputation.` : `No threshold or duplicate-recipient signals in ${items.length} supplied items.` };
}
export const SAMPLE_INPUT: ReportInput = { items: [ { account: 'research.testnet', amountNear: '0.12' }, { account: 'compute.testnet', amountNear: '0.8' }, { account: 'research.testnet', amountNear: '0.03' } ] };
