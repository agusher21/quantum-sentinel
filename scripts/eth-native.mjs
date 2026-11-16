// Quantum Sentinel — eth-native signing for the unified agent account.
//
// The agent is a UNIFIED account (address = keccak256(pubkey)[12:], see
// deriveUnifiedAccount). It MUST sign native txs with the eth_secp256k1
// scheme (keccak256 SignDoc hash + ethsecp256k1 pubkey type URL) via
// EthNativeSigner. The classic cosmjs direct signer
// (directSignerFromPrivateKey) derives a ripemd160 address from the same
// key and can NEVER spend from this account — that was the register-agent
// failure ("TxClient sender qor12hdw… is not the agent qor1zr9e…").
//
// Every broadcast here is simulate-first: the signed TxRaw is sent to the
// REST /cosmos/tx/v1beta1/simulate endpoint, and only a passing simulation
// (code 0, gas used > 0) proceeds to broadcast with gas = sim gas * 1.5 +
// headroom. A failed simulation aborts with no transaction sent.
//
// The agent's key material is read from .env.local only via deriveAgent()
// in common.mjs and is never printed here.
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  isUpgradeApplied,
  CHAIN_UPGRADE_V3_2_3,
  recommendedGasPriceUqor,
  signProofOfPossession,
} from "@qorechain/sdk";
import { REST_URL, RPC_URL } from "./common.mjs";

export const CHAIN_ID = "qorechain-diana";
const SIM_GAS_LIMIT = 500_000;
const GAS_MARGIN_NUM = 150n;
const GAS_MARGIN_DEN = 100n;
const GAS_HEADROOM = 10_000n;

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`REST ${res.status} ${url}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

/** On-chain account number + sequence (re-read before every tx). */
export async function getAccount(address) {
  const data = await fetchJson(
    `${REST_URL}/cosmos/auth/v1beta1/accounts/${address}`,
  );
  const a = data.account;
  if (!a) throw new Error(`No on-chain account for ${address}`);
  return {
    accountNumber: BigInt(a.account_number),
    sequence: BigInt(a.sequence),
  };
}

async function getGasPriceUqor() {
  try {
    const p = await recommendedGasPriceUqor({ rest: REST_URL });
    const v = parseFloat(p);
    if (Number.isFinite(v) && v > 0) return v;
  } catch {
    // fall through to the SDK default
  }
  return 0.15;
}

function feeFor(gasLimit, priceUqor) {
  const amount = BigInt(Math.ceil(Number(gasLimit) * priceUqor));
  return {
    amount: [{ denom: "uqor", amount: amount.toString() }],
    gas: gasLimit.toString(),
  };
}

/** Simulate a signed TxRaw via REST. Throws on HTTP error. */
async function simulateTx(txRawBytes) {
  const data = await fetchJson(`${REST_URL}/cosmos/tx/v1beta1/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tx_bytes: Buffer.from(txRawBytes).toString("base64"),
    }),
  });
  const gasUsed = BigInt(data.gas_info?.gas_used ?? "0");
  const code = Number(data.result?.code ?? data.code ?? 0);
  const log = data.result?.log ?? data.message ?? "";
  return { gasUsed, code, log };
}

/**
 * Eth-native client for one unified account.
 * signMode: "hybrid" (default posture — attaches the ML-DSA-87 extension)
 * or "classical" (only for the bootstrap-exempt MsgRegisterPQCKeyV2).
 */
export function makeEthClient(unified, { signMode }) {
  const signer = new EthNativeSigner(unified, { signMode, rest: REST_URL });
  let transport = null;
  let versionCache;

  async function getTransport() {
    if (!transport) transport = await StargateClient.connect(RPC_URL);
    return transport;
  }

  async function disconnect() {
    if (transport) {
      transport.disconnect();
      transport = null;
    }
  }

  /**
   * Simulate first, then broadcast with gas = sim gas * 1.5 + headroom.
   * Returns { transactionHash, code, height, gasUsed (sim), rawLog }.
   * Throws (no tx sent) when the simulation fails.
   */
  async function broadcast(messages, memo) {
    const account = await getAccount(unified.cosmos);
    const price = await getGasPriceUqor();
    let version;
    if (signMode === "hybrid") {
      version =
        versionCache ??
        (versionCache = await signer.resolveSignBytesVersion(CHAIN_ID));
    }
    const base = {
      chainId: CHAIN_ID,
      accountNumber: account.accountNumber,
      sequence: account.sequence,
      messages,
      memo,
      ...(version ? { signBytesVersion: version } : {}),
    };
    const simSigned = signer.sign({
      ...base,
      fee: feeFor(SIM_GAS_LIMIT, price),
    });
    const sim = await simulateTx(simSigned.txRawBytes);
    if (sim.code !== 0 || sim.gasUsed === 0n) {
      throw new Error(
        `Simulation failed (code ${sim.code}, gas ${sim.gasUsed}): ${sim.log.slice(0, 500)}`,
      );
    }
    const gasLimit =
      (sim.gasUsed * GAS_MARGIN_NUM) / GAS_MARGIN_DEN + GAS_HEADROOM;
    const fee = feeFor(gasLimit, price);
    const t = await getTransport();
    const res = await signer.signAndBroadcast(t, { ...base, fee });
    return { ...res, gasUsed: sim.gasUsed };
  }

  return { signer, address: unified.cosmos, broadcast, disconnect };
}

/**
 * Register the agent's ML-DSA-87 key, eth-native style.
 * Replicates ensurePqcRegistered for the eth-native signer: the
 * registration message itself is signed CLASSICAL (bootstrap-exempt) and
 * carries a proof-of-possession when chain upgrade v3.2.3 is applied.
 * Returns the broadcast result { transactionHash, code, ... }.
 */
export async function registerPqcEth(unified, pqcKeypair) {
  const client = makeEthClient(unified, { signMode: "classical" });
  try {
    let proofOfPossession;
    const applied = await isUpgradeApplied({
      rest: REST_URL,
      upgrade: CHAIN_UPGRADE_V3_2_3,
    }).catch(() => false);
    if (applied) {
      proofOfPossession = signProofOfPossession({
        chainId: CHAIN_ID,
        account: unified.cosmos,
        keypair: pqcKeypair,
      });
    }
    const message = buildRegisterPqcKeyMsg(unified.cosmos, {
      pqcKeypair,
      proofOfPossession,
    });
    return await client.broadcast(
      [message],
      "Quantum Sentinel register PQC key",
    );
  } finally {
    await client.disconnect();
  }
}
