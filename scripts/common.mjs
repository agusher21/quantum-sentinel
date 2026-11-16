// Quantum Sentinel — shared helpers for the offline runner scripts.
// These scripts hold the agent's testnet-only key (from .env.local) and are
// NEVER run in a browser. The mnemonic is read here and never printed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  deriveUnifiedAccount,
  derivePqcCanonical,
  fetchPqcStatus,
  fetchEvmWindow,
} from "@qorechain/sdk";

export const REST_URL = "https://api-testnet.qore.host";
export const RPC_URL = "https://rpc-testnet.qore.host";
export const EVM_RPC_URL = "https://evm-testnet.qore.host";
export const EXPLORER_HOME = "https://explore.qore.network";
export const OWNER_QOR1 = "qor1ntpfg4zpxxkpwzwrh0uwdqqyz36lqnmp8nmpz0";
export const OWNER_EVM = "0x9ac294544131ac1709c3bbf8e680041475f04f61";

const ROOT = new URL("..", import.meta.url);

/** Parse a KEY=VALUE .env file (quotes stripped, # comments ignored). */
export function loadEnvFile(path = new URL("../.env.local", import.meta.url)) {
  if (!existsSync(path)) {
    throw new Error(
      ".env.local not found — run `node scripts/setup-agent.mjs` first (once).",
    );
  }
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function loadJson(relPath) {
  return JSON.parse(readFileSync(new URL(relPath, ROOT), "utf8"));
}

export function explorerTxUrl(txHash) {
  const hex = txHash.startsWith("0x") ? txHash.slice(2) : txHash;
  return `${EXPLORER_HOME}/tx/${hex}`;
}

/**
 * Derive the agent identity from the mnemonic. Verifies the derived qor1
 * address matches AGENT_ADDRESS in .env.local, so a wrong/rotated .env
 * fails loudly instead of spending from an unexpected account.
 * Returns { unified, pqcKeypair } — the caller must never log these secrets.
 */
export async function deriveAgent(env) {
  const mnemonic = env.AGENT_MNEMONIC;
  if (!mnemonic) throw new Error(".env.local has no AGENT_MNEMONIC.");
  const unified = await deriveUnifiedAccount(mnemonic, 0);
  if (env.AGENT_ADDRESS && unified.cosmos !== env.AGENT_ADDRESS) {
    throw new Error(
      `Derived agent address ${unified.cosmos} does not match AGENT_ADDRESS ${env.AGENT_ADDRESS} in .env.local — refusing to run.`,
    );
  }
  if (env.AGENT_EVM_ADDRESS && unified.evm !== env.AGENT_EVM_ADDRESS) {
    throw new Error(
      `Derived agent EVM address ${unified.evm} does not match AGENT_EVM_ADDRESS in .env.local — refusing to run.`,
    );
  }
  const pqcKeypair = derivePqcCanonical(unified.cosmos, mnemonic);
  return { unified, pqcKeypair };
}

/** uqor balance of an address over REST (direct Node fetch, no CORS issue). */
export async function getBalanceUqor(address) {
  const res = await fetch(
    `${REST_URL}/cosmos/bank/v1beta1/balances/${address}?pagination.limit=100`,
  );
  if (!res.ok) {
    throw new Error(`Balance read failed: REST ${res.status} for ${address}`);
  }
  const data = await res.json();
  const row = (data.balances ?? []).find((b) => b.denom === "uqor");
  return row ? BigInt(row.amount) : 0n;
}

export function uqorToQor(uqor) {
  const v = BigInt(uqor);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function qorToUqor(qor) {
  const [whole = "0", frac = ""] = String(qor).split(".");
  return (BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6) || "0")).toString();
}

export async function getPqcStatus(address) {
  return fetchPqcStatus({ rest: REST_URL, address });
}

export async function getEvmWindow(address) {
  return fetchEvmWindow({ rest: REST_URL, address });
}

// ---------------------------------------------------------------------------
// Policy evaluation — the Node mirror of src/policy.ts (same rules, same order)
// ---------------------------------------------------------------------------

export function evaluatePolicy(policy, task, usage, now = new Date()) {
  if (!task.to || typeof task.to !== "string") {
    return { allow: false, rule: "destination", reason: "No destination address given." };
  }
  if (!(task.amountQor > 0) || !Number.isFinite(task.amountQor)) {
    return { allow: false, rule: "amount", reason: `Amount must be greater than 0 QOR (got ${task.amountQor}).` };
  }
  const whitelisted =
    policy.whitelist.includes(task.to) ||
    (task.lane === "evm" && task.to.toLowerCase() === OWNER_EVM.toLowerCase());
  if (!whitelisted) {
    return {
      allow: false,
      rule: "whitelist",
      reason: `${task.to} is not on the policy whitelist (${policy.whitelist.join(", ")}).`,
    };
  }
  if (task.amountQor > policy.maxQorPerTx) {
    return {
      allow: false,
      rule: "maxQorPerTx",
      reason: `${task.amountQor} QOR exceeds the per-transaction cap of ${policy.maxQorPerTx} QOR.`,
    };
  }
  if (usage.spentQorToday + task.amountQor > policy.maxQorPerDay) {
    return {
      allow: false,
      rule: "maxQorPerDay",
      reason: `${usage.spentQorToday} QOR already spent today + ${task.amountQor} QOR would exceed the daily cap of ${policy.maxQorPerDay} QOR.`,
    };
  }
  if (usage.txCountToday + 1 > policy.maxTxCountPerDay) {
    return {
      allow: false,
      rule: "maxTxCountPerDay",
      reason: `${usage.txCountToday} transactions already executed today; the daily limit is ${policy.maxTxCountPerDay}.`,
    };
  }
  const hourUtc = now.getUTCHours() + now.getUTCMinutes() / 60;
  const [start, end] = policy.activeHoursUtc;
  if (hourUtc < start || hourUtc >= end) {
    return {
      allow: false,
      rule: "activeHoursUtc",
      reason: `Outside active hours (${start}:00–${end}:00 UTC; now ${now.toISOString().slice(11, 16)} UTC).`,
    };
  }
  if (task.lane === "evm" && task.amountQor > policy.evmWindow.maxValueQor) {
    return {
      allow: false,
      rule: "evmWindow.maxValue",
      reason: `${task.amountQor} QOR exceeds the EVM window's max value of ${policy.evmWindow.maxValueQor} QOR.`,
    };
  }
  return { allow: true };
}

// ---------------------------------------------------------------------------
// Activity log — public/agent-log.json, the file the demo UI reads
// ---------------------------------------------------------------------------

const LOG_PATH = new URL("../public/agent-log.json", import.meta.url);

export function loadLog() {
  try {
    const parsed = JSON.parse(readFileSync(LOG_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendLog(entry) {
  const log = loadLog();
  log.push({ ...entry, timestamp: Date.now(), mock: false });
  const trimmed = log.slice(-100);
  writeFileSync(LOG_PATH, JSON.stringify(trimmed, null, 2) + "\n");
  return trimmed;
}

function isTodayUtc(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

/** Today's executed spend, from the log — the daily caps count real runs. */
export function dayUsageFromLog(log = loadLog()) {
  const today = log.filter(
    (e) => e.decision === "EXECUTED" && isTodayUtc(e.timestamp),
  );
  return {
    spentQorToday: today.reduce((sum, e) => sum + e.amountQor, 0),
    txCountToday: today.length,
  };
}
