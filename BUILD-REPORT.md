# BUILD-REPORT — Quantum Sentinel

**Project:** Quantum Sentinel — a post-quantum allowance agent
**Category:** Post-Quantum AI Agents (solo, team size 1)
**Repo:** https://github.com/agusher21/quantum-sentinel (public, MIT)
**Commit:** `7b00a13` — `7b00a1324cc0a2cace456a4fb1722e66b94f1541`
**Built:** 2026-11-16. Operative deadline: **25 Nov 2026, 08:00 UTC**
  (rules page says submissions close 2 Dec 2026 23:59 UTC; the project-form
  banner said 25 Nov 08:00 UTC — 25 Nov is treated as operative.)

## Category requirements — verified live

Re-read 2026-11-16 from https://build.qorechain.io/rules (crawled 08:51 UTC):
- Post-Quantum AI Agents: teams **1–4** (solo allowed). ✓
- Every project needs: public GitHub repo, README, featured image,
  video ≤ 3 min, QoreChain testnet address(es) it uses. ✓
- Licence MIT or Apache-2.0, licence file in the repo. ✓ (MIT)
- "You may build more than one project." ✓ (3rd project after Tip Jar + Dice)
- The live rules page does **not** restate the per-category technical bar
  (scoped EVM window, tx/value/duration/target limits, smart-account
  spending rules, authenticated messaging) — that bar was verified from
  the site's category description earlier on 2026-11-16 and is implemented
  as described below. No contradiction found.

## What was built

- **Demo UI** (Vite + React + TS, create-qorechain-dapp v0.14.0 output,
  @qorechain/sdk 0.14.0): editable spending policy (max QOR/tx, max QOR/day,
  whitelisted destinations, active UTC window, max tx count, EVM-window
  bounds), live agent status, policy playground that returns ALLOW or
  REJECT with the exact rule, activity log with on-chain tx links,
  ML-DSA-87 authenticated-messaging demo (real in-browser keypair:
  sign → pqcVerify OK, tamper the payload → pqcVerify FAILS), QoreX
  connect, `?mock=1` mode (full UI without a wallet; everything mock is
  labelled simulated).
- **Agent runner** (`scripts/`): `register-agent.mjs` (idempotent
  `ensurePqcRegistered`), `agent-run.mjs` (evaluates the task queue against
  `scripts/policy.json`, simulates, broadcasts in-policy tasks as
  hybrid-signed native txs, opens a scoped EVM window
  `MsgOpenEVMWindow` and sends EVM transfers only inside it, logs every
  decision — executed or rejected — to `public/agent-log.json`).
- **Policy defaults:** max 0.1 QOR/tx, 0.5 QOR/day, 10 txs/day, active
  00:00–23:59 UTC, whitelist = owner only, EVM window 600 blocks / 5 txs /
  1 QOR. Task queue: (a) native-send 0.05 QOR → owner, EXECUTE; (b)
  oversize-send 5 QOR, REJECT (maxQorPerTx); (c) non-whitelisted-send
  0.05 QOR, REJECT (whitelist); (d) evm-transfer 0.01 QOR → owner EVM,
  EXECUTE inside the window. Decisions verified offline: ALLOW /
  REJECT[maxQorPerTx] / REJECT[whitelist] / ALLOW.
- **Cover:** `public/cover.jpg`, 2048×1152, 16:9.
- **Video:** `public/demo-video.mp4` — 66.5 s, 1280×720, H.264, 2,047,793
  bytes, ≤ 3 min ✓. Scripted screen capture (puppeteer + ffmpeg, no AI
  video generation) of the demo in `?mock=1` mode: hero, agent status,
  policy, ALLOW + 2 REJECT playground runs, activity log, real ML-DSA-87
  sign/verify + tamper rejection, end card. Mock status/log are labelled
  simulated on screen; **no transaction was signed or broadcast** for the
  video. Reproducible via `video/driver.cjs`, `video/record.sh`,
  `video/post.sh`. A re-cut with real log entries is possible after the
  first funded run; the mock cut is honest and submittable as is.
