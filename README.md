# oracle-cli

**Open Oracle** in your terminal: stock prices from Pyth, market hours, tokenized-stock premium and StockGuardHook fee quotes.

```text
$ oracle hours --days 4
NYSE is OPEN now
  Thu, Oct 8   09:30–16:00
  Fri, Oct 9   09:30–16:00
  Sat, Oct 10  closed
  Sun, Oct 11  closed

$ oracle feed GOOGL
Equity.US.GOOGL/USD  ALPHABET INC CLASS A / US DOLLAR
id        0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6
timezone  America/New_York
today     09:30–16:00
status    open

$ oracle fee --pool 184.2 --oracle 182.4
fee 0.50%  deviation 98 bps · surcharge applied
```

## Install

```bash
npm install -g github:openoracle-evm/oracle-cli
oracle --help
```

Or run from a clone: `npm install && npm run build && node dist/bin.js --help`.

## Commands

| Command | Needs key | |
|---|---|---|
| `oracle hours [--days N]` | no | NYSE session today and the next N days, holidays included |
| `oracle feed <TICKER>` | no | Pyth feed id, time zone and open/closed status for any listed equity |
| `oracle price <TICKER> [TICKER…]` | yes | Live prices with confidence and age |
| `oracle premium <TICKER> <TOKEN_PRICE>` | yes | Premium or discount of a token vs. the real price, in bps |
| `oracle fee --pool P --oracle O [--age S] [--closed] [--sell]` | no | Fee [StockGuardHook](https://github.com/openoracle-evm/stockguard-hook) would charge, or why the swap would revert |

Exit codes: `0` ok · `1` usage error or unknown ticker · `2` missing key or Pyth error · `3` the swap would revert.

## API key

Live prices come from Pyth Hermes, which requires an API key (free trial at the Pyth Terminal):

```bash
export PYTH_API_KEY=...
oracle price NVDA TSLA AAPL
```

`feed` and `hours` work without a key. Set `NO_COLOR=1` to disable colours.

## Built on

[`oracle-sdk`](https://github.com/openoracle-evm/oracle-sdk). For local development the dependency points to `../oracle-sdk`; in a standalone clone run
`npm pkg set "dependencies.@openoracle/sdk=github:openoracle-evm/oracle-sdk"` first.

## License

MIT
