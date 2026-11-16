import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createClient,
  generatePqcKeypair,
  pqcSign,
  pqcVerify,
  type QoreChainClient,
} from "@qorechain/sdk";

import {
  AGENT_ADDRESS,
  AGENT_EVM_ADDRESS,
  AGENT_PQC_FINGERPRINT,
  CHAIN_NAME,
  connectQorex,
  createRestClient,
  explorerAddressUrl,
  explorerTxUrl,
  FAUCET_URL,
  fetchAgentStatus,
  fetchVisitorBalance,
  FEST_URL,
  isQorexInstalled,
  loadAgentLog,
  mockAgentLog,
  mockAgentStatus,
  OWNER_EVM,
  OWNER_QOR1,
  REST_PROXY_PATH,
  shortAddress,
  toHex,
  truncateHex,
  uqorToQor,
  type AgentLogEntry,
  type AgentStatus,
} from "./qore.js";
import {
  DEFAULT_POLICY,
  evaluatePolicy,
  loadPolicy,
  resetPolicy,
  savePolicy,
  type DayUsage,
  type Lane,
  type PolicyDecision,
  type SentinelPolicy,
} from "./policy.js";

// REST goes through the Vite dev/preview proxy (/lcd -> api-testnet.qore.host)
// because the public REST API sends no CORS headers.
const REST_URL = import.meta.env.VITE_QORE_REST_URL ?? REST_PROXY_PATH;

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e9e5f5",
  borderRadius: 16,
  padding: "1.25rem",
  marginTop: "1rem",
  boxShadow: "0 4px 24px rgba(109, 40, 217, 0.08)",
};

const pill: React.CSSProperties = {
  display: "inline-block",
  padding: "0.2rem 0.65rem",
  borderRadius: 999,
  background: "rgba(237, 233, 254, 0.16)",
  color: "#ede9fe",
  fontSize: "0.8rem",
  fontWeight: 600,
  marginRight: "0.4rem",
  border: "1px solid rgba(237, 233, 254, 0.35)",
};

const linkLight: React.CSSProperties = { color: "#c4b5fd" };

const buttonStyle: React.CSSProperties = {
  padding: "0.65rem 1.4rem",
  border: "none",
  borderRadius: 10,
  background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
  color: "#fff",
  fontSize: "1rem",
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "0 2px 12px rgba(109, 40, 217, 0.35)",
};

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.65rem",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  fontSize: "0.95rem",
  width: "100%",
  boxSizing: "border-box",
};

