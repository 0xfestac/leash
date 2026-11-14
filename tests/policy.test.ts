import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, setPolicy, reserve, finalize, revoke, PolicyError, parseNear, formatNear } from '../leash/policy.js';
const key = 'ed25519:agent';
const policy = { perPayment: '10', total: '30', daily: '20', bindings: { 'risk-report': 'provider.testnet' } };
const request = (id = 'payment_001', amount = '10') => ({ requestId: id, apiId: 'risk-report', recipient: 'provider.testnet', amount, payloadHash: 'a'.repeat(64) });
function fixture() { const s = initialState('100'); setPolicy(s, key, policy); return s; }
function denied(fn: () => unknown, code: string) { assert.throws(fn, (e: unknown) => e instanceof PolicyError && e.code === code); }
test('integer accounting and decimal conversion are exact beyond Number precision', () => {
  assert.equal(parseNear('1.000000000000000000000001'), '1000000000000000000000001');
  assert.equal(formatNear(parseNear('123.456')), '123.456');
  for (const x of ['1e2', '-1', '01', '0.0000000000000000000000001', 'NaN']) denied(() => parseNear(x), 'MALFORMED');
});
test('reservation gates, definitive failure release and idempotent settlement', () => {
  const s = fixture(); reserve(s, key, request(), 0, 'local');
  assert.equal(s.reserved, '10'); assert.equal(s.balance, '100'); assert.equal(s.agents[key].spent, '10');
  assert.equal(reserve(s, key, request(), 0, 'local').fresh, false);
  denied(() => reserve(s, key, request('payment_001', '9'), 0, 'local'), 'ID_CONFLICT');
  finalize(s, key, 'payment_001', false, 86_400_001);
  assert.equal(s.reserved, '0'); assert.equal(s.agents[key].days['0'], '0');
  finalize(s, key, 'payment_001', true, 86_400_002); assert.equal(s.balance, '100');
});
test('UTC rollover retains total spend and prior pending reservations', () => {
  const s = fixture(); reserve(s, key, request('payment_001'), 86_399_999, 'local');
  reserve(s, key, request('payment_002'), 86_399_999, 'local');
  denied(() => reserve(s, key, request('payment_003'), 86_399_999, 'local'), 'DAILY_LIMIT');
  reserve(s, key, request('payment_003'), 86_400_000, 'local');
  denied(() => reserve(s, key, request('payment_004'), 86_400_000, 'local'), 'TOTAL_LIMIT');
  finalize(s, key, 'payment_001', false, 86_400_001);
  assert.equal(s.agents[key].days['0'], '10'); assert.equal(s.agents[key].days['1'], '10');
});
test('unapproved pairing, bypass amount, malformed and revoked never reserve funds', () => {
  const s = fixture(), before = JSON.stringify(s);
  denied(() => reserve(s, key, { ...request(), recipient: 'scam.testnet' }, 0, 'local'), 'NOT_APPROVED');
  denied(() => reserve(s, key, { ...request(), apiId: 'other-api' }, 0, 'local'), 'NOT_APPROVED');
  denied(() => reserve(s, key, request('payment_001', '11'), 0, 'local'), 'PER_PAYMENT');
  for (const amount of ['0', '-1', '01', '1.1', '1e3', 1, null]) denied(() => reserve(s, key, { ...request(), amount }, 0, 'local'), 'MALFORMED');
  denied(() => reserve(s, '__proto__', request(), 0, 'local'), 'UNKNOWN_AGENT');
  assert.equal(JSON.stringify(s), before); revoke(s, key);
  denied(() => reserve(s, key, request(), 0, 'local'), 'REVOKED');
  setPolicy(s, key, policy); assert.equal(s.agents[key].active, false);
});
test('funds bound and updates preserve counters', () => {
  const s = fixture(); s.balance = '15'; reserve(s, key, request(), 0, 'local');
  denied(() => reserve(s, key, request('payment_002'), 0, 'local'), 'INSUFFICIENT_FUNDS');
  setPolicy(s, key, { ...policy, total: '10' }); assert.equal(s.agents[key].spent, '10');
  finalize(s, key, 'payment_001', true, 1); assert.equal(s.balance, '5');
  denied(() => reserve(s, key, request('payment_003', '1'), 0, 'local'), 'TOTAL_LIMIT');
});
test('prototype revocation and invalid settlement timestamps cannot mutate state', () => {
  const s = fixture(), before = JSON.stringify(s);
  denied(() => revoke(s, '__proto__'), 'UNKNOWN_AGENT');
  denied(() => revoke(s, 'constructor'), 'UNKNOWN_AGENT');
  assert.equal((Object.prototype as { active?: boolean }).active, undefined);
  assert.equal(JSON.stringify(s), before);
  reserve(s, key, request(), 100, 'local'); const reserved = JSON.stringify(s);
  for (const t of [NaN, -1, 99, Infinity]) denied(() => finalize(s, key, 'payment_001', true, t), 'MALFORMED');
  assert.equal(JSON.stringify(s), reserved);
});
