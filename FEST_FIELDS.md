# FEST_FIELDS.md — Quantum Sentinel (build.qorechain.io project form)

Exact field contents for the Quantum Sentinel project page. The fest form
does NOT save drafts — fill every field in ONE session from Toni's signed-in
@agusher21 account, then click Create project.

## Fields

- **Project name:** Quantum Sentinel
- **Category:** Post-Quantum AI Agents (team size 1, solo)
- **Region:** Asia-Pacific
- **Tagline (≤ 140 chars):**
  A post-quantum allowance agent: it only spends inside a policy you can read, every action hybrid-signed.
- **GitHub repository:** https://github.com/agusher21/quantum-sentinel
- **Live demo URL:** https://quantum-sentinel.vercel.app
  (NOTE: if the bare Vercel name is taken, the deployed URL may gain a
  suffix like -three — verify the live URL before submitting and use the
  exact one that loads.)
- **Video URL:** https://quantum-sentinel.vercel.app/demo-video.mp4
  (recorded 2026-11-16, 66.5 s, 1280×720 — scripted screen capture of the
  demo in `?mock=1` mode: policy, ALLOW/REJECT playground, activity log,
  real in-browser ML-DSA-87 sign/verify + tamper rejection. The file is
  in the repo at `public/demo-video.mp4` and plays once the Vercel deploy
  is live. Mock status/log are labelled simulated on screen; no tx was
  signed or broadcast. Re-cut with real log entries after the first
  funded run if time allows — the mock cut is honest and submittable as
  is.)
- **Featured image:** upload `public/cover.jpg` (2048×1152, 16:9 JPG)
  (cover image will be added separately at `public/cover.jpg`)
- **Testnet address(es) used:** qor1zr9ev820wyrw300yy9ke99x2xuq3nrmf6nknqd
  (the Sentinel agent's own testnet-only account — EVM
  0x10cB961d4F7106E8BdE4216d9294Ca3701198F69; owner/treasury is
  qor1ntpfg4zpxxkpwzwrh0uwdqqyz36lqnmp8nmpz0)

## About

Quantum Sentinel is a post-quantum allowance agent on the QoreChain
testnet. It only moves testnet QOR inside a spending policy you can read:
at most 0.1 QOR per transaction, 0.5 QOR per day, 10 transactions per day,
only to a whitelisted destination (the owner's wallet), and only during
its active hours. For EVM work it first opens a scoped authorisation
window — 600 blocks, 5 transactions, 1 QOR maximum value — with a
hybrid-signed native message, then sends inside it. Every action is a
hybrid-signed transaction (secp256k1 + ML-DSA-87), and every agent
command is authenticated with an ML-DSA-87 signature: a tampered command
fails verification and is rejected. Out-of-policy tasks are rejected and
logged, never executed — the demo's activity log shows every decision
with its on-chain transaction, and its policy playground lets anyone try
a task and see the exact rule that allows or rejects it. Testnet only —
QOR here has no real value, and the agent holds only faucet funds.

## How it's made

Built with create-qorechain-dapp v0.14.0 (Vite + React + TypeScript),
@qorechain/sdk v0.14.0 and viem 2.57.20 on the qorechain-diana testnet.
The agent is a fresh testnet-only unified account (native qor1 + EVM 0x)
with a canonical address-bound ML-DSA-87 keypair
(`derivePqcCanonical`), registered on chain (classical
`MsgRegisterPQCKeyV2` + proof-of-possession, signed with the
eth-native signer). The offline runner (`scripts/agent-run.mjs`)
checks balance and PQC registration first, evaluates each task in
`scripts/tasks.json` against the policy in `scripts/policy.json`
(whitelist → per-tx cap → daily cap → daily tx count → active hours →
EVM window bound), simulates every in-policy transaction before
broadcasting, and sends native transfers as hybrid-signed txs through
the eth-native signer (`EthNativeSigner`, eth_secp256k1 scheme — the
agent is a unified account, so the classic cosmjs direct signer cannot
spend from it) and EVM transfers with viem inside a window opened by a
hybrid-signed `MsgOpenEVMWindow` (`openEvmWindowMsg`, verified live with
`fetchEvmWindow`). Every decision is appended to
`public/agent-log.json`, which the demo reads. The demo itself connects
to QoreX for the visitor's own wallet, reads live agent status over the
QoreChain REST API through a same-origin `/lcd` proxy (the public API
sends no CORS headers), and demonstrates ML-DSA-87 authenticated
messaging with a fresh demo-only keypair generated in the browser
(`generatePqcKeypair` / `pqcSign` / `pqcVerify`). A `?mock=1` mode
simulates the agent status and log for trying the UI without a wallet.

## Checklist before submitting

- [ ] Repo is public at https://github.com/agusher21/quantum-sentinel
- [ ] Demo live at https://quantum-sentinel.vercel.app (loads, cover shows)
      — verify the exact Vercel URL first; use the -three (or other suffix)
      URL if the bare name was taken
- [ ] Agent funded (2 QOR sent from Toni's main wallet 2026-11-16 —
      the faucet was rate-limited that day, 1 claim/24h per account;
      balance after first run 1.725082 QOR)
- [ ] PQC key registered: `node scripts/register-agent.mjs` run, verified
- [ ] First agent run done: `node scripts/agent-run.mjs` — native-send
      EXECUTED (hybrid-signed), oversize + non-whitelisted REJECTED,
      EVM transfer EXECUTED inside its window — all visible in the demo's
      activity log with tx links
- [ ] Video link opens and plays (`public/demo-video.mp4`, 66.5 s mock-mode
      cut recorded 2026-11-16; re-cut with real log entries after the first
      funded run if time allows)
- [ ] Cover uploaded from public/cover.jpg
