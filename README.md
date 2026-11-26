# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wongjinwei/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wongjinwei/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A static dashboard + ranked board: read the sealed DefiLlama snapshot
(2026-11-14, 758 protocols), find the protocols that record no token, rank
them by what a token would be worth, and give each one a six-step farm plan.
A live-token view shows the 24 largest tokens by market cap for comparison
only — they are never ranked.

## Run it

```sh
# from this repository root; the grader runs with /input and /output
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
# then serve the output directory and open dashboard/index.html
python3 -m http.server 8123 --directory out
# open http://localhost:8123/dashboard/index.html
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes
`board.json` (`{rows}`: 200 rows — the 40 watchlist protocols plus the 160
highest-TVL pre-token protocols below the $50M floor), writes `data.js`
(`window.RADAR`, everything the page renders), copies `dashboard/` and
`screenshots/` to the output directory, and writes `dossier.json` last with
`buildDossier` from `vendor/makefun-board.ts`.

## Model — radar-2

Implied value = TVL × category multiple × growth × maturity × chains, where
the category multiple is the median mcap/TVL among live-token protocols in
the same category — used only when at least 3 live protocols back it and the
median is positive; thinner, degenerate or empty categories fall back to the
global median — growth is the 7-day TVL change clamped to −60%…+120% and
weighted 0.5, maturity is 0.6 + min(age, 1095)/1095 × 0.4 (unknown age counts
as 365 days), and chains multiply by 1 + 0.02 × min(chain count, 5); the
result is rounded to whole dollars. Only the snapshot's own figures are used
— no list of names is hardcoded. A protocol "records no token" when its DefiLlama record carries
no market cap, CoinGecko id or symbol.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ey7kcc1p&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
