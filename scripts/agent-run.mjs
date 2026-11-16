// Quantum Sentinel — the agent runner.
//   node scripts/agent-run.mjs
// Reads the agent identity from .env.local (never prints the mnemonic),
// the policy from scripts/policy.json and the task queue from
// scripts/tasks.json, then:
//   1. Fails cleanly if the agent is unfunded or its PQC key is not
//      registered (run node scripts/register-agent.mjs after funding).
//   2. Evaluates every task against the policy. REJECTED tasks are logged
//      with the rule that fired and NEVER executed.
//   3. For in-policy native tasks: simulates first, aborts the task if the
//      simulation fails, then broadcasts as a hybrid-signed native tx.
//   4. For the in-policy EVM task: opens a scoped EVM window (600 blocks /
//      5 txs / 1 QOR max) with a hybrid-signed native message, verifies the
//      window is live and covers the transfer + fees, then sends 0.01 QOR
//      inside it via viem to the owner's EVM address.
// Every decision is appended to public/agent-log.json (last 100 kept),
// which the demo UI reads. Testnet only; the agent holds faucet QOR.
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { openEvmWindowMsg } from "@qorechain/sdk";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  EVM_RPC_URL,
  OWNER_EVM,
  appendLog,
  connectAgentTx,
  dayUsageFromLog,
  deriveAgent,
  evaluatePolicy,
  explorerTxUrl,
  getBalanceUqor,
  getEvmWindow,
  getPqcStatus,
  loadEnvFile,
  loadJson,
  loadLog,
  qorToUqor,
  uqorToQor,
} from "./common.mjs";

const MEMO_TAG = "Quantum Sentinel";
const MSG_SEND_TYPE_URL = "/cosmos.bank.v1beta1.MsgSend";

const qoreEvmChain = defineChain({
  id: 9800,
  name: "QoreChain Testnet EVM",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [EVM_RPC_URL] } },
});

