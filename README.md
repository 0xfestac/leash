# Leash

Leash lets an agent buy a useful API result with **native NEAR on mainnet**, inside an owner-signed policy. The payment ceiling is **0.001 NEAR per invoice**.

The application has separate wallet, agent/detail, policy, activity/receipt, integration, security, console and connection views. Balances, access-key permissions and transfer status come from NEAR RPC. Policy counters and payload-bound receipts come from the private signer and its durable journal.

## Trust boundary

There is **no Leash payment contract**. The agent holds a function-call identity key scoped to `request_payment` on the owner account. It signs off-chain NEP-413 requests and cannot transfer native NEAR directly. The method scope identifies the request capability; it does not represent an executable payment contract.

An isolated private signer holds the owner key. It independently verifies an owner-signed grant, the agent request signature, current on-chain key membership/scope, recipient/API binding, per-payment/daily/total limits, and the approved exposure budget. It constructs exactly one native `Transfer` action. Spending rules are enforced **off-chain by this trusted signer**, not by NEAR contract code. A compromised private signer or owner recovery key remains privileged. No TEE or production-custody audit is claimed.

The owner key is never accepted by the browser or loaded into the public app/agent process. Run the private signer under the owner UID and the public app under a separate UID. A shared Unix socket grants IPC access; owner-key, receipt-key and journal files stay mode 0600. The private signer rechecks signatures and policy even when a public caller already has a session or scoped API token.

The signer stores the signed transaction hash/bytes before broadcasting. An unresolved owner nonce blocks another payment globally. Reconciliation resends only the same signed bytes. Settlement and accounting commit once before receipt attestation. The attestation binds the input hash and request identity to the exact verified native transaction; it does not pretend that the input hash is stored on-chain.

## Run

Use Linux, Node 22.22.2 or newer, and npm. No Rust or contract compiler is required.

```sh
npm install
npm run build
```

Configure the isolated owner's ignored `.env` using the names in `.env.example`, then `chmod 600 .env`. Never send keys in chat, put them in the browser, or export them into the public service environment.

```sh
npm run setup:plan
```

Review the exact accounts, key permissions, real setup costs, maximum exposure and recovery plan before any mainnet execution. Native account creation has material fees in addition to the recipient funding and key storage. A 0.001 invoice ceiling does **not** cap those setup/gas costs. The execution command requires a separate exact approval file; the public app cannot deploy, create accounts or load bootstrap credentials.

Run the owner-only private signer and the public application as separate processes:

```sh
npm run private-signer
# Separate terminal/service: no owner-key environment variables.
npm start
```

Open http://127.0.0.1:3000. Without approved setup, the views show the actual owner account and an explicit paused/unconfigured state; they do not invent balances, policies or payment success. Public HTTPS hosting needs an exact `LEASH_PUBLIC_ORIGIN`. The app never reads `.env` automatically.

After approved setup, authorize the owner in a standard wallet through NEAR Connect. Sign the policy in the Agents/Policies view. The initial grant is limited to one 0.001 proof payment by both daily and total allowance. The Console signs a request with the agent identity key, verifies the native transfer, then releases the computed batch-analysis report. The merchant is a distinct no-code account, so an actual payment balance movement can be checked.

## Agent tools

Give an agent its scoped API token, not the owner key. The public agent process signs requests with its function-call key; the private signer verifies those signatures independently.

```sh
LEASH_URL=https://YOUR-APP
LEASH_AGENT_TOKEN=YOUR-SCOPED-TOKEN
npm run agent -- pay request_0001 examples/report-input.json
npm run agent -- receipt request_0001
```

Retain request IDs on a timeout or unknown status. Never start another invoice to “retry” an unresolved payment. The browser retains its outstanding request in tab session storage. A revoked grant cannot be reactivated by a policy edit; existing signed transfers may still settle. On-chain key deletion is a separate owner-wallet action.



## Configuration and recovery

Public configuration: `.runtime/public/native-config.json`. Public journal: `.runtime/live-ledger.json`. Agent credentials: `.agent-keys/`. Owner-only configuration, receipt key and financial journal: `.private-signer/`. All remain ignored. Use `LEASH_CONFIG_PATH`, `LEASH_LEDGER_PATH`, `LEASH_AGENT_KEY_DIR`, and `LEASH_SIGNER_SOCKET` for service-specific paths.

The private directory can be owner/group mode 02710, socket 0660 and secret files 0600. The public UID needs traversal/socket permission and its own writable journal/agent directory; it must be unable to read `.env` or private signer files. Keep the original owner recovery keys. Do not remove a live writer's lock. After a forced stop, inspect the lock's PID and remove only a verified stale lock before restarting. Preserve and restore journals rather than resetting counters. Missing approved financial history must be investigated before further signing.

A partial setup is reconciled from its actual transaction hash, account ownership and key scope. `scripts/native-resume.ts` requires a revised exact approval and journals the next signed key transaction before broadcast. It does not recreate or refund an already-created merchant. Actual fees exceeding an estimate are retained as a budget breach, not silently relabeled as a pass.

## Verification

```sh
npm run build
npm test
npm run test:native
npm run test:browser
```

Browser checks need system Chromium or `npx playwright install --with-deps chromium`. Tests use isolated NEAR sandbox infrastructure and synthetic inputs; it is not a product payment mode or evidence of mainnet settlement. The independent 750-case integer dataset remains in `tests/fixtures/spend-boundaries.json`. Native tests additionally check signatures, key scope, fixed ceilings, grant replay, global nonce uncertainty, crash-safe settlement/attestation and private-field filtering. Live transfer status can be checked without submitting another payment.

This is new hackathon code for the security and agent-economy tracks. The visual direction uses Conversion's navigation, spacing, typography and restrained card treatments with original Leash SVG/CSS; no template artwork, testimonials or customer metrics were copied. Runtime libraries include NEAR API JS, NEAR Connect and Borsh. Dependency licenses remain their own. Licensed under [MIT](LICENSE).
