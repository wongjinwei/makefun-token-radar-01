// lib/model.ts — Token Radar, model "radar-2".
//
// A fresh implementation written for this entry. It reads the sealed
// DefiLlama snapshot and ranks the protocols that record no token by the
// value a token would have if the protocol's record stayed as it is.
//
// Implied value (all figures from the snapshot itself, never a list of
// names):
//   implied = TVL x category multiple x growth x maturity x chains
//   category multiple = median mcap/TVL among live-token protocols in the
//     same category — used only when at least 3 live protocols back it and
//     the median is positive; thinner, degenerate or empty categories fall
//     back to the global median
//   growth = 1 + clamp(change_7d, -60, 120) / 100 * 0.5 (null change = 0)
//   maturity = 0.6 + min(age_days, 1095) / 1095 * 0.4 (unknown age = 365d)
//   chains = 1 + 0.02 * min(chain count, 5)
// The result is a positive whole number of dollars.

export const MODEL_VERSION = 'radar-2';

// A category's median counts only when at least this many live-token
// protocols back it and the median is positive: a single live protocol
// (or one whose market cap truncates to zero) is not a comparable. Thin
// or degenerate categories fall back to the global median, as do
// categories with no live sample at all.
export const MIN_LIVE_SAMPLE = 3;

export const GROWTH_MIN = -60;
export const GROWTH_MAX = 120;
export const GROWTH_WEIGHT = 0.5;
export const MATURITY_BASE = 0.6;
export const MATURITY_SPAN_DAYS = 1095;
export const UNKNOWN_AGE_DAYS = 365;
export const CHAIN_STEP = 0.02;
export const CHAIN_CAP = 5;
export const BOARD_SIZE = 200;
export const WATCHLIST_SIZE = 40;
export const EXTRA_ROWS = 160;
export const LIVE_SIZE = 24;

export const VERSIONED_NAME =
  /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelBreakdown {
  base_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  age_days: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'live-token';
  age_days: number;
}

export interface BoardResult {
  rows: BoardRow[];
  live: LiveRow[];
  multiples: Record<string, number>;
  global_multiple: number;
  as_of: string;
  floor_usd: number;
  watchlist_count: number;
}

// ---------------------------------------------------------------- parsing

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function needString(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`snapshot: ${what} must be a string`);
  return v;
}

function needNumber(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`snapshot: ${what} must be a finite number`);
  }
  return v;
}

function needNullOrString(v: unknown, what: string): string | null {
  if (v === null) return null;
  return needString(v, what);
}

function needNullOrNumber(v: unknown, what: string): number | null {
  if (v === null) return null;
  return needNumber(v, what);
}

/** Parse and validate the sealed snapshot; throws on a bad shape. */
export function parseSnapshot(json: unknown): Snapshot {
  if (!isRecord(json)) throw new Error('snapshot: top level must be an object');
  const as_of = needString(json.as_of, 'as_of');
  const source = needString(json.source, 'source');
  const floor_usd = needNumber(json.floor_usd, 'floor_usd');
  if (!Array.isArray(json.protocols)) throw new Error('snapshot: protocols must be an array');
  if (!Array.isArray(json.watchlist)) throw new Error('snapshot: watchlist must be an array');
  const protocols: SnapshotProtocol[] = json.protocols.map((p, i) => {
    if (!isRecord(p)) throw new Error(`snapshot: protocols[${i}] must be an object`);
    if (!Array.isArray(p.chains) || !p.chains.every((c) => typeof c === 'string')) {
      throw new Error(`snapshot: protocols[${i}].chains must be string[]`);
    }
    return {
      slug: needString(p.slug, `protocols[${i}].slug`),
      name: needString(p.name, `protocols[${i}].name`),
      category: needNullOrString(p.category, `protocols[${i}].category`),
      chains: p.chains as string[],
      tvl_usd: needNumber(p.tvl_usd, `protocols[${i}].tvl_usd`),
      change_7d: needNullOrNumber(p.change_7d, `protocols[${i}].change_7d`),
      mcap_usd: needNullOrNumber(p.mcap_usd, `protocols[${i}].mcap_usd`),
      listed_at: needNullOrString(p.listed_at, `protocols[${i}].listed_at`),
      gecko_id: needNullOrString(p.gecko_id, `protocols[${i}].gecko_id`),
      symbol: needNullOrString(p.symbol, `protocols[${i}].symbol`),
    };
  });
  const watchlist = json.watchlist.map((s, i) => needString(s, `watchlist[${i}]`));
  return { as_of, source, floor_usd, protocols, watchlist };
}

