// Quantum Sentinel — QoreChain helpers.
// Sources:
// - SDK quickstart: https://docs.qorechain.io/sdk/quickstart
//   (createClient defaults to testnet qorechain-diana; every native QOR
//   transfer must carry a hybrid secp256k1 + ML-DSA-87 signature; QOR has
//   10^6 uqor.)
// - QoreX integrations: https://docs.qorechain.io/developer-tools/qorex-integrations
//   (window.qorex.native is a Keplr-pattern provider; dApps send messages via
//   signAndBroadcast, QoreX adds the ML-DSA-87 layer and broadcasts;
//   signDirect does NOT add the layer — never use it here.)
// - EVM authorisation windows: @qorechain/evm/window — an EVM tx is admitted
//   only from an account with a registered ML-DSA-87 key AND a live window
//   opened by a hybrid-signed native MsgOpenEVMWindow. Opening a window
//   advances the account's EVM nonce: open, then read the nonce, then sign.
//   maxValue bounds value PLUS the maximum fee of every admitted tx.

import {
  fetchEvmWindow as sdkFetchEvmWindow,
  fetchPqcStatus as sdkFetchPqcStatus,
} from "@qorechain/sdk";
import {
  getQorexNative,
  hasCapability,
  type QorexNativeProvider,
} from "@qorechain/qorex-types";
import type { EvmWindow } from "@qorechain/sdk";
import { createClient, type QoreChainClient } from "@qorechain/sdk";

import { OWNER_EVM, OWNER_QOR1 } from "./policy.js";

export { OWNER_EVM, OWNER_QOR1 };

export const CHAIN_ID = "qorechain-diana";
export const CHAIN_NAME = "QoreChain Testnet (qorechain-diana)";
export const EVM_CHAIN_ID = 9800;
export const REST_PROXY_PATH = "/lcd"; // Vite proxies /lcd -> https://api-testnet.qore.host
export const REST_URL = "https://api-testnet.qore.host";
export const EVM_RPC_URL = "https://evm-testnet.qore.host";
export const EXPLORER_HOME = "https://explore.qore.network";
export const FAUCET_URL = "https://dashboard.qorechain.io/faucet";
export const FEST_URL = "https://build.qorechain.io";

/**
 * The Sentinel agent — a FRESH testnet-only account created for this project
 * (scripts/setup-agent.mjs). It holds only faucet QOR. The demo never signs
 * as the agent from the browser; only the offline runner (scripts/) holds
 * its key, and only ever sends TO the owner's address.
 */
export const AGENT_ADDRESS =
  "qor1zr9ev820wyrw300yy9ke99x2xuq3nrmf6nknqd";
export const AGENT_EVM_ADDRESS =
  "0x10cB961d4F7106E8BdE4216d9294Ca3701198F69";
/** ML-DSA-87 public-key fingerprint (first 32 hex of sha256 of the 2592-byte key). */
export const AGENT_PQC_FINGERPRINT = "25d14ba1e4faaebe8a7c2147ea60141a";

/** 1 QOR = 1,000,000 uqor on the native lane. */
export function qorToUqor(qor: string): string {
  const [whole = "0", frac = ""] = qor.trim().split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > 6) {
    throw new Error("Amount must be a number with at most 6 decimals.");
  }
  const padded = (frac + "000000").slice(0, 6);
  const base = BigInt(whole) * 1_000_000n + BigInt(padded || "0");
  if (base <= 0n) throw new Error("Amount must be greater than 0.");
  return base.toString();
}

export function uqorToQor(uqor: string | number | bigint): string {
  const v = BigInt(uqor);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Strict-ish bech32 check for a native QoreChain address (qor1 + 38 chars). */
export function isValidQorAddress(address: string): boolean {
  return /^qor1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/.test(address.trim());
}

export function isValidEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address.trim());
}

