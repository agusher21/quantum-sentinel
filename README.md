# Quantum Sentinel 🛡️

A post-quantum allowance agent on the QoreChain testnet
(`qorechain-diana`, EVM 9800). It only moves testnet QOR inside a policy
you can read — a per-transaction cap, a daily cap, a daily transaction
count, a whitelist, and active hours — and only inside a scoped, expiring
EVM authorisation window. Every action is a hybrid-signed transaction
(secp256k1 + ML-DSA-87), and every agent command is authenticated with an
ML-DSA-87 signature. Out-of-policy tasks are rejected and logged, never
executed.

QoreChain Developer Fest "Build Before Q-Day" — **Post-Quantum AI Agents**
category, solo builder. Third fest project, after Quantum Tip Jar and
Quantum Dice.

- Repo: https://github.com/agusher21/quantum-sentinel
- Live demo: https://quantum-sentinel.vercel.app
- Fest page: https://build.qorechain.io/p/quantum-sentinel (to be created)
- Agent (testnet only): `qor1zr9ev820wyrw300yy9ke99x2xuq3nrmf6nknqd`
  (EVM `0x10cB961d4F7106E8BdE4216d9294Ca3701198F69`)
- Owner / treasury: Toni's QoreX testnet wallet
  `qor1ntpfg4zpxxkpwzwrh0uwdqqyz36lqnmp8nmpz0`
  (EVM `0x9ac294544131ac1709c3bbf8e680041475f04f61`). The agent only ever
  sends **to** this address, never **from** it.

## What it does

The demo (Vite + React + TypeScript) shows the agent live:

- **Agent status, read from the chain** — QOR balance, PQC key
  registration (`fetchPqcStatus`), and EVM window status
  (`fetchEvmWindow`: found, expiry height, txs/value used vs. allowed).
- **Spending policy card** — editable in the browser (localStorage). The
  same defaults live in `scripts/policy.json` and are enforced by the
  runner.
- **Policy playground** — enter a destination, amount, and lane and see
  the agent's exact decision: ALLOW, or REJECT with the rule that fired.
  No wallet needed, nothing is sent.
- **Activity log** — real agent runs from `public/agent-log.json`,
  written by the runner, each with its on-chain transaction. `?mock=1`
  shows clearly-labelled simulated entries instead.
- **Authenticated-messaging demo** — a fresh demo-only ML-DSA-87 keypair
  is generated in the browser, signs a sample agent command, and
  `pqcVerify` passes; tamper with the amount after signing and
  verification fails — the agent would reject the command.
- **QoreX connect** — a visitor can connect their own wallet to see their
  address and balance. The demo never signs as the agent from the browser.

The runner (`scripts/agent-run.mjs`) is the agent itself: it reads a task
queue, evaluates every task against the policy, simulates each in-policy
transaction first, and only then broadcasts — hybrid-signed on the native
lane, and inside a scoped EVM window on the EVM lane.

## The policy (defaults)

| Rule | Default |
| --- | --- |
| Max QOR per transaction | 0.1 |
| Max QOR per day (native + EVM) | 0.5 |
| Max transactions per day | 10 |
| Whitelist | owner only (`qor1ntpfg…`) |
| Active hours (UTC) | 00:00–23:59 |
| EVM window | 600 blocks, 5 txs, 1 QOR max value |

Rules are checked in a fixed order (whitelist → per-tx cap → daily cap →
daily tx count → active hours → EVM window bound), so a rejection always
names exactly one rule.

## How the four category requirements are met

1. **Scoped EVM window** — before any EVM spend, the runner broadcasts
   a hybrid-signed `MsgOpenEVMWindow` (600 blocks / 5 txs / 1 QOR max
   value), then reads the window back with `fetchEvmWindow` and refuses
   to send unless it is live and its remaining value covers the transfer
   plus maximum fees. Opening the window advances the account's EVM
   nonce, so the EVM transaction is signed after the window opens.
2. **Tx / value / duration / target limits** — the window itself bounds
   duration (blocks), transaction count, and total value on chain; the
   policy adds per-tx and per-day caps and a whitelist, enforced in the
   runner before any transaction is built.
3. **Smart-account spending rules** — the policy loop: balance + PQC
   registration pre-flight → per-task policy evaluation → simulation →
   broadcast → log. Rejected tasks are logged with the firing rule and
   never executed. The same evaluation function ships in the demo
   playground (`src/policy.ts`) so anyone can audit the decision logic.