// ---------------------------------------------------------------- helpers

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median of no values');
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function parseDay(iso: string): number {
  const [y, m, d] = iso.split('-').map((x) => Number(x));
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** Whole days from listed_at to the snapshot date; null when unlisted. */
export function ageDays(listed_at: string | null, as_of: string): number | null {
  if (listed_at === null) return null;
  const days = parseDay(as_of) - parseDay(listed_at);
  return days < 0 ? 0 : days;
}

/** A protocol records no token: all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Excluded from the early board: CEX rows and versioned names. */
export function isExcludedEarly(p: SnapshotProtocol): boolean {
  return p.category === 'CEX' || VERSIONED_NAME.test(p.name);
}

export function growthMultiplier(change_7d: number | null): number {
  const g = change_7d === null ? 0 : Math.min(GROWTH_MAX, Math.max(GROWTH_MIN, change_7d));
  return 1 + (g / 100) * GROWTH_WEIGHT;
}

export function maturityMultiplier(age: number | null): number {
  const days = age === null ? UNKNOWN_AGE_DAYS : age;
  return MATURITY_BASE + (Math.min(days, MATURITY_SPAN_DAYS) / MATURITY_SPAN_DAYS) * (1 - MATURITY_BASE);
}

export function chainMultiplier(chains: string[]): number {
  return 1 + CHAIN_STEP * Math.min(chains.length, CHAIN_CAP);
}

/** Category comparables: median mcap/TVL among live-token protocols.
 * A category's median is used only with at least MIN_LIVE_SAMPLE live
 * protocols behind it and a positive median; anything thinner or
 * degenerate falls back to the global median, as do empty categories. */
export function categoryMultiples(snapshot: Snapshot): {
  multiples: Record<string, number>;
  global: number;
} {
  const live = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.tvl_usd > 0,
  );
  const global = median(live.map((p) => (p.mcap_usd as number) / p.tvl_usd));
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const cat = p.category ?? 'Uncategorized';
    const arr = byCat.get(cat) ?? [];
    arr.push((p.mcap_usd as number) / p.tvl_usd);
    byCat.set(cat, arr);
  }
  const multiples: Record<string, number> = {};
  for (const [cat, vals] of byCat) {
    if (vals.length >= MIN_LIVE_SAMPLE) {
      const m = median(vals);
      if (m > 0) multiples[cat] = m;
    }
  }
  return { multiples, global };
}

export function impliedValue(
  p: SnapshotProtocol,
  baseMultiple: number,
  asOf: string,
): { implied: number; model: ModelBreakdown } {
  const age = ageDays(p.listed_at, asOf);
  const growthPct = p.change_7d === null ? 0 : Math.min(GROWTH_MAX, Math.max(GROWTH_MIN, p.change_7d));
  const model: ModelBreakdown = {
    base_multiple: baseMultiple,
    growth_pct: growthPct,
    growth_multiplier: growthMultiplier(p.change_7d),
    maturity_multiplier: maturityMultiplier(age),
    chain_multiplier: chainMultiplier(p.chains),
    age_days: age === null ? UNKNOWN_AGE_DAYS : age,
  };
  const raw =
    p.tvl_usd *
    model.base_multiple *
    model.growth_multiplier *
    model.maturity_multiplier *
    model.chain_multiplier;
  return { implied: Math.max(1, Math.round(raw)), model };
}