- **Docs:** README.md, AI_USAGE.md (Best AI-Native Build eligibility),
  FEST_FIELDS.md (exact fest-form texts — do NOT create the fest page
  here; it needs Toni's signed-in browser session, and the form does not
  save drafts).

## Agent identity (testnet only)

- qor1: **`qor1zr9ev820wyrw300yy9ke99x2xuq3nrmf6nknqd`**
- EVM: **`0x10cB961d4F7106E8BdE4216d9294Ca3701198F69`**
- ML-DSA-87 pubkey fingerprint: `25d14ba1e4faaebe8a7c2147ea60141a…`
  (2,592 bytes, canonical derivation `derivePqcCanonical`)
- Mnemonic: **only** in `.env.local` (mode 600, gitignored, never
  committed, never printed). Required Vercel env vars are documented in
  the README (`AGENT_MNEMONIC` is server-side only — the browser demo
  never needs it).
- **NEVER used Toni's main wallet** (`qor1ntpfg…`) for the agent, and no
  seed phrase or private key was ever asked for.

## Verified on-chain (testnet, qorechain-diana)

- Agent account: **balance 0 QOR, PQC key NOT registered** (verified
  2026-11-16 ~15:53 WIB via LCD). Registration needs funding first.
- **No hybrid-signed tx from the agent yet** — the agent is unfunded.
  The task queue dry-runs fail cleanly at the unfunded pre-flight
  (exit 1, no tx broadcast).
- `npm run build` passes clean (14.9 s; chunk-size warning only, cosmetic).
  `npm run typecheck` passes.

## Bug found + fixed during video recording

`?mock=1` was broken when the testnet REST API was unreachable: the mock
effect seeded status/log at mount, but the live-load effects fired first
with a stale `mockOn=false` and overwrote them ("Balance: unavailable /
PQC unknown / window unavailable", empty log). Fixed by reading the
`?mock=1` param synchronously in the state initializers so the live loads
never fire in mock mode. **Verified live in headless Chrome with REST
unreachable:** Balance 100 QOR, PQC registered (algorithm 1), EVM window
LIVE, log 2 executed + 2 rejected, no error banner. Also fixed a float
display artifact (usage line showed `0.060000000000000005 QOR`, now `0.06`).

## What is NOT done — pending items

1. **Funding (needs Toni):** claim the faucet
   (dashboard.qorechain.io/faucet, 100 QOR per claim) to the agent qor1
   `qor1zr9ev820wyrw300yy9ke99x2xuq3nrmf6nknqd`.
2. **First real run (after funding):** `node scripts/register-agent.mjs`
   → `node scripts/agent-run.mjs` — expect: PQC registration tx +
   native-send 0.05 QOR EXECUTED (hybrid-signed), oversize + non-whitelisted
   REJECTED, EVM transfer 0.01 QOR EXECUTED inside its window. Record the
   tx hashes here and in the demo log.
3. **Vercel import (needs Toni's tap):** dashboard import of
   agusher21/quantum-sentinel; expected demo URL
   https://quantum-sentinel.vercel.app (may gain a suffix if the bare name
   is taken — verify the exact URL before the fest form). API route is
   403-blocked, so no automation was attempted.
4. **Fest project page (needs Toni's signed-in browser session):** exact
   texts in FEST_FIELDS.md. Form does NOT save drafts — fill in one session.
5. **Optional:** re-cut the demo video with real log entries after the
   funded run; tick the create-qorechain-dapp/SDK/QoreX kits if the
   project form offers them (same note as for Dice).

## Known caveats

- The live EVM transfer path is written but **untested on-chain** (first
  funded run proves it). The agent signs with its own key via TxClient /
  viem — the QoreX Account-16 problem does not apply (no QoreX EVM
  involvement for the agent).
- Window scope fields are deliberately not set (would be refused by a node
  below chain v3.2.3); target limiting is enforced by the policy whitelist
  instead (documented in the README).
- End-card URL `quantum-sentinel.vercel.app` is used as specified; the
  Vercel deployment does not exist yet (pending item 3).
