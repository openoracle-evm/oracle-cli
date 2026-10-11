import {
  EQUITY_FEEDS,
  NYSE_SCHEDULE,
  PythClient,
  PythError,
  classifyPremium,
  marketStatus,
  parseSchedule,
  premiumBps,
  quoteStockGuardFee,
  type EquitySymbol,
} from "@openoracle/sdk";

export const VERSION = "0.1.0";

export type Deps = {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: () => Date;
  out: (line: string) => void;
  err: (line: string) => void;
  color: boolean;
};

const paint = (on: boolean) => {
  const c = (code: number) => (s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { green: c(32), red: c(31), yellow: c(33), dim: c(2), bold: c(1) };
};

const HELP = `oracle ${VERSION} — Open Oracle in your terminal

Usage
  oracle hours [--days N]                 NYSE session today and the next N days (default 7)
  oracle feed <TICKER>                    Pyth feed id, schedule and open/closed status
  oracle price <TICKER> [TICKER…]         Live prices from Pyth            (needs PYTH_API_KEY)
  oracle premium <TICKER> <TOKEN_PRICE>   Token premium vs the real price  (needs PYTH_API_KEY)
  oracle fee --pool P --oracle O [--age S] [--closed] [--sell]
                                          Fee StockGuardHook would charge
  oracle --help | --version

Examples
  oracle hours --days 3
  oracle feed NVDA
  PYTH_API_KEY=… oracle price NVDA TSLA AAPL
  oracle fee --pool 184.2 --oracle 182.4
`;

/** Minimal flag parser: positional args plus --flag value / --flag. */
export function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

async function resolveFeed(ticker: string, pyth: PythClient) {
  const sym = ticker.toUpperCase();
  const known = EQUITY_FEEDS[sym as EquitySymbol];
  const feeds = await pyth.searchEquityFeeds(sym);
  const exact = feeds.find((f) => f.symbol === `Equity.US.${sym}/USD`) ?? (known ? undefined : feeds.find((f) => f.symbol.split(".").pop()?.startsWith(`${sym}/`)));
  if (exact) return exact;
  if (known) return { id: known, symbol: `Equity.US.${sym}/USD`, description: sym, schedule: NYSE_SCHEDULE };
  return null;
}

export async function run(argv: string[], deps: Deps): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const c = paint(deps.color);
  const [cmd, ...args] = positional;

  if (flags.version) {
    deps.out(VERSION);
    return 0;
  }
  if (!cmd || flags.help || cmd === "help") {
    deps.out(HELP);
    return cmd || flags.help ? 0 : 1;
  }

  const pyth = new PythClient({ apiKey: deps.env.PYTH_API_KEY, endpoint: deps.env.PYTH_ENDPOINT, fetch: deps.fetch });

  try {
    switch (cmd) {
      case "hours": {
        const days = Math.min(30, Math.max(1, Number(flags.days ?? 7) || 7));
        const schedule = parseSchedule(NYSE_SCHEDULE);
        const now = deps.now();
        const st = marketStatus(schedule, now);
        deps.out(`NYSE is ${st.open ? c.green("OPEN") : c.red("CLOSED")} now`);
        for (let d = 0; d < days; d++) {
          const day = new Date(now.getTime() + d * 86_400_000);
          const s = marketStatus(schedule, day);
          const label = day.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
          const note = s.holiday ? c.yellow(s.halfDay ? " half day" : " holiday") : "";
          deps.out(`  ${label.padEnd(12)} ${s.session === "closed" ? c.dim("closed") : s.session}${note}`);
        }
        return 0;
      }

      case "feed": {
        const ticker = args[0];
        if (!ticker) throw new UsageError("oracle feed <TICKER>");
        const f = await resolveFeed(ticker, pyth);
        if (!f) {
          deps.err(`No Pyth equity feed found for ${ticker.toUpperCase()}`);
          return 1;
        }
        deps.out(`${c.bold(f.symbol)}  ${c.dim(f.description)}`);
        deps.out(`id        ${f.id}`);
        if (f.schedule) {
          const st = marketStatus(f.schedule, deps.now());
          deps.out(`timezone  ${f.schedule.split(";")[0]}`);
          deps.out(`today     ${st.session}`);
          deps.out(`status    ${st.open ? c.green("open") : c.red("closed")}`);
        }
        return 0;
      }

      case "price":
      case "premium": {
        if (!deps.env.PYTH_API_KEY) {
          deps.err("Set PYTH_API_KEY to fetch live prices (free trial at the Pyth Terminal).");
          return 2;
        }
        const tickers = cmd === "premium" ? args.slice(0, 1) : args;
        if (!tickers.length) throw new UsageError(cmd === "premium" ? "oracle premium <TICKER> <TOKEN_PRICE>" : "oracle price <TICKER> [TICKER…]");
        const resolved = await Promise.all(tickers.map(async (t) => ({ t: t.toUpperCase(), f: await resolveFeed(t, pyth) })));
        const missing = resolved.filter((r) => !r.f).map((r) => r.t);
        if (missing.length) {
          deps.err(`No Pyth equity feed for: ${missing.join(", ")}`);
          return 1;
        }
        const prices = await pyth.latestPrices(resolved.map((r) => r.f!.id));
        const byId = new Map(prices.map((p) => [p.id, p]));
        const nowSec = Math.floor(deps.now().getTime() / 1000);

        if (cmd === "price") {
          for (const { t, f } of resolved) {
            const p = byId.get(f!.id);
            if (!p) continue;
            deps.out(`${t.padEnd(7)} ${p.price.toFixed(2).padStart(10)}  ${c.dim(`±${p.confidence.toFixed(3)} · ${nowSec - p.publishTime}s ago`)}`);
          }
          return 0;
        }

        const token = Number(args[1]);
        if (!Number.isFinite(token) || token <= 0) throw new UsageError("oracle premium <TICKER> <TOKEN_PRICE>");
        const p = byId.get(resolved[0]!.f!.id)!;
        const bps = premiumBps(token, p.price);
        const level = classifyPremium(bps);
        const tint = level === "alert" ? c.red : level === "watch" ? c.yellow : c.green;
        deps.out(`${resolved[0]!.t}  real ${p.price.toFixed(2)} · token ${token.toFixed(2)}`);
        deps.out(`${bps >= 0 ? "premium" : "discount"} ${tint(`${bps >= 0 ? "+" : ""}${bps.toFixed(1)} bps`)} ${c.dim(`(${level})`)}`);
        return 0;
      }

      case "fee": {
        const pool = Number(flags.pool);
        const oracle = Number(flags.oracle);
        if (!(pool > 0) || !(oracle > 0)) throw new UsageError("oracle fee --pool P --oracle O [--age S] [--closed] [--sell]");
        const q = quoteStockGuardFee({
          poolPrice: pool,
          oraclePrice: oracle,
          oracleAgeSeconds: Number(flags.age ?? 0) || 0,
          marketOpen: !flags.closed,
          buyingStock: !flags.sell,
        });
        if (q.ok) {
          deps.out(`fee ${c.bold(`${(q.fee / 10_000).toFixed(2)}%`)}  ${c.dim(`deviation ${q.deviationBps} bps${q.movingAway ? " · surcharge applied" : ""}`)}`);
          return 0;
        }
        deps.out(`${c.red("swap reverts")}  ${q.detail}`);
        return 3;
      }

      default:
        deps.err(`Unknown command "${cmd}". Run oracle --help.`);
        return 1;
    }
  } catch (e) {
    if (e instanceof UsageError) {
      deps.err(`Usage: ${e.message}`);
      return 1;
    }
    if (e instanceof PythError) {
      deps.err(`Pyth error${e.status ? ` ${e.status}` : ""}: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

export class UsageError extends Error {}