// ---------------------------------------------------------------- farm plan

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}

/** The protocol's core action, from its own category. No per-name lists. */
export function primaryAction(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('lending')) return 'supply assets as collateral and borrow against them';
  if (c.includes('dex')) return 'add liquidity to a pool and route a swap through it';
  if (c.includes('curat')) return 'allocate to a curated vault and track the curator strategy';
  if (c.includes('cdp')) return 'open a collateralized debt position and keep the ratio healthy';
  if (c.includes('collateral')) return 'lock collateral and manage the position';
  if (c === 'chain') return 'use the chain as a real user: hold assets and transact on it';
  if (c.includes('yield')) return 'deposit into a vault and let the yield compound';
  if (c.includes('derivative')) return 'open a small hedged position and keep it margined';
  if (c.includes('bridge')) return 'bridge a modest amount across to the other side';
  if (c.includes('staking') || c.includes('restak')) return 'stake and keep the position delegated';
  if (c.includes('rwa')) return 'mint or hold a position in a tokenized asset';
  if (c.includes('launchpad')) return 'join a sale allocation and hold the allocation';
  if (c.includes('farm')) return 'deposit into a farm and harvest on schedule';
  if (c.includes('option')) return 'open a small covered position and manage the expiry';
  if (c.includes('prediction')) return 'place a small position on a market and settle it';
  if (c.includes('gaming') || c.includes('nft')) return 'hold the in-game asset and complete a quest';
  if (c.includes('oracle')) return 'run a feed check and stake toward a data request';
  if (c.includes('privacy')) return 'shield a deposit and use the private transfer once';
  return 'use the protocol as a real user: open a position and keep it active';
}

function sizeBand(tvl: number): string {
  if (tvl >= 500_000_000) return '$1,000–$5,000';
  if (tvl >= 100_000_000) return '$500–$2,000';
  return '$100–$500';
}

/** Six concrete steps with a cost and a time on each. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const others = p.chains.length > 1 ? ` (also live on ${p.chains.slice(1, 3).join(', ')})` : '';
  const action = primaryAction(p.category ?? 'Uncategorized');
  const size = sizeBand(p.tvl_usd);
  const days = age === null ? UNKNOWN_AGE_DAYS : age;
  const young = days < 365;
  const holding = young ? '90 days' : '60 days';
  return [
    `Set up a fresh wallet on ${chain}${others}, fund it with ${size} to deploy plus about $20 of gas tokens, and write the seed phrase down offline. Cost: ~$20 in gas. Time: 15 minutes.`,
    `${action[0].toUpperCase()}${action.slice(1)} on ${p.name} with ${size} on ${chain}, in one transaction, and confirm the position shows in the protocol's own dashboard. Cost: ~$5–$25 in gas. Time: 20 minutes.`,
    `Repeat one qualifying action every week for at least 8 weeks — the same ${action.split(' ').slice(0, 4).join(' ')} — so the activity reads as sustained use rather than a single burst. Cost: ~$5–$15 a week in gas. Time: 20 minutes a week.`,
    `Leave the position open for at least ${holding}: the protocol has run ${days} days with no token recorded, so a position closed early can reset activity clocks. Cost: $0 to hold. Time: 5 minutes a week to check it.`,
    `When a claim opens, use only links posted on ${p.name}'s own official site and channels; never sign a blind transaction, never paste a seed phrase, and check the contract address twice. Cost: $0. Time: 10 minutes to verify.`,
    `Keep a farm log: date, wallet, action, amount and transaction hash for every step, and screenshot the position before and after each qualifying action. Cost: $0. Time: 5 minutes per entry.`,
  ];
}

// ---------------------------------------------------------------- board

/** Build the 200-row board plus the 24-row live view. */
export function buildBoard(snapshot: Snapshot): BoardResult {
  const { multiples, global } = categoryMultiples(snapshot);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = snapshot.watchlist
    .map((s) => bySlug.get(s))
    .filter((p): p is SnapshotProtocol => p !== undefined);

  const early = snapshot.protocols
    .filter(
      (p) =>
        isPreToken(p) &&
        p.tvl_usd < snapshot.floor_usd &&
        !isExcludedEarly(p) &&
        !snapshot.watchlist.includes(p.slug),
    )
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, EXTRA_ROWS);

  const picked = [...watch, ...early];
  const rows: BoardRow[] = picked.map((p) => {
    const cat = p.category ?? 'Uncategorized';
    const base = multiples[cat] ?? global;
    const { implied, model } = impliedValue(p, base, snapshot.as_of);
    const age = ageDays(p.listed_at, snapshot.as_of);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: cat,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: age === null ? UNKNOWN_AGE_DAYS : age,
      implied_value_usd: implied,
      model,
      farm_steps: farmSteps(p, age),
    };
  });
  rows.sort((a, b) =>
    b.implied_value_usd - a.implied_value_usd !== 0
      ? b.implied_value_usd - a.implied_value_usd
      : a.slug < b.slug
        ? -1
        : 1,
  );
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, LIVE_SIZE)
    .map((p) => {
      const age = ageDays(p.listed_at, snapshot.as_of);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category ?? 'Uncategorized',
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        mcap_usd: p.mcap_usd,
        listed_at: p.listed_at,
        gecko_id: p.gecko_id,
        symbol: p.symbol,
        token_status: 'live-token',
        age_days: age === null ? UNKNOWN_AGE_DAYS : age,
      };
    });

  return {
    rows,
    live,
    multiples,
    global_multiple: global,
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    watchlist_count: watch.length,
  };
}