function fail(message) {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

const env = loadEnvFile();
const policy = loadJson("scripts/policy.json");
const tasks = loadJson("scripts/tasks.json");
const { unified, pqcKeypair } = await deriveAgent(env);
const agent = unified.cosmos;

console.log(`Quantum Sentinel — agent ${agent} (EVM ${unified.evm})`);

// --- Pre-flight: balance + PQC registration -------------------------------
const balance = await getBalanceUqor(agent);
console.log(`Balance: ${uqorToQor(balance)} QOR`);
if (balance === 0n) {
  fail(
    `agent unfunded — claim the faucet first (100 QOR to ${agent} at https://dashboard.qorechain.io/faucet), then run node scripts/register-agent.mjs`,
  );
}
const pqc = await getPqcStatus(agent);
if (!pqc.registered) {
  fail(
    "agent PQC key not registered — run node scripts/register-agent.mjs first (it registers the ML-DSA-87 key on chain).",
  );
}
console.log(
  `PQC key registered (algorithm ${pqc.algorithmId ?? "?"}). Policy: max ${policy.maxQorPerTx} QOR/tx, ${policy.maxQorPerDay} QOR/day, ${policy.maxTxCountPerDay} txs/day, whitelist ${policy.whitelist.join(", ")}.`,
);

// Hybrid client: every transaction from here is secp256k1 + ML-DSA-87.
const tx = await connectAgentTx(unified, pqcKeypair, true);

const usage = dayUsageFromLog(loadLog());
const summary = { executed: 0, rejected: 0, failed: 0 };

function logDecision(entry) {
  appendLog(entry);
  const mark =
    entry.decision === "EXECUTED"
      ? "✅ EXECUTED"
      : entry.decision === "REJECTED"
        ? "⛔ REJECTED"
        : "❌ FAILED";
  console.log(`  ${mark} ${entry.taskId}: ${entry.reason}`);
  if (entry.txHash) console.log(`     tx: ${explorerTxUrl(entry.txHash)}`);
}

function buildMsgSend(to, amountQor) {
  return {
    typeUrl: MSG_SEND_TYPE_URL,
    value: MsgSend.encode({
      fromAddress: agent,
      toAddress: to,
      amount: [{ denom: "uqor", amount: qorToUqor(amountQor) }],
    }).finish(),
  };
}

async function runNativeTask(task) {
  const msg = buildMsgSend(task.to, task.amountQor);
  let gas;
  try {
    gas = await tx.simulate([msg]);
  } catch (err) {
    logDecision({
      taskId: task.id,
      decision: "FAILED",
      lane: "native",
      to: task.to,
      amountQor: task.amountQor,
      reason: `Simulation failed, aborting (no tx sent): ${err instanceof Error ? err.message : String(err)}`,
    });
    summary.failed += 1;
    return;
  }
  const result = await tx.bankSend(
    task.to,
    [{ denom: "uqor", amount: qorToUqor(task.amountQor) }],
    { fee: "auto", memo: `${MEMO_TAG} ${task.id}` },
  );
  if (result.code !== 0) {
    logDecision({
      taskId: task.id,
      decision: "FAILED",
      lane: "native",
      to: task.to,
      amountQor: task.amountQor,
      reason: `Broadcast returned code ${result.code} (simulated gas ${gas}).`,
      txHash: result.transactionHash,
    });
    summary.failed += 1;
    return;
  }
  usage.spentQorToday += task.amountQor;
  usage.txCountToday += 1;
  summary.executed += 1;
  logDecision({
    taskId: task.id,
    decision: "EXECUTED",
    lane: "native",
    to: task.to,
    amountQor: task.amountQor,
    reason: `In policy: whitelisted, ${task.amountQor} ≤ ${policy.maxQorPerTx} QOR/tx, hybrid-signed (simulated gas ${gas}).`,
    txHash: result.transactionHash,
  });
}

async function runEvmTask(task) {
  // 1. Open the scoped window with a hybrid-signed native message.
  const windowMsg = openEvmWindowMsg({
    sender: agent,
    blocks: policy.evmWindow.blocks,
    maxTxs: policy.evmWindow.maxTxs,
    maxValue: qorToUqor(policy.evmWindow.maxValueQor),
  });
  let gas;
  try {
    gas = await tx.simulate([windowMsg]);
  } catch (err) {
    logDecision({
      taskId: task.id,
      decision: "FAILED",
      lane: "evm",
      to: task.to,
      amountQor: task.amountQor,
      reason: `Window-open simulation failed, aborting (no tx sent): ${err instanceof Error ? err.message : String(err)}`,
    });
    summary.failed += 1;
    return;
  }
  const open = await tx.signAndBroadcast(
    [windowMsg],
    "auto",
    `${MEMO_TAG} open EVM window ${task.id}`,
  );
  if (open.code !== 0) {
    logDecision({
      taskId: task.id,
      decision: "FAILED",
      lane: "evm",
      to: task.to,
      amountQor: task.amountQor,
      reason: `Window-open tx returned code ${open.code} (simulated gas ${gas}).`,
      txHash: open.transactionHash,
    });
    summary.failed += 1;
    return;
  }
  console.log(`     window opened: ${explorerTxUrl(open.transactionHash)}`);

  // 2. Verify the window is live and covers value + fees. Opening the
  //    window advanced the EVM nonce — the EVM tx is signed after this.
  const window = await getEvmWindow(agent);
  if (!window.found || !window.live) {
    logDecision({
      taskId: task.id,
      decision: "FAILED",
      lane: "evm",
      to: task.to,
      amountQor: task.amountQor,
      reason: "Window-open tx landed but the window is not live — no EVM tx sent.",
      txHash: open.transactionHash,
    });
    summary.failed += 1;
    return;
  }

  // 3. Send 0.01 QOR inside the window via viem.
  const account = privateKeyToAccount(unified.privateKey);
  const wallet = createWalletClient({
    account,
    chain: qoreEvmChain,
    transport: http(EVM_RPC_URL),
  });
  const publicClient = createPublicClient({
    chain: qoreEvmChain,
    transport: http(EVM_RPC_URL),
  });
  const valueWei = parseEther(String(task.amountQor));
  const gasLimit = 21000n;
  let feePerGas;
  let priorityFee;
  try {
    const fees = await publicClient.estimateFeesPerGas();
    feePerGas = fees.maxFeePerGas;
    priorityFee = fees.maxPriorityFeePerGas;
  } catch {
    feePerGas = await publicClient.getGasPrice();
    priorityFee = undefined;
  }
  // Window cost in uqor, rounding up (1 uqor = 10^12 wei): value + max fee.
  const costUqor = (valueWei + gasLimit * feePerGas + 999_999_999_999n) / 1_000_000_000_000n;
  if (costUqor > window.remainingValue) {
    logDecision({
      taskId: task.id,
      decision: "FAILED",
      lane: "evm",
      to: task.to,
      amountQor: task.amountQor,
      reason: `Window remaining value (${uqorToQor(window.remainingValue)} QOR) does not cover this transfer + max fees (${uqorToQor(costUqor)} QOR) — no EVM tx sent.`,
      txHash: open.transactionHash,
    });
    summary.failed += 1;
    return;
  }
  const evmHash = await wallet.sendTransaction({
    to: task.to,
    value: valueWei,
    gas: gasLimit,
    maxFeePerGas: feePerGas,
    ...(priorityFee !== undefined
      ? { maxPriorityFeePerGas: priorityFee }
      : {}),
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: evmHash,
    timeout: 120_000,
  });
  if (receipt.status !== "success") {
    logDecision({
      taskId: task.id,
      decision: "FAILED",
      lane: "evm",
      to: task.to,
      amountQor: task.amountQor,
      reason: `EVM transfer mined but FAILED (status ${receipt.status}). Window-open tx ${open.transactionHash} still stands.`,
      txHash: evmHash,
    });
    summary.failed += 1;
    return;
  }
  usage.spentQorToday += task.amountQor;
  usage.txCountToday += 1;
  summary.executed += 1;
  logDecision({
    taskId: task.id,
    decision: "EXECUTED",
    lane: "evm",
    to: task.to,
    amountQor: task.amountQor,
    reason: `In policy: whitelisted EVM target, ${task.amountQor} QOR inside open window (${policy.evmWindow.blocks} blocks / ${policy.evmWindow.maxTxs} txs / ${policy.evmWindow.maxValueQor} QOR; window-open tx ${open.transactionHash}).`,
    txHash: evmHash,
  });
}

// --- Task queue -------------------------------------------------------------
for (const task of tasks) {
  console.log(`\nTask ${task.id}: ${task.amountQor} QOR via ${task.lane} → ${task.to}`);
  const decision = evaluatePolicy(policy, task, usage);
  if (!decision.allow) {
    summary.rejected += 1;
    logDecision({
      taskId: task.id,
      decision: "REJECTED",
      lane: task.lane,
      to: task.to,
      amountQor: task.amountQor,
      reason: `REJECTED by rule ${decision.rule}: ${decision.reason}`,
    });
    continue;
  }
  try {
    if (task.lane === "native") await runNativeTask(task);
    else if (task.lane === "evm") await runEvmTask(task);
    else throw new Error(`Unknown lane "${task.lane}"`);
  } catch (err) {
    summary.failed += 1;
    logDecision({
      taskId: task.id,
      decision: "FAILED",
      lane: task.lane,
      to: task.to,
      amountQor: task.amountQor,
      reason: `Unexpected error, no further action for this task: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

tx.disconnect();
const balanceAfter = await getBalanceUqor(agent);
console.log(
  `\nDone: ${summary.executed} executed, ${summary.rejected} rejected, ${summary.failed} failed. Balance now ${uqorToQor(balanceAfter)} QOR. Log: public/agent-log.json`,
);
