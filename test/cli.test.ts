import { describe, expect, it } from "vitest";
import { parseArgs, run, type Deps } from "../src/cli.js";

const NVDA = "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593";
const NY = "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;1126/C";

function deps(over: Partial<Deps> = {}, responses: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const fetchMock = (async (url: string | URL | Request) => {
    const u = String(url);
    const key = Object.keys(responses).find((k) => u.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(responses[key]), { status: 200 });
  }) as typeof fetch;
  const d: Deps = {
    fetch: fetchMock,
    env: {},
    now: () => new Date("2026-10-08T15:00:00Z"), // Thursday 11:00 ET
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    color: false,
    ...over,
  };
  return { d, out, err };
}

const search = { "price_feeds?query=NVDA": [{ id: NVDA, attributes: { symbol: "Equity.US.NVDA/USD", description: "NVIDIA CORP / US DOLLAR", schedule: NY } }] };
const latest = {
  "updates/price/latest": {
    parsed: [{ id: NVDA, price: { price: "18240000", conf: "1500", expo: -5, publish_time: 1_791_471_598 }, ema_price: { price: "18200000", conf: "1500", expo: -5, publish_time: 1_791_471_598 } }],
  },
};

describe("parseArgs", () => {
  it("splits positionals and flags", () => {
    expect(parseArgs(["fee", "--pool", "1.2", "--closed", "--oracle", "1"])).toEqual({ positional: ["fee"], flags: { pool: "1.2", closed: true, oracle: "1" } });
  });
});

describe("oracle CLI", () => {
  it("prints help and version", async () => {
    const a = deps();
    expect(await run(["--help"], a.d)).toBe(0);
    expect(a.out.join("\n")).toContain("oracle hours");
    const b = deps();
    expect(await run(["--version"], b.d)).toBe(0);
    expect(b.out).toEqual(["0.1.0"]);
  });

  it("hours: shows open now and the next days", async () => {
    const { d, out } = deps();
    expect(await run(["hours", "--days", "3"], d)).toBe(0);
    expect(out[0]).toBe("NYSE is OPEN now");
    expect(out).toHaveLength(4);
    expect(out[3]).toContain("closed"); // Saturday
  });

  it("feed: resolves a ticker via Pyth search without an API key", async () => {
    const { d, out } = deps({}, search);
    expect(await run(["feed", "nvda"], d)).toBe(0);
    expect(out.join("\n")).toContain(`0x${NVDA}`);
    expect(out.join("\n")).toContain("status    open");
  });

  it("price: requires PYTH_API_KEY", async () => {
    const { d, err } = deps({}, search);
    expect(await run(["price", "NVDA"], d)).toBe(2);
    expect(err[0]).toContain("PYTH_API_KEY");
  });

  it("price: prints live prices with age", async () => {
    const { d, out } = deps({ env: { PYTH_API_KEY: "k" } }, { ...search, ...latest });
    expect(await run(["price", "NVDA"], d)).toBe(0);
    expect(out[0]).toMatch(/NVDA\s+182\.40/);
    expect(out[0]).toContain("2s ago");
  });

  it("premium: computes and classifies", async () => {
    const { d, out } = deps({ env: { PYTH_API_KEY: "k" } }, { ...search, ...latest });
    expect(await run(["premium", "NVDA", "184.40"], d)).toBe(0);
    expect(out[1]).toContain("premium +109.6 bps (watch)");
  });

  it("fee: matches StockGuardHook behaviour", async () => {
    const a = deps();
    expect(await run(["fee", "--pool", "1", "--oracle", "1"], a.d)).toBe(0);
    expect(a.out[0]).toContain("fee 0.30%");
    const b = deps();
    expect(await run(["fee", "--pool", "1", "--oracle", "1.03"], b.d)).toBe(3);
    expect(b.out[0]).toContain("DeviationTooHigh");
    const c = deps();
    expect(await run(["fee", "--pool", "1", "--oracle", "1", "--closed"], c.d)).toBe(0);
    expect(c.out[0]).toContain("fee 1.00%");
  });

  it("reports usage errors and unknown commands", async () => {
    const a = deps();
    expect(await run(["fee"], a.d)).toBe(1);
    expect(a.err[0]).toMatch(/^Usage:/);
    const b = deps();
    expect(await run(["nope"], b.d)).toBe(1);
    expect(b.err[0]).toContain("Unknown command");
  });
});