// ---------------------------------------------------------------- checks

/** The gate's own checks, run locally before writing: returns issues. */
export function boardIssue(rows: BoardRow[], watchlist: string[]): string[] {
  const issues: string[] = [];
  if (rows.length < 100 || rows.length > 4000) {
    issues.push(`board has ${rows.length} rows, need 100..4000`);
  }
  const slugs = new Set<string>();
  for (const r of rows) {
    if (slugs.has(r.slug)) issues.push(`duplicate slug ${r.slug}`);
    slugs.add(r.slug);
  }
  for (const s of watchlist) {
    if (!slugs.has(s)) issues.push(`watchlist slug ${s} missing from board`);
  }
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) {
      issues.push(`ranks are not exactly 1..${rows.length}`);
      break;
    }
  }
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) {
      issues.push(`implied rises at rank ${byRank[i].rank}`);
      break;
    }
  }
  if (byRank.length > 1 && byRank.every((r) => r.implied_value_usd === byRank[0].implied_value_usd)) {
    issues.push('all implied values are equal');
  }
  for (const r of rows) {
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      issues.push(`row ${r.slug} has a bad implied value`);
      break;
    }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      issues.push(`row ${r.slug} has ${r.farm_steps?.length} farm steps, need 3..12`);
      break;
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) {
        issues.push(`row ${r.slug} has a farm step of ${t.length} chars, need 20..600`);
        break;
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------- data.js

/** The dashboard's data file: `window.RADAR = {...}`. */
export function dataScript(result: BoardResult): string {
  const payload = {
    version: MODEL_VERSION,
    as_of: result.as_of,
    floor_usd: result.floor_usd,
    watchlist_count: result.watchlist_count,
    global_multiple: result.global_multiple,
    multiples: result.multiples,
    constants: {
      growth_min: GROWTH_MIN,
      growth_max: GROWTH_MAX,
      growth_weight: GROWTH_WEIGHT,
      maturity_base: MATURITY_BASE,
      maturity_span_days: MATURITY_SPAN_DAYS,
      unknown_age_days: UNKNOWN_AGE_DAYS,
      chain_step: CHAIN_STEP,
      chain_cap: CHAIN_CAP,
      min_live_sample: MIN_LIVE_SAMPLE,
    },
    rows: result.rows,
    live: result.live,
  };
  return `window.RADAR = ${JSON.stringify(payload)};\n`;
}