function isTodayUtc(timestamp: number): boolean {
  const d = new Date(timestamp);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

// QOR amounts are sums of decimals — round for display so the UI never
// shows a float artifact like 0.060000000000000005.
function formatQor(qor: number): string {
  return String(Math.round(qor * 1e6) / 1e6);
}

function dayUsageFromLog(log: AgentLogEntry[]): DayUsage {
  const today = log.filter((e) => e.decision === "EXECUTED" && isTodayUtc(e.timestamp));
  return {
    spentQorToday: today.reduce((sum, e) => sum + e.amountQor, 0),
    txCountToday: today.length,
  };
}

const DEMO_COMMAND = JSON.stringify(
  {
    command: "send",
    to: OWNER_QOR1,
    amountQor: 0.05,
    lane: "native",
    nonce: 1,
  },
  null,
  2,
);

export function App(): JSX.Element {
  const client: QoreChainClient = useMemo(
    () =>
      createClient({
        network: "testnet",
        endpoints: { rest: REST_URL },
      }),
    [],
  );

  // ?mock=1 is read synchronously at mount (not in an effect) so the
  // live-load effects below never fire with a stale mockOn=false and
  // overwrite the seeded mock status/log when the REST API is slow or
  // unreachable. (Bug found while recording the demo video.)
  const [mockOn] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("mock") === "1",
  );
  const [coverOk, setCoverOk] = useState(true);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(() =>
    mockOn ? mockAgentStatus() : null,
  );
  const [statusLoading, setStatusLoading] = useState(() => !mockOn);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [log, setLog] = useState<AgentLogEntry[]>(() =>
    mockOn ? mockAgentLog() : [],
  );
  const [logLoaded, setLogLoaded] = useState(() => mockOn);

  const [policy, setPolicy] = useState<SentinelPolicy>(() => loadPolicy());
  const [policySaved, setPolicySaved] = useState(false);

  // Playground form.
  const [pgTo, setPgTo] = useState(OWNER_QOR1);
  const [pgAmount, setPgAmount] = useState("0.05");
  const [pgLane, setPgLane] = useState<Lane>("native");
  const [pgResult, setPgResult] = useState<PolicyDecision | null>(null);

  // Visitor wallet (QoreX).
  const [address, setAddress] = useState<string | null>(null);
  const [balanceUqor, setBalanceUqor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Authenticated-messaging demo (fresh demo-only ML-DSA-87 keypair).
  const [demoPubHex, setDemoPubHex] = useState<string | null>(null);
  const [demoSigHex, setDemoSigHex] = useState<string | null>(null);
  const [demoVerify, setDemoVerify] = useState<boolean | null>(null);
  const [demoTampered, setDemoTampered] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoPayload, setDemoPayload] = useState(DEMO_COMMAND);

  // ?mock=1: full UI usable without a wallet. Mock status/log are seeded
  // in the state initializers above; this effect only installs the
  // QoreX wallet mock. Everything mock is labelled as simulated and is
  // never presented as on-chain.
  useEffect(() => {
    if (!mockOn) return;
    let cancelled = false;
    void import("@qorechain/qorex-wallet-mock")
      .then(({ createQorexMock }) => {
        if (cancelled) return;
        createQorexMock({ profile: "current", rest: "/lcd" }).install(window);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [mockOn]);

  const refreshAgentStatus = useCallback(async () => {
    if (mockOn) {
      setAgentStatus(mockAgentStatus());
      setStatusLoading(false);
      return;
    }
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await fetchAgentStatus(createRestClient());
      setAgentStatus(s);
      if (s.balanceUqor === null && s.pqcRegistered === null && s.window === null) {
        setStatusError(
          "Live agent status is unreachable right now (REST API / proxy). The policy playground and messaging demo below still work.",
        );
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatusLoading(false);
    }
  }, [mockOn]);

  useEffect(() => {
    if (mockOn) return;
    void refreshAgentStatus();
  }, [refreshAgentStatus, mockOn]);

  const refreshLog = useCallback(async () => {
    if (mockOn) return;
    const entries = await loadAgentLog();
    setLog(entries);
    setLogLoaded(true);
  }, [mockOn]);

  useEffect(() => {
    void refreshLog();
  }, [refreshLog]);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    try {
      setBalanceUqor(await fetchVisitorBalance(client, address));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [address, client]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  async function handleConnect(): Promise<void> {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const addr = await connectQorex();
      setAddress(addr);
      setStatus(`Connected to QoreX on ${CHAIN_NAME}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleDisconnect(): void {
    setAddress(null);
    setBalanceUqor(null);
    setStatus("Disconnected.");
  }

  function handlePolicyChange(patch: Partial<SentinelPolicy>): void {
    setPolicy((prev) => ({ ...prev, ...patch }));
    setPolicySaved(false);
  }

  function handleSavePolicy(): void {
    savePolicy(policy);
    setPolicySaved(true);
  }

  function handleResetPolicy(): void {
    setPolicy(resetPolicy());
    setPolicySaved(false);
  }

  function handlePlayground(): void {
    const amount = Number(pgAmount);
    const to = pgLane === "evm" ? pgTo.trim() : pgTo.trim();
    const usage = dayUsageFromLog(log);
    setPgResult(evaluatePolicy(policy, { to, amountQor: amount, lane: pgLane }, usage));
  }

  function handleDemoSign(): void {
    setDemoBusy(true);
    setError(null);
    try {
      // FRESH demo-only keypair, generated in this browser on click. It is
      // NOT the agent's key and is never stored or sent anywhere.
      const kp = generatePqcKeypair();
      const message = new TextEncoder().encode(demoPayload);
      const signature = pqcSign(kp.secretKey, message);
      const ok = pqcVerify(kp.publicKey, message, signature);
      setDemoPubHex(toHex(kp.publicKey));
      setDemoSigHex(toHex(signature));
      setDemoVerify(ok);
      setDemoTampered(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDemoBusy(false);
    }
  }

  function handleDemoTamper(): void {
    if (!demoPubHex || !demoSigHex) return;
    // Re-verify the ORIGINAL signature against a TAMPERED payload: the
    // amount is changed after signing, exactly as an attacker would.
    const tampered = demoPayload.replace("0.05", "5");
    setDemoPayload(tampered);
    const message = new TextEncoder().encode(tampered);
    const pub = new Uint8Array(
      (demoPubHex.match(/../g) ?? []).map((h) => parseInt(h, 16)),
    );
    const sig = new Uint8Array(
      (demoSigHex.match(/../g) ?? []).map((h) => parseInt(h, 16)),
    );
    setDemoVerify(pqcVerify(pub, message, sig));
    setDemoTampered(true);
  }

  const usage = useMemo(() => dayUsageFromLog(log), [log]);
  const recentLog = useMemo(
    () => [...log].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20),
    [log],
  );
  const executedCount = log.filter((e) => e.decision === "EXECUTED").length;
  const rejectedCount = log.filter((e) => e.decision === "REJECTED").length;

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 760,
        margin: "0 auto",
        padding: "2rem 1rem 3rem",
        lineHeight: 1.5,
        color: "#111827",
        background: "transparent",
        position: "relative",
        minHeight: "100vh",
      }}
    >
      <div className="qj-bg" aria-hidden="true">
        <div className="qj-stars" />
        <div className="qj-orb qj-orb-1" />
        <div className="qj-orb qj-orb-2" />
        <div className="qj-orb qj-orb-3" />
        <div className="qj-orb qj-orb-4" />
      </div>
      <div style={{ position: "relative", zIndex: 1 }}>
        <header>
          {coverOk && (
            <img
              src="/cover.jpg"
              alt="Quantum Sentinel — a glowing shield watching over QoreChain testnet transactions"
              onError={() => setCoverOk(false)}
              style={{
                width: "100%",
                borderRadius: 16,
                display: "block",
                boxShadow: "0 8px 32px rgba(109, 40, 217, 0.25)",
              }}
            />
          )}
          <h1
            style={{
              marginBottom: 0,
              marginTop: "1rem",
              fontSize: "1.9rem",
              color: "#fff",
              textShadow: "0 2px 16px rgba(124, 58, 237, 0.6)",
            }}
          >
            🛡️ Quantum Sentinel
          </h1>
          <p style={{ marginTop: "0.5rem", marginBottom: "0.5rem" }}>
            <span style={pill}>Post-Quantum AI Agent</span>
            <span style={pill}>Hybrid-signed</span>
            <span style={pill}>QoreChain Testnet</span>
          </p>
          <p style={{ color: "#e9d5ff", marginTop: "0.25rem" }}>
            A post-quantum allowance agent: it only moves testnet QOR inside
            a policy you can read — a per-transaction cap, a daily cap, a
            daily transaction count, a whitelist, and active hours — and
            only inside a scoped, expiring EVM authorisation window. Every
            action is a hybrid-signed transaction (secp256k1 + ML-DSA-87),
            and every agent command is authenticated with an ML-DSA-87
            signature. Out-of-policy tasks are rejected and logged, never
            executed.
          </p>
          <p style={{ color: "#c4b5fd", fontSize: "0.9rem" }}>
            Built for the QoreChain Developer Fest — Post-Quantum AI Agents.
            Testnet only; QOR here has no real value.
            {mockOn && (
              <span style={{ color: "#fbbf24" }}>
                {" "}
                [dev mock mode — agent status and log entries are simulated,
                not on chain]
              </span>
            )}
          </p>
        </header>

        <section style={card}>
          <h2 style={{ marginTop: 0 }}>🤖 Agent status — live from the chain</h2>
          <p style={{ marginTop: 0, color: "#555" }}>
            Agent{" "}
            <a
              href={explorerAddressUrl(AGENT_ADDRESS)}
              target="_blank"
              rel="noreferrer"
            >
              <code>{shortAddress(AGENT_ADDRESS)}</code>
            </a>{" "}
            · EVM{" "}
            <a
              href={explorerAddressUrl(AGENT_EVM_ADDRESS)}
              target="_blank"
              rel="noreferrer"
            >
              <code>{shortAddress(AGENT_EVM_ADDRESS)}</code>
            </a>
          </p>
          {statusLoading ? (
            <p style={{ color: "#555" }}>Reading the chain…</p>
          ) : agentStatus ? (
            <ul style={{ paddingLeft: "1.25rem", margin: 0 }}>
              <li>
                Balance:{" "}
                <strong>
                  {agentStatus.balanceUqor === null
                    ? "unavailable"
                    : `${uqorToQor(agentStatus.balanceUqor)} QOR`}
                </strong>{" "}
                {agentStatus.balanceUqor === "0" &&
                  "(unfunded — claim the faucet to the agent address, then run the runner)"}
              </li>
              <li>
                PQC key (ML-DSA-87):{" "}
                <strong>
                  {agentStatus.pqcRegistered === null
                    ? "unknown"
                    : agentStatus.pqcRegistered
                      ? `registered${agentStatus.pqcAlgorithmId ? ` (algorithm ${agentStatus.pqcAlgorithmId})` : ""}`
                      : "NOT registered yet — registration happens on the first funded run"}
                </strong>{" "}
                <span style={{ color: "#555" }}>
                  (pubkey fingerprint{" "}
                  <code>{AGENT_PQC_FINGERPRINT.slice(0, 16)}…</code>)
                </span>
              </li>
              <li>
                EVM window:{" "}
                {agentStatus.window === null ? (
                  <strong>unavailable</strong>
                ) : !agentStatus.window.found ? (
                  <strong>none open</strong>
                ) : (
                  <span>
                    <strong>{agentStatus.window.live ? "LIVE" : "not live"}</strong>{" "}
                    — expires at height{" "}
                    {agentStatus.window.expiryHeight.toString()} (
                    {agentStatus.window.remainingBlocks.toString()} blocks
                    left), {agentStatus.window.usedTxs.toString()}/
                    {agentStatus.window.maxTxs.toString()} txs used,{" "}
                    {uqorToQor(agentStatus.window.usedValue)}/
                    {uqorToQor(agentStatus.window.maxValue)} QOR of value
                    used
                  </span>
                )}
              </li>
            </ul>
          ) : null}
          {statusError && (
            <p style={{ color: "#b45309", fontSize: "0.9rem" }}>{statusError}</p>
          )}
          <p style={{ marginBottom: 0 }}>
            <button
              onClick={() => void refreshAgentStatus()}
              disabled={statusLoading}
              style={{ ...buttonStyle, background: "#e5e7eb", color: "#111827" }}
            >
              Refresh status
            </button>
          </p>
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0 }}>📜 Spending policy</h2>
          <p style={{ marginTop: 0, color: "#555" }}>
            The rules the agent enforces on every task — in the runner and
            in the playground below. Saved in your browser (localStorage);
            the runner uses the same defaults from{" "}
            <code>scripts/policy.json</code>.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.75rem",
            }}
          >
            <label>
              Max QOR per tx
              <input
                type="number"
                min={0}
                step={0.01}
                value={policy.maxQorPerTx}
                onChange={(e) =>
                  handlePolicyChange({ maxQorPerTx: Number(e.target.value) })
                }
                style={inputStyle}
              />
            </label>
            <label>
              Max QOR per day
              <input
                type="number"
                min={0}
                step={0.01}
                value={policy.maxQorPerDay}
                onChange={(e) =>
                  handlePolicyChange({ maxQorPerDay: Number(e.target.value) })
                }
                style={inputStyle}
              />
            </label>
            <label>
              Max txs per day
              <input
                type="number"
                min={0}
                step={1}
                value={policy.maxTxCountPerDay}
                onChange={(e) =>
                  handlePolicyChange({
                    maxTxCountPerDay: Math.floor(Number(e.target.value)),
                  })
                }
                style={inputStyle}
              />
            </label>
            <label>
              Active hours (UTC, start–end)
              <span style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={1}
                  value={policy.activeHoursUtc[0]}
                  onChange={(e) =>
                    handlePolicyChange({
                      activeHoursUtc: [
                        Math.floor(Number(e.target.value)),
                        policy.activeHoursUtc[1],
                      ],
                    })
                  }
                  style={inputStyle}
                />
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={1}
                  value={policy.activeHoursUtc[1]}
                  onChange={(e) =>
                    handlePolicyChange({
                      activeHoursUtc: [
                        policy.activeHoursUtc[0],
                        Math.floor(Number(e.target.value)),
                      ],
                    })
                  }
                  style={inputStyle}
                />
              </span>
            </label>
          </div>
          <label style={{ display: "block", marginTop: "0.75rem" }}>
            Whitelist (one qor1 address per line — the only destinations the
            agent may ever pay)
            <textarea
              value={policy.whitelist.join("\n")}
              rows={2}
              onChange={(e) =>
                handlePolicyChange({
                  whitelist: e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.85rem" }}
            />
          </label>
          <p style={{ color: "#555", fontSize: "0.9rem" }}>
            EVM window bounds: {policy.evmWindow.blocks} blocks,{" "}
            {policy.evmWindow.maxTxs} txs, {policy.evmWindow.maxValueQor} QOR
            max value. (The window is opened on chain by the runner with
            these bounds; editing them here changes only the playground.)
          </p>
          <p>
            <button onClick={handleSavePolicy} style={buttonStyle}>
              Save policy
            </button>{" "}
            <button
              onClick={handleResetPolicy}
              style={{ ...buttonStyle, background: "#e5e7eb", color: "#111827" }}
            >
              Reset to defaults
            </button>{" "}
            {policySaved && (
              <span style={{ color: "#047857" }}>Saved in this browser.</span>
            )}
          </p>
          <p style={{ fontSize: "0.9rem", color: "#555", marginBottom: 0 }}>
            Defaults: {DEFAULT_POLICY.maxQorPerTx} QOR/tx ·{" "}
            {DEFAULT_POLICY.maxQorPerDay} QOR/day ·{" "}
            {DEFAULT_POLICY.maxTxCountPerDay} txs/day · whitelist = owner
            only · active 00:00–24:00 UTC · window 600 blocks / 5 txs / 1
            QOR.
          </p>
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0 }}>🧪 Policy playground — would the agent do it?</h2>
          <p style={{ marginTop: 0, color: "#555" }}>
            This is the agent&apos;s decision logic, running in your browser
            against the policy above. No wallet needed, nothing is sent —
            try a task and see the exact rule that allows or rejects it.
            Today&apos;s usage from the activity log:{" "}
            <strong>
              {formatQor(usage.spentQorToday)} QOR spent, {usage.txCountToday} txs
              executed
            </strong>
            .
          </p>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <label>
              Lane
              <select
                value={pgLane}
                onChange={(e) => {
                  const lane = e.target.value as Lane;
                  setPgLane(lane);
                  setPgTo(lane === "evm" ? OWNER_EVM : OWNER_QOR1);
                }}
                style={inputStyle}
              >
                <option value="native">Native (qor1…)</option>
                <option value="evm">EVM (0x…)</option>
              </select>
            </label>
            <label>
              Destination
              <input
                value={pgTo}
                onChange={(e) => setPgTo(e.target.value)}
                style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.85rem" }}
              />
            </label>
            <label>
              Amount (QOR)
              <input
                type="number"
                min={0}
                step={0.01}
                value={pgAmount}
                onChange={(e) => setPgAmount(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <p>
            <button onClick={handlePlayground} style={buttonStyle}>
              Evaluate task
            </button>{" "}
            <button
              onClick={() => {
                setPgTo(OWNER_QOR1);
                setPgAmount("5");
                setPgLane("native");
                setPgResult(null);
              }}
              style={{ ...buttonStyle, background: "#e5e7eb", color: "#111827" }}
            >
              Try: 5 QOR to owner
            </button>{" "}
            <button
              onClick={() => {
                setPgTo("qor1yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3z6t9806");
                setPgAmount("0.05");
                setPgLane("native");
                setPgResult(null);
              }}
              style={{ ...buttonStyle, background: "#e5e7eb", color: "#111827" }}
            >
              Try: 0.05 QOR off-whitelist
            </button>
          </p>
          {pgResult && (
            <p
              role="status"
              style={{
                borderRadius: 10,
                padding: "0.6rem 0.9rem",
                background: pgResult.allow
                  ? "rgba(6, 95, 70, 0.1)"
                  : "rgba(127, 29, 29, 0.08)",
                border: pgResult.allow
                  ? "1px solid #6ee7b7"
                  : "1px solid #fca5a5",
                color: pgResult.allow ? "#065f46" : "#7f1d1d",
              }}
            >
              {pgResult.allow ? (
                <>
                  <strong>✅ ALLOW</strong> — every policy rule passes. The
                  runner would simulate, then execute this as a hybrid-signed
                  transaction.
                </>
              ) : (
                <>
                  <strong>⛔ REJECT</strong> — rule{" "}
                  <code>{pgResult.rule}</code>: {pgResult.reason} The agent
                  would log this rejection and execute nothing.
                </>
              )}
            </p>
          )}
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0 }}>📋 Activity log</h2>
          <p style={{ marginTop: 0, color: "#555" }}>
            Every agent decision, executed or rejected, with its on-chain
            transaction where one exists. Executed:{" "}
            <strong>{executedCount}</strong> · Rejected:{" "}
            <strong>{rejectedCount}</strong>.{" "}
            {mockOn && "Simulated entries below — not on chain."}
          </p>
          {!logLoaded ? (
            <p style={{ color: "#555" }}>Loading…</p>
          ) : recentLog.length === 0 ? (
            <p style={{ color: "#555" }}>
              No agent runs yet. The agent is unfunded — once the owner
              claims the faucet to the agent address and runs{" "}
              <code>node scripts/agent-run.mjs</code>, its decisions appear
              here.
            </p>
          ) : (
            <ul style={{ paddingLeft: "1.25rem" }}>
              {recentLog.map((entry) => (
                <li key={`${entry.taskId}-${entry.timestamp}`} style={{ marginBottom: "0.75rem" }}>
                  <strong>
                    {entry.decision === "EXECUTED"
                      ? "✅ EXECUTED"
                      : entry.decision === "REJECTED"
                        ? "⛔ REJECTED"
                        : "❌ FAILED"}
                  </strong>{" "}
                  <code>{entry.taskId}</code> — {entry.amountQor} QOR via{" "}
                  {entry.lane} to <code>{shortAddress(entry.to)}</code>{" "}
                  <span style={{ color: "#555", fontSize: "0.9rem" }}>
                    ({new Date(entry.timestamp).toISOString().slice(0, 19).replace("T", " ")} UTC)
                  </span>
                  <br />
                  <span style={{ fontSize: "0.9rem", color: "#555" }}>
                    {entry.reason}
                  </span>{" "}
                  {entry.txHash &&
                    (entry.mock ? (
                      <span style={{ color: "#b45309", fontSize: "0.9rem" }}>
                        (simulated tx <code>{entry.txHash.slice(0, 16)}…</code>)
                      </span>
                    ) : (
                      <a
                        href={explorerTxUrl(entry.txHash)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        tx
                      </a>
                    ))}
                  {entry.mock && (
                    <span style={{ color: "#b45309" }}> (simulated)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0 }}>🔏 Authenticated messaging — ML-DSA-87</h2>
          <p style={{ marginTop: 0, color: "#555" }}>
            The agent only acts on commands signed with ML-DSA-87. Try it
            with a <strong>fresh demo-only keypair</strong> generated in
            your browser — this is never the agent&apos;s key, and it is
            never stored or sent anywhere. Sign the sample command, then
            tamper with it and watch verification fail.
          </p>
          <label style={{ display: "block" }}>
            Agent command (JSON)
            <textarea
              value={demoPayload}
              rows={7}
              onChange={(e) => {
                setDemoPayload(e.target.value);
                setDemoVerify(null);
                setDemoTampered(false);
              }}
              style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.85rem" }}
            />
          </label>
          <p>
            <button
              onClick={handleDemoSign}
              disabled={demoBusy}
              style={buttonStyle}
            >
              {demoBusy ? "Signing…" : "1️⃣ Generate demo keypair & sign"}
            </button>{" "}
            <button
              onClick={handleDemoTamper}
              disabled={!demoSigHex}
              style={{ ...buttonStyle, background: "#e5e7eb", color: "#111827" }}
            >
              2️⃣ Tamper with the amount (0.05 → 5) & re-verify
            </button>
          </p>
          {demoPubHex && demoSigHex && (
            <div style={{ fontSize: "0.9rem" }}>
              <p style={{ margin: "0.25rem 0" }}>
                Demo public key (2592 bytes):{" "}
                <code>{truncateHex(demoPubHex, 24, 12)}</code>
              </p>
              <p style={{ margin: "0.25rem 0" }}>
                Signature (4627 bytes):{" "}
                <code>{truncateHex(demoSigHex, 24, 12)}</code>
              </p>
              <p
                role="status"
                style={{
                  borderRadius: 10,
                  padding: "0.6rem 0.9rem",
                  background:
                    demoVerify === true
                      ? "rgba(6, 95, 70, 0.1)"
                      : demoVerify === false
                        ? "rgba(127, 29, 29, 0.08)"
                        : "transparent",
                  border:
                    demoVerify === true
                      ? "1px solid #6ee7b7"
                      : demoVerify === false
                        ? "1px solid #fca5a5"
                        : "none",
                  color: demoVerify === true ? "#065f46" : "#7f1d1d",
                }}
              >
                {demoVerify === true
                  ? "✅ pqcVerify OK — signature matches the command. The agent would accept this command."
                  : demoVerify === false
                    ? `❌ pqcVerify FAILED${demoTampered ? " — the payload was changed after signing" : ""}. The agent rejects the command and executes nothing.`
                    : "Verify result pending."}
              </p>
            </div>
          )}
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Wallet</h2>
          {address ? (
            <div>
              <p>
                Connected: <code>{shortAddress(address)}</code>
              </p>
              <p>
                Balance:{" "}
                <strong>
                  {balanceUqor === null
                    ? "loading…"
                    : `${uqorToQor(balanceUqor)} QOR`}
                </strong>{" "}
                <button
                  onClick={() => void refreshBalance()}
                  disabled={busy}
                  style={{ ...buttonStyle, background: "#e5e7eb", color: "#111827" }}
                >
                  Refresh
                </button>{" "}
                <button
                  onClick={handleDisconnect}
                  style={{ ...buttonStyle, background: "#e5e7eb", color: "#111827" }}
                >
                  Disconnect
                </button>
              </p>
              <p style={{ fontSize: "0.9rem", color: "#555" }}>
                This wallet is only for looking around. The demo never asks
                it to sign as the agent, and the agent never spends from it.
                Need test QOR? Claim 100 QOR / 24h at the{" "}
                <a href={FAUCET_URL} target="_blank" rel="noreferrer">
                  QoreChain faucet
                </a>
                .
              </p>
            </div>
          ) : (
            <div>
              <p style={{ color: "#555" }}>
                Connect QoreX (switched to Testnet) to see your own address
                and balance. No wallet is needed for the policy playground,
                the activity log, or the messaging demo.
              </p>
              <button onClick={() => void handleConnect()} disabled={busy} style={buttonStyle}>
                {busy ? "Connecting…" : "Connect QoreX"}
              </button>
              {!isQorexInstalled() && (
                <p style={{ fontSize: "0.9rem", color: "#b45309" }}>
                  QoreX was not detected in this browser. Install the QoreX
                  extension or open this page in the QoreX app&apos;s dApp
                  browser. (Add <code>?mock=1</code> to the URL to try the
                  demo without a wallet.)
                </p>
              )}
            </div>
          )}
        </section>

        {status && (
          <p
            style={{
              color: "#a7f3d0",
              marginTop: "1rem",
              background: "rgba(6, 95, 70, 0.45)",
              border: "1px solid rgba(167, 243, 208, 0.4)",
              borderRadius: 10,
              padding: "0.6rem 0.9rem",
            }}
            role="status"
          >
            {status}
          </p>
        )}
        {error && (
          <p
            style={{
              color: "#fecaca",
              marginTop: "1rem",
              background: "rgba(127, 29, 29, 0.45)",
              border: "1px solid rgba(252, 165, 165, 0.4)",
              borderRadius: 10,
              padding: "0.6rem 0.9rem",
            }}
            role="alert"
          >
            {error}
          </p>
        )}

        <footer style={{ marginTop: "1.5rem", fontSize: "0.9rem", color: "#c4b5fd" }}>
          <p>
            How it works: the Sentinel agent holds a fresh testnet-only
            account (<code>{shortAddress(AGENT_ADDRESS)}</code>) with a
            canonical ML-DSA-87 keypair. Before any task it checks its
            balance and its on-chain PQC registration, evaluates the task
            against the spending policy, simulates the transaction, and only
            then broadcasts — hybrid-signed (secp256k1 + ML-DSA-87). For
            EVM work it first opens a scoped authorisation window (600
            blocks, 5 txs, 1 QOR max) with a hybrid-signed native message,
            then sends inside it. Rejected tasks are logged, never executed.
            No smart contract, no server, no custody of anyone else&apos;s
            funds.
          </p>
          <p>
            <a href={FEST_URL} target="_blank" rel="noreferrer" style={linkLight}>
              QoreChain Developer Fest
            </a>{" "}
            ·{" "}
            <a
              href="https://github.com/agusher21/quantum-sentinel"
              target="_blank"
              rel="noreferrer"
              style={linkLight}
            >
              GitHub
            </a>{" "}
            ·{" "}
            <a href={FAUCET_URL} target="_blank" rel="noreferrer" style={linkLight}>
              Faucet
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
