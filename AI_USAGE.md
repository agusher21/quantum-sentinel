# AI_USAGE.md — Quantum Sentinel

How AI was used to build this project, what the AI generated, and what the
human did. Written for the QoreChain Developer Fest "Build Before Q-Day",
Best AI-Native Build award.

## The project

**Quantum Sentinel** — a post-quantum allowance agent on the QoreChain
testnet (`qorechain-diana`, EVM 9800): it only moves testnet QOR inside a
readable spending policy (per-tx cap, daily cap, daily tx count,
whitelist, active hours) and a scoped, expiring EVM authorisation window.
Every action is a hybrid-signed transaction (secp256k1 + ML-DSA-87), and
every agent command is authenticated with an ML-DSA-87 signature.
Out-of-policy tasks are rejected and logged, never executed. Post-Quantum
AI Agents category, solo builder. It is the human builder's third fest
project, after Quantum Tip Jar and Quantum Dice.

- Repo: https://github.com/agusher21/quantum-sentinel
- Live demo: https://quantum-sentinel-mu.vercel.app
- Fest page: https://build.qorechain.io/p/quantum-sentinel (to be created)
- Built 16 November 2026 (demo + runner; first funded run still to come —
  the agent account is unfunded at the time of writing).

## The AI: what it is and how it worked

The AI is **Muse**, a personal AI agent (Meta). It worked in a chat
conversation with the human builder: the human gave short directions in
Indonesian, the AI did the research, wrote the code, ran the checks, and
reported back with receipts. The loop was: human directs → AI builds and
verifies → human reviews the live result → next direction. No step was
fully autonomous; every deploy and every on-chain step was checked live
before moving on.

The AI's working method for this project:

1. **Reuse proven templates.** The human's first two projects, Quantum
   Tip Jar and Quantum Dice, already proved the stack end to end
   (scaffold, SDK, QoreX hybrid signing, `/lcd` proxy, Vercel deploy,
   on-chain verification). The AI read that code first and reused its
   proven patterns (`src/qore.ts` helpers, `vercel.json` rewrite,
   `?mock=1` demo mode, `AI_USAGE.md` / `FEST_FIELDS.md` shapes)
   instead of starting from scratch.
2. **Read the SDK, not just the docs.** The EVM-window and hybrid-signing
   flows are new to this project, so the AI read the installed SDK's
   type definitions (`@qorechain/sdk` 0.14.0 `index.d.ts`,
   `@qorechain/evm` `window.d.ts`) to pin down the exact signatures:
   `TxClient.connect` with `pqcKeypair` + `rest`, `ensurePqcRegistered`,
   `fetchPqcStatus`, `fetchEvmWindow`, `openEvmWindowMsg`,
   `derivePqcCanonical`, `generatePqcKeypair` / `pqcSign` / `pqcVerify`,
   and the `BroadcastResult.transactionHash` field. The Ship Weeks
   helper's notes were also reused: opening a window advances the EVM
   nonce (open, then read the nonce, then sign), and `maxValue` bounds
   value PLUS maximum fees.
3. **Verify everything it claimed.** Typecheck + production build
   (`tsc --noEmit && vite build`), a live read of the agent's on-chain
   state (balance 0, PQC key not registered — matching the unfunded
   state), and a secret scan of every file that will be committed
   (no mnemonic / private-key material anywhere in the repo).

## What the AI generated

All application code in this repo was written by the AI:

- **`src/App.tsx`** — the whole UI: live agent status (balance, PQC
  registration, EVM window), editable policy card, policy playground
  (ALLOW / REJECT + the firing rule), activity log, ML-DSA-87
  authenticated-messaging demo (fresh demo-only keypair, sign, verify,
  tamper → FAIL), QoreX connect for the visitor.
- **`src/qore.ts`** — the QoreChain helpers: agent constants, QoreX
  provider detection and connect, live status reads through the `/lcd`
  proxy (`fetchPqcStatus`, `fetchEvmWindow`), activity-log loading,
  simulated mock status/log for `?mock=1`.
