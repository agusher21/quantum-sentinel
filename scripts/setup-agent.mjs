// Quantum Sentinel — agent identity setup (run ONCE).
// Generates a FRESH testnet-only QoreChain account for the Sentinel agent:
// unified (native qor1 + EVM 0x) account + canonical ML-DSA-87 keypair.
// The mnemonic is written ONLY to .env.local (mode 0600, gitignored) and is
// NEVER printed. Only the public addresses are printed — fund the qor1
// address from the QoreChain faucet (100 QOR per claim).
// Usage: node scripts/setup-agent.mjs
import { writeFileSync, existsSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  generateMnemonic,
  deriveUnifiedAccount,
  derivePqcCanonical,
} from "@qorechain/sdk";

const ENV_PATH = new URL("../.env.local", import.meta.url);

if (existsSync(ENV_PATH)) {
  console.error(
    "REFUSING: .env.local already exists — an agent identity is already set up. Delete it only if you mean to rotate the agent (old address is then abandoned).",
  );
  process.exit(1);
}

const mnemonic = generateMnemonic();
const unified = await deriveUnifiedAccount(mnemonic, 0);
// UnifiedAccount shape: { cosmos, evm, ... } — print keys, never secrets.
const cosmos = unified.cosmos ?? unified.address ?? unified.bech32Address;
const evm = unified.evm ?? unified.evmAddress;
if (typeof cosmos !== "string" || !cosmos.startsWith("qor1")) {
  console.error("Unexpected UnifiedAccount shape:", Object.keys(unified));
  process.exit(1);
}
if (typeof evm !== "string" || !evm.startsWith("0x")) {
  console.error("Unexpected UnifiedAccount shape (no EVM address):", Object.keys(unified));
  process.exit(1);
}

const pqc = derivePqcCanonical(cosmos, mnemonic);
const pqcPubHex = Buffer.from(pqc.publicKey).toString("hex");
const pqcFingerprint = createHash("sha256")
  .update(Buffer.from(pqc.publicKey))
  .digest("hex")
  .slice(0, 32);

const env = [
  "# Quantum Sentinel agent identity — TESTNET ONLY (qorechain-diana).",
  "# NEVER commit this file. NEVER use this key on mainnet or for real funds.",
  "# The agent holds only faucet QOR; rotate by deleting this file and re-running setup-agent.mjs.",
  `AGENT_MNEMONIC="${mnemonic}"`,
  `AGENT_ADDRESS=${cosmos}`,
  `AGENT_EVM_ADDRESS=${evm}`,
  `AGENT_PQC_PUBLIC_KEY_HEX=${pqcPubHex}`,
  "",
].join("\n");
writeFileSync(ENV_PATH, env, { mode: 0o600 });
chmodSync(ENV_PATH, 0o600);

console.log("Agent identity created (testnet only).");
console.log(`  qor1 address : ${cosmos}`);
console.log(`  EVM address  : ${evm}`);
console.log(`  PQC pubkey fp: ${pqcFingerprint}… (ML-DSA-87, ${pqc.publicKey.length} bytes)`);
console.log("  FUND IT: claim the faucet (dashboard.qorechain.io/faucet, 100 QOR) to the qor1 address above,");
console.log("  then run: node scripts/register-agent.mjs");
