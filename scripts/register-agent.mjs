// Quantum Sentinel — register the agent's ML-DSA-87 key on chain.
// Run once, AFTER funding the agent from the faucet:
//   node scripts/register-agent.mjs
// Reads the agent identity from .env.local (never prints the mnemonic),
// connects a classical TxClient, and calls ensurePqcRegistered — which is
// idempotent: if the key is already registered it reports that and sends
// nothing. Then it verifies the registration with a fresh REST read.
// Fails cleanly with "agent unfunded — claim the faucet first" when the
// balance is 0, because registration costs gas the agent does not have.
import { createHash } from "node:crypto";
import { ensurePqcRegistered } from "@qorechain/sdk";
import {
  REST_URL,
  connectAgentTx,
  deriveAgent,
  explorerTxUrl,
  getBalanceUqor,
  getPqcStatus,
  loadEnvFile,
  uqorToQor,
} from "./common.mjs";

const env = loadEnvFile();
const { unified, pqcKeypair } = await deriveAgent(env);

const fingerprint = createHash("sha256")
  .update(Buffer.from(pqcKeypair.publicKey))
  .digest("hex")
  .slice(0, 32);
console.log(`Agent: ${unified.cosmos}`);
console.log(`  EVM: ${unified.evm}`);
console.log(
  `  PQC pubkey: ML-DSA-87, ${pqcKeypair.publicKey.length} bytes, fingerprint ${fingerprint}…`,
);

const balance = await getBalanceUqor(unified.cosmos);
console.log(`  Balance: ${uqorToQor(balance)} QOR`);
if (balance === 0n) {
  console.error(
    "\nAgent unfunded — claim the faucet first:\n" +
      `  https://dashboard.qorechain.io/faucet → 100 QOR to ${unified.cosmos}\n` +
      "Then re-run: node scripts/register-agent.mjs",
  );
  process.exit(1);
}

const statusBefore = await getPqcStatus(unified.cosmos);
console.log(
  `  PQC registered before: ${statusBefore.registered ? `yes (algorithm ${statusBefore.algorithmId ?? "?"})` : "no"}`,
);

// Classical client: the registration transaction itself stays classical;
// hybrid signing starts only after the key exists.
const tx = await connectAgentTx(unified, pqcKeypair, false);
const result = await ensurePqcRegistered(tx, { pqcKeypair, rest: REST_URL });
if (result.alreadyRegistered) {
  console.log("  Already registered — no transaction sent.");
} else {
  console.log(`  Registration tx: ${result.txHash}`);
  console.log(`  Explorer: ${explorerTxUrl(result.txHash)}`);
}

const statusAfter = await getPqcStatus(unified.cosmos);
if (!statusAfter.registered) {
  console.error("  VERIFY FAILED: PQC key still not registered after the run.");
  process.exit(1);
}
console.log(
  `  Verified: PQC key registered (algorithm ${statusAfter.algorithmId ?? "?"}).`,
);
console.log("  Next: node scripts/agent-run.mjs");
tx.disconnect();