4. **Authenticated messaging** — agent commands are ML-DSA-87 signed
   messages (`pqcSign` / `pqcVerify`). The demo proves the property
   in-browser: a tampered command fails verification and would be
   rejected. The agent's own key is the canonical address-bound ML-DSA-87
   keypair (`derivePqcCanonical`), registered on chain before its first
   spend.

## Architecture

```
public/agent-log.json        ← runner appends every decision (last 100)
src/
  App.tsx                    ← demo UI (status, policy, playground, log, messaging)
  qore.ts                    ← QoreChain helpers (QoreX, /lcd reads, log loading)
  policy.ts                  ← policy type + pure evaluatePolicy() + localStorage
scripts/
  setup-agent.mjs            ← run ONCE: fresh testnet-only agent identity
  register-agent.mjs         ← register the agent's ML-DSA-87 key on chain
  agent-run.mjs              ← the agent: policy loop + hybrid-signed execution
  common.mjs                 ← env parsing, identity, TxClient, log, policy eval
  policy.json                ← the default policy
  tasks.json                 ← the demo task queue
```

No smart contract, no server, no custody of anyone else's funds. The
agent holds only faucet QOR on testnet.

## Setup

```bash
npm install
```

### 1. Agent identity (already done — do not re-run)

```bash
node scripts/setup-agent.mjs
```

Creates a fresh testnet-only account and writes its mnemonic to
`.env.local` (mode 600, gitignored). It prints only the public addresses.
Never commit `.env.local`, never use this key on mainnet or for real funds.

### 2. Fund the agent

Claim the faucet (https://dashboard.qorechain.io/faucet, 100 QOR per
claim) to the agent's `qor1…` address.

### 3. Register the PQC key

```bash
node scripts/register-agent.mjs
```

Fails cleanly with "agent unfunded — claim the faucet first" when the
balance is 0. Registers the canonical ML-DSA-87 key on chain
(`ensurePqcRegistered`, idempotent) and verifies with a fresh
`fetchPqcStatus` read.

### 4. Run the agent

```bash
node scripts/agent-run.mjs
```

Pre-flight checks balance + PQC registration, then works through
`scripts/tasks.json`:

| Task | Expected |
| --- | --- |
| `native-send`: 0.05 QOR → owner (native) | EXECUTE (hybrid-signed) |
| `oversize-send`: 5 QOR → owner (native) | REJECT — `maxQorPerTx` |
| `non-whitelisted-send`: 0.05 QOR → random qor1 | REJECT — `whitelist` |
| `evm-transfer`: 0.01 QOR → owner EVM (EVM) | EXECUTE — window + EVM transfer |

Every decision is logged to `public/agent-log.json` with its reason and
tx hash + explorer link. Rejected tasks are never executed.

### 5. Run the demo

```bash
npm run dev        # http://localhost:5173
npm run build      # tsc + vite build (must pass clean)
```

`?mock=1` runs the full UI without a wallet (seeded policy + simulated
log/status, all labelled simulated).

## Vercel deployment

Import the repo into Vercel (Vite preset). The `/lcd` rewrite in
`vercel.json` proxies REST reads to `https://api-testnet.qore.host` (the
public API sends no CORS headers). These environment variables are used
by the deployment (names only — set real values in the Vercel dashboard,
never in the repo):

- `AGENT_MNEMONIC` — agent identity (testnet only)
- `AGENT_ADDRESS` — agent `qor1…` address
- `AGENT_EVM_ADDRESS` — agent `0x…` address
- `AGENT_PQC_PUBLIC_KEY_HEX` — agent ML-DSA-87 public key (hex)

The demo itself needs none of these to render: the agent address and
public-key fingerprint are public constants in `src/qore.ts`, and live
status is read over `/lcd`.

## Credits

Built with create-qorechain-dapp v0.14.0 / @qorechain/sdk 0.14.0,
@viem 2.57.20, Vite 5.4 + React 18.3.1 + TypeScript. QoreChain testnet
(`qorechain-diana`, EVM 9800) only. See `AI_USAGE.md` for how AI was used
and what the human verified, and `FEST_FIELDS.md` for the exact fest
form texts.