export function explorerTxUrl(txHash: string): string {
  const hex = txHash.startsWith("0x") ? txHash.slice(2) : txHash;
  return `${EXPLORER_HOME}/tx/${hex}`;
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_HOME}/address/${address}`;
}

/** REST URL that shows a committed tx as JSON (standard Cosmos LCD route). */
export function txRestUrl(txHash: string): string {
  return `${REST_URL}/cosmos/tx/v1beta1/txs/${txHash}`;
}

export function shortAddress(address: string): string {
  if (address.startsWith("0x")) return `${address.slice(0, 6)}…${address.slice(-4)}`;
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// Live agent status (read-only, through the /lcd proxy)
// ---------------------------------------------------------------------------

export interface AgentStatus {
  balanceUqor: string | null; // null when the read failed
  pqcRegistered: boolean | null; // null when unknown
  pqcAlgorithmId?: number;
  window: EvmWindow | null; // null when the read failed
  error?: string;
}

async function fetchBalanceUqor(
  client: QoreChainClient,
  address: string,
): Promise<string | null> {
  try {
    const res = await client.rest.getAllBalances(address);
    const qor = (
      res.balances as Array<{ denom: string; amount: string }>
    ).find((b) => b.denom === "uqor");
    return qor ? qor.amount : "0";
  } catch {
    return null;
  }
}

export async function fetchAgentStatus(
  client: QoreChainClient,
): Promise<AgentStatus> {
  const [balanceUqor, pqc, window] = await Promise.all([
    fetchBalanceUqor(client, AGENT_ADDRESS),
    sdkFetchPqcStatus({ rest: REST_PROXY_PATH, address: AGENT_ADDRESS })
      .then((s) => ({ registered: s.registered, algorithmId: s.algorithmId }))
      .catch(() => null),
    sdkFetchEvmWindow({ rest: REST_PROXY_PATH, address: AGENT_ADDRESS }).catch(
      () => null,
    ),
  ]);
  return {
    balanceUqor,
    pqcRegistered: pqc ? pqc.registered : null,
    pqcAlgorithmId: pqc?.algorithmId,
    window,
  };
}

/** Simulated agent status for ?mock=1 — clearly labelled, never on chain. */
export function mockAgentStatus(): AgentStatus {
  return {
    balanceUqor: "100000000", // 100 QOR
    pqcRegistered: true,
    pqcAlgorithmId: 1,
    window: {
      found: true,
      live: true,
      openedHeight: 10180000n,
      expiryHeight: 10180600n,
      maxTxs: 5n,
      usedTxs: 1n,
      maxValue: 1000000n,
      usedValue: 12300n,
      remainingBlocks: 512n,
      remainingTxs: 4n,
      remainingValue: 987700n,
      nativeOnly: false,
      allowedTargets: [],
    },
  };
}

// ---------------------------------------------------------------------------
// QoreX wallet (visitor's own wallet — the demo never signs as the agent)
// ---------------------------------------------------------------------------

export function getNativeProvider(): QorexNativeProvider | null {
  return getQorexNative() ?? null;
}

export function isQorexInstalled(): boolean {
  return getNativeProvider() !== null;
}

export async function connectQorex(): Promise<string> {
  const native = getNativeProvider();
  if (!native) {
    throw new Error(
      "QoreX is not installed in this browser. Install the QoreX extension " +
        "(Chrome/Firefox) or open this page in the QoreX app's dApp browser, " +
        "switch it to Testnet, then try again.",
    );
  }
  if (!hasCapability(native, "signAndBroadcast")) {
    throw new Error(
      "This QoreX build does not expose signAndBroadcast. Update QoreX to the latest store version and try again.",
    );
  }
  // Throws "QoreX: unsupported chain" if the wallet is not on qorechain-diana.
  await native.enable(CHAIN_ID);
  const key = await native.getKey(CHAIN_ID);
  const address = (key as { bech32Address?: string }).bech32Address;
  if (!address || !isValidQorAddress(address)) {
    throw new Error("QoreX returned an unexpected address. Try reconnecting.");
  }
  return address;
}

export async function fetchVisitorBalance(
  client: QoreChainClient,
  address: string,
): Promise<string | null> {
  return fetchBalanceUqor(client, address);
}

export function createRestClient(): QoreChainClient {
  return createClient({
    network: "testnet",
    endpoints: { rest: REST_PROXY_PATH },
  });
}

// ---------------------------------------------------------------------------
// Activity log — real agent runs (public/agent-log.json, written by the runner)
// ---------------------------------------------------------------------------

export interface AgentLogEntry {
  taskId: string;
  /** "EXECUTED" | "REJECTED" | "FAILED" */
  decision: string;
  lane: "native" | "evm";
  to: string;
  amountQor: number;
  reason: string;
  txHash?: string;
  timestamp: number; // ms since epoch
  /** True for ?mock=1 simulated entries: NOT on chain. */
  mock?: boolean;
}

export async function loadAgentLog(): Promise<AgentLogEntry[]> {
  try {
    const res = await fetch("/agent-log.json", { cache: "no-store" });
    if (!res.ok) return [];
    const parsed: unknown = await res.json();
    return Array.isArray(parsed) ? (parsed as AgentLogEntry[]) : [];
  } catch {
    return [];
  }
}

/** Simulated log entries for ?mock=1 — the shape the real runner writes. */
export function mockAgentLog(): AgentLogEntry[] {
  const now = Date.now();
  return [
    {
      taskId: "evm-transfer",
      decision: "EXECUTED",
      lane: "evm",
      to: OWNER_EVM,
      amountQor: 0.01,
      reason: "In policy: whitelisted, 0.01 ≤ 0.1 QOR/tx, inside open EVM window (600 blocks / 5 txs / 1 QOR).",
      txHash: "A1B2C3D4E5F60718293A4B5C6D7E8F90123456789ABCDEF0123456789ABCDEF0",
      timestamp: now - 1000 * 60 * 42,
      mock: true,
    },
    {
      taskId: "native-send",
      decision: "EXECUTED",
      lane: "native",
      to: OWNER_QOR1,
      amountQor: 0.05,
      reason: "In policy: whitelisted, 0.05 ≤ 0.1 QOR/tx, hybrid-signed.",
      txHash: "B2C3D4E5F60718293A4B5C6D7E8F90123456789ABCDEF0123456789ABCDEF0A1",
      timestamp: now - 1000 * 60 * 55,
      mock: true,
    },
    {
      taskId: "oversize-send",
      decision: "REJECTED",
      lane: "native",
      to: OWNER_QOR1,
      amountQor: 5,
      reason: "REJECTED by rule maxQorPerTx: 5 QOR exceeds the per-transaction cap of 0.1 QOR.",
      timestamp: now - 1000 * 60 * 63,
      mock: true,
    },
    {
      taskId: "non-whitelisted-send",
      decision: "REJECTED",
      lane: "native",
      to: "qor1yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3z6t9806",
      amountQor: 0.05,
      reason: "REJECTED by rule whitelist: destination is not on the policy whitelist.",
      timestamp: now - 1000 * 60 * 71,
      mock: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Authenticated messaging demo — ML-DSA-87 sign/verify (demo-only keypair)
// ---------------------------------------------------------------------------

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function truncateHex(hex: string, head = 16, tail = 8): string {
  if (hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
