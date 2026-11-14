import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, setPolicy, reserve, PolicyError, type Policy } from '../leash/policy.js';
interface Case { name: string; amount: string; spent: string; today: string; balance: string; reserved: string; apiId: string; recipient: string; expected: string; }
const dataset = JSON.parse(readFileSync('tests/fixtures/spend-boundaries.json', 'utf8')) as { rounds: { seed: number; policy: Policy; cases: Case[] }[] };
const seed = Number(process.env.LEASH_DATASET_SEED || '0');
let selected = 0;
for (const round of dataset.rounds) {
  if (seed && seed !== round.seed) continue;
  selected++;
  test(`independent reference dataset seed ${round.seed}: ${round.cases.length} exact-integer boundaries`, () => {
    assert.equal(round.cases.length, 75);
    for (const item of round.cases) {
      const key = 'reference-agent', state = initialState(item.balance); setPolicy(state, key, round.policy);
      state.agents[key].spent = item.spent; state.agents[key].days['0'] = item.today; state.reserved = item.reserved;
      const before = JSON.stringify(state), request = { requestId: 'dataset_001', apiId: item.apiId, recipient: item.recipient, amount: item.amount, payloadHash: 'a'.repeat(64) };
      let outcome = 'ALLOW';
      try { reserve(state, key, request, 1, 'local'); } catch (e) { if (!(e instanceof PolicyError)) throw e; outcome = e.code; }
      assert.equal(outcome, item.expected, `seed ${round.seed}: ${item.name}`);
      if (outcome !== 'ALLOW') assert.equal(JSON.stringify(state), before, item.name);
      else {
        assert.equal(state.agents[key].spent, (BigInt(item.spent) + BigInt(item.amount)).toString());
        assert.equal(state.agents[key].days['0'], (BigInt(item.today) + BigInt(item.amount)).toString());
        assert.equal(state.reserved, (BigInt(item.reserved) + BigInt(item.amount)).toString()); assert.equal(state.balance, item.balance);
      }
    }
  });
}
assert.ok(selected, 'Unknown dataset seed.');
