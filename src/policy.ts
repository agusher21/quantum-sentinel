// Quantum Sentinel — the spending policy.
//
// The policy is the agent's smart-account spending rule, enforced twice:
//   1. in the runner (scripts/agent-run.mjs) before any transaction is built,
//   2. here, in the demo playground, so a visitor can see exactly which rule
//      would allow or reject a task — same function, same defaults.
// A task is only executed when EVERY rule passes. A rejection names the rule
// that fired; nothing is ever executed "because it was close".

export type Lane = "native" | "evm";

export interface SentinelPolicy {
  /** Max QOR in a single transaction. */
  maxQorPerTx: number;
  /** Max QOR the agent may spend in one UTC day (native + EVM combined). */
  maxQorPerDay: number;
  /** Max executed transactions in one UTC day. */
  maxTxCountPerDay: number;
  /** Only these qor1 addresses may ever receive agent funds. */
  whitelist: string[];
  /** Hours (UTC) the agent may act, [start, end) — 0..24, end exclusive. */
  activeHoursUtc: [number, number];
  /** Bounds of the scoped EVM authorisation window the agent opens. */
  evmWindow: {
    /** How many blocks the window stays open. */
    blocks: number;
    /** How many EVM transactions it admits. */
    maxTxs: number;
    /** Total the window may spend, in QOR (value + max fees). */
    maxValueQor: number;
  };
}

export const OWNER_QOR1 =
  "qor1ntpfg4zpxxkpwzwrh0uwdqqyz36lqnmp8nmpz0";
export const OWNER_EVM = "0x9ac294544131ac1709c3bbf8e680041475f04f61";

export const DEFAULT_POLICY: SentinelPolicy = {
  maxQorPerTx: 0.1,
  maxQorPerDay: 0.5,
  maxTxCountPerDay: 10,
  whitelist: [OWNER_QOR1],
  activeHoursUtc: [0, 24],
  evmWindow: { blocks: 600, maxTxs: 5, maxValueQor: 1 },
};

export interface PolicyTask {
  /** Destination qor1 address (native) or 0x address (EVM). */
  to: string;
  amountQor: number;
  lane: Lane;
}

/** What the agent has already spent today (UTC), from the activity log. */
export interface DayUsage {
  spentQorToday: number;
  txCountToday: number;
}

export type PolicyDecision =
  | { allow: true }
  | { allow: false; rule: string; reason: string };

/**
 * Pure policy evaluation — no network, no wallet, no side effects.
 * Rules are checked in a fixed order so a rejection always names ONE rule:
 * whitelist → per-tx cap → daily cap → daily tx count → active hours →
 * (EVM only) window value bound.
 */
export function evaluatePolicy(
  policy: SentinelPolicy,
  task: PolicyTask,
  usage: DayUsage,
  now: Date = new Date(),
): PolicyDecision {
  if (!task.to || typeof task.to !== "string") {
    return {
      allow: false,
      rule: "destination",
      reason: "No destination address given.",
    };
  }
  if (!(task.amountQor > 0) || !Number.isFinite(task.amountQor)) {
    return {
      allow: false,
      rule: "amount",
      reason: `Amount must be greater than 0 QOR (got ${task.amountQor}).`,
    };
  }
  // Rule 1 — whitelist. The EVM lane's destination is the owner's EVM
  // address, which is the same account as the whitelisted qor1 address.
  const whitelisted =
    policy.whitelist.includes(task.to) ||
    (task.lane === "evm" &&
      task.to.toLowerCase() === OWNER_EVM.toLowerCase());
  if (!whitelisted) {
    return {
      allow: false,
      rule: "whitelist",
      reason: `${task.to} is not on the policy whitelist (${policy.whitelist.join(", ")}). The agent only ever sends to whitelisted destinations.`,
    };
  }
  // Rule 2 — per-transaction cap.
  if (task.amountQor > policy.maxQorPerTx) {
    return {
      allow: false,
      rule: "maxQorPerTx",
      reason: `${task.amountQor} QOR exceeds the per-transaction cap of ${policy.maxQorPerTx} QOR.`,
    };
  }
  // Rule 3 — daily spend cap (native + EVM combined).
  if (usage.spentQorToday + task.amountQor > policy.maxQorPerDay) {
    return {
      allow: false,
      rule: "maxQorPerDay",
      reason: `${usage.spentQorToday} QOR already spent today + ${task.amountQor} QOR would exceed the daily cap of ${policy.maxQorPerDay} QOR.`,
    };
  }
  // Rule 4 — daily transaction count.
  if (usage.txCountToday + 1 > policy.maxTxCountPerDay) {
    return {
      allow: false,
      rule: "maxTxCountPerDay",
      reason: `${usage.txCountToday} transactions already executed today; the daily limit is ${policy.maxTxCountPerDay}.`,
    };
  }
  // Rule 5 — active hours (UTC).
  const hourUtc = now.getUTCHours() + now.getUTCMinutes() / 60;
  const [start, end] = policy.activeHoursUtc;
  if (hourUtc < start || hourUtc >= end) {
    return {
      allow: false,
      rule: "activeHoursUtc",
      reason: `Outside active hours (${start}:00–${end}:00 UTC; now ${now.toISOString().slice(11, 16)} UTC).`,
    };
  }
  // Rule 6 — EVM window value bound. The window's maxValue covers value
  // PLUS the maximum fee of every admitted tx, so a single EVM task must
  // fit comfortably inside it (here: amount alone must fit; the runner
  // re-checks the live window's remaining value before sending).
  if (
    task.lane === "evm" &&
    task.amountQor > policy.evmWindow.maxValueQor
  ) {
    return {
      allow: false,
      rule: "evmWindow.maxValue",
      reason: `${task.amountQor} QOR exceeds the EVM window's max value of ${policy.evmWindow.maxValueQor} QOR.`,
    };
  }
  return { allow: true };
}

const POLICY_STORAGE_KEY = "quantum-sentinel:policy:v1";

export function loadPolicy(): SentinelPolicy {
  try {
    const raw = localStorage.getItem(POLICY_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_POLICY);
    const parsed = JSON.parse(raw) as Partial<SentinelPolicy>;
    return {
      ...structuredClone(DEFAULT_POLICY),
      ...parsed,
      evmWindow: {
        ...DEFAULT_POLICY.evmWindow,
        ...(parsed.evmWindow ?? {}),
      },
      whitelist: Array.isArray(parsed.whitelist)
        ? parsed.whitelist
        : DEFAULT_POLICY.whitelist,
    };
  } catch {
    return structuredClone(DEFAULT_POLICY);
  }
}

export function savePolicy(policy: SentinelPolicy): void {
  try {
    localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(policy));
  } catch {
    // Storage full/blocked: the in-memory policy still applies this session.
  }
}

export function resetPolicy(): SentinelPolicy {
  try {
    localStorage.removeItem(POLICY_STORAGE_KEY);
  } catch {
    // Ignore.
  }
  return structuredClone(DEFAULT_POLICY);
}
