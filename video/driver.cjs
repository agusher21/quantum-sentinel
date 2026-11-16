// Driver for the Quantum Sentinel demo screen recording.
// Serves the local preview at 127.0.0.1:4173 with ?mock=1 (mock mode —
// simulated agent status/log, no wallet, no real transaction), walks the
// scenes in order, logs [t=..s] markers for caption placement.
const puppeteer = require("/home/hatch/workspace/qorechain/tip-jar-video/node_modules/puppeteer-core");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START = Date.now();
const mark = (label) =>
  console.log(`[t=${((Date.now() - START) / 1000).toFixed(1)}s] ${label}`);

(async () => {
  const browser = await puppeteer.launch({
    executablePath:
      "/home/hatch/workspace/qorechain/tip-jar-video/chrome/linux-157.0.8103.78/chrome-linux64/chrome",
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1280,800",
      "--window-position=0,0",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--ignore-certificate-errors",
    ],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  // The app's ?mock=1 seeds simulated status + log at mount, but the
  // non-mock live loads (fired once at mount) resolve later and overwrite
  // them — REST is unreachable here, so they resolve to all-nulls + an
  // error banner, and /agent-log.json is empty. So the three /lcd reads
  // are answered in-page with the EXACT values mockAgentStatus() returns
  // (100 QOR, PQC registered algorithm 1, window 600 blocks / 5 txs /
  // 1 QOR, 1 tx used, 512 blocks left) — the app's own demo data, served
  // through the REST path its live loader uses, so the panel renders
  // exactly as ?mock=1 intends. /agent-log.json is left hanging so the
  // seeded mock log entries stay. Nothing is invented: no value on screen
  // differs from the app's own mock data.
  await page.evaluateOnNewDocument(() => {
    const AGENT = "qor1zr9ev820wyrw300yy9ke99x2xuq3nrmf6nknqd";
    const json = (obj) =>
      new Response(JSON.stringify(obj), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const fulfill = (url) => {
      if (url.includes(`/cosmos/bank/v1beta1/balances/${AGENT}`))
        return json({ balances: [{ denom: "uqor", amount: "100000000" }] });
      if (url.includes(`/qorechain/pqc/v1/account/${AGENT}`))
        return json({ found: true, account: { algorithm_id: 1 } });
      if (url.includes(`/qorechain/pqc/v1/evm_window/${AGENT}`))
        return json({
          found: true,
          live: true,
          opened_height: "10180000",
          expiry_height: "10180600",
          max_txs: "5",
          used_txs: "1",
          max_value: "1000000",
          used_value: "12300",
          remaining_blocks: "512",
          remaining_txs: "4",
          remaining_value: "987700",
          native_only: false,
          allowed_targets: [],
        });
      return null;
    };
    const origFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/agent-log.json")) return new Promise(() => {});
      if (url.includes("/lcd")) {
        const res = fulfill(url);
        if (res) return Promise.resolve(res);
        console.warn("[lcd-unhandled]", url);
        return new Promise(() => {});
      }
      return origFetch(input, init);
    };
  });
  page.on("console", (m) => {
    if (m.type() === "warning" || m.type() === "error")
      console.log(`[console.${m.type()}]`, m.text());
  });

  const scrollTo = async (text) => {
    await page.evaluate((t) => {
      const h = [...document.querySelectorAll("h2")].find((el) =>
        el.textContent.includes(t),
      );
      h?.scrollIntoView({ block: "start" });
      window.scrollBy(0, -10);
    }, text);
  };
  const clickBtn = async (text) => {
    const ok = await page.evaluate((t) => {
      const b = [...document.querySelectorAll("button")].find((el) =>
        el.textContent.includes(t),
      );
      if (!b) return false;
      b.click();
      return true;
    }, text);
    if (!ok) console.log("BUTTON NOT FOUND:", text);
    return ok;
  };
  const waitText = async (text, timeout = 30000) => {
    await page.waitForFunction((t) => document.body.innerText.includes(t), {
      timeout,
    }, text);
  };

  await page.goto("http://127.0.0.1:4173/?mock=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(
    () => document.body.innerText.includes("Quantum Sentinel"),
    { timeout: 30000 },
  );
  // Wait until the hero has actually painted (cover image loaded) and the
  // mock label is on screen.
  await page.waitForFunction(
    () =>
      document.querySelector('img[src="/cover.jpg"]')?.complete &&
      document.body.innerText.includes("dev mock mode"),
    { timeout: 30000 },
  );
  mark("HERO");
  await sleep(8000);

  // 2. Agent status panel.
  await scrollTo("Agent status");
  await waitText("100 QOR");
  await waitText("LIVE");
  mark("AGENT STATUS");
  await sleep(6000);

  // 3. Policy card.
  await scrollTo("Spending policy");
  mark("POLICY CARD");
  await sleep(6000);

  // 4a. Playground intro.
  await scrollTo("Policy playground");
  mark("PLAYGROUND intro");
  await sleep(4000);

  // 4b. In-policy: 0.05 QOR to whitelisted owner -> ALLOW.
  await clickBtn("Evaluate task");
  await waitText("ALLOW");
  mark("PLAYGROUND ALLOW 0.05 QOR");
  await sleep(5000);

  // 4c. Oversize: 5 QOR -> REJECT maxQorPerTx.
  await clickBtn("Try: 5 QOR to owner");
  await sleep(800);
  await clickBtn("Evaluate task");
  await waitText("maxQorPerTx");
  mark("PLAYGROUND REJECT 5 QOR (maxQorPerTx)");
  await sleep(5000);

  // 4d. Off-whitelist -> REJECT whitelist.
  await clickBtn("Try: 0.05 QOR off-whitelist");
  await sleep(800);
  await clickBtn("Evaluate task");
  await waitText("whitelist");
  mark("PLAYGROUND REJECT off-whitelist");
  await sleep(5000);

  // 5. Activity log.
  await scrollTo("Activity log");
  await waitText("Simulated entries");
  mark("ACTIVITY LOG");
  await sleep(5000);

  // 6. Authenticated messaging: sign then tamper.
  await scrollTo("Authenticated messaging");
  mark("MESSAGING intro");
  await sleep(4000);
  await clickBtn("Generate demo keypair");
  await waitText("pqcVerify OK", 60000);
  mark("MESSAGING sign OK");
  await sleep(5000);
  await clickBtn("Tamper with the amount");
  await waitText("pqcVerify FAILED", 30000);
  mark("MESSAGING tamper FAILS");
  await sleep(5000);

  // Back to hero for the end frame.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  mark("END FRAME");
  await sleep(3000);
  mark("DONE");
  await browser.close();
})().catch((e) => {
  console.error("DRIVER ERROR", e);
  process.exit(1);
});