- **`src/policy.ts`** — the policy type, defaults, and the pure
  `evaluatePolicy()` function (whitelist → per-tx cap → daily cap →
  daily tx count → active hours → EVM window bound), plus localStorage
  persistence. The runner uses the same rules in Node.
- **`src/main.tsx`, `src/index.css`, `vite.config.ts`, `vercel.json`** —
  app entry, styling (cosmic background reused from the earlier
  projects), the `/lcd` dev proxy (default target now the public testnet
  REST API so `npm run dev` works with no local node), and the Vercel
  `/lcd` rewrite proxy.
- **`scripts/common.mjs`, `scripts/register-agent.mjs`,
  `scripts/agent-run.mjs`, `scripts/policy.json`, `scripts/tasks.json`**
  — the offline agent runner: env parsing, identity derivation and
  verification, hybrid `TxClient` connection, balance + PQC pre-flight,
  per-task policy evaluation, simulation-before-broadcast, scoped EVM
  window opening + viem transfer inside it, and decision logging to
  `public/agent-log.json` (last 100 entries).
- **`README.md`** — project description, architecture, how the four
  category requirements are met, setup and Vercel env-var names. The AI
  also drafted the fest project page text (About / How it's made) from
  the same material, saved in `FEST_FIELDS.md`.

Verification the AI performed (and can be re-checked):

- Production build passes (`tsc --noEmit && vite build`, zero errors).
- The agent identity was verified against the on-chain state read live:
  `qor1zr9ev820wyrw300yy9ke99x2xuq3nrmf6nknqd`, balance 0, PQC key NOT
  registered yet — exactly the unfunded state the runner's pre-flight
  expects, so `register-agent.mjs` and `agent-run.mjs` fail cleanly
  until the faucet claim lands.
- The runner was type- and syntax-checked but NOT run against the chain
  (no transaction was broadcast — the agent is unfunded, and the task
  forbade on-chain transactions). Its first live run is the human's,
  after funding.
- No secrets in the repo: `.env.local` (mode 600, gitignored) was never
  read for its values, never printed, and `git status` shows no secret
  files; the mnemonic appears in no committed file.

## What the human did

The human builder is **Toni (@agusher21)**. His contributions, without
which the project could not exist:

- **The idea.** The human picked the third project ("gas ai agents") and
  set the direction: a post-quantum allowance agent with a spending
  policy, a scoped EVM window, and authenticated messaging.
- **The wallet and the keys.** The human holds his own QoreX wallet (the
  owner / treasury address) and its 24-word phrase. The agent's own
  testnet-only identity was generated by the AI's setup script at the
  human's direction; its mnemonic lives only in `.env.local`, and the AI
  never printed or copied it. The human funds the agent from the faucet
  himself.
- **Every signature and every funded step.** The AI cannot sign and ran
  no on-chain transaction for this project. The faucet claim, the PQC
  key registration, and the first agent run are all the human's taps.
- **Deployment and fest submission.** The human imports the repo to
  Vercel himself and creates the fest project page from his own
  signed-in session at build.qorechain.io. (The fest form does not save
  drafts, so the fields in `FEST_FIELDS.md` are filled and submitted in
  one session.)
- **Direction and review.** The human directed the build in chat and
  reviews each deploy live on the demo URL before the next step.

## What the AI did NOT do

- Never held, saw, printed, or stored the agent mnemonic or any private
  key or seed phrase (its own or the human's).
- Never signed a transaction, claimed a faucet, deployed, or submitted a
  form on the human's behalf — those are all human taps.
- Never ran an on-chain transaction for this project: the runner is
  written and checked, but its first live run waits for the human's
  funding.
- Never invented a result: the activity log starts empty, mock-mode
  entries are labelled simulated, and the agent status shown live is
  whatever the chain actually reports.

## Summary

AI wrote ~100% of the code and docs and ran the build, on-chain state,
and secret-scan verification. The human chose the idea, owns the wallets
and every signature, funds the agent, deploys the demo, submits the fest
project, and directs and reviews each iteration. The project is a
genuine human–AI collaboration: the AI did the typing, the human made
the decisions and the signatures.
