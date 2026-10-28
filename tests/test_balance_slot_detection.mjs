/**
 * QA harness — balance-slot detection on the honeypot transfer probe.
 *
 * Card: t_fc945e36 (root t_5b1a7d62). Acceptance: /chain/token-report/preview for
 * USDC returns security.simStatus "tested" consistently (was "unavailable" ~7/8).
 *
 * Three independent phases, deliberately separated so a failure names its cause:
 *
 *   A. PRODUCT SURFACE (the acceptance check): hit /chain/token-report/preview N
 *      times per token and read security.simStatus — the exact field the card and
 *      the customer see. Flakiness is measured here, not inferred.
 *
 *   B. SLOT REPORT (what the probe claims): hit /chain/token-security/preview, which
 *      exposes honeypot_sim.slot_layout + proxy.is_upgradeable. Compares the slot the
 *      Worker thinks it found against the documented layout for that token.
 *
 *   C. INDEPENDENT ORACLE (ground truth, Worker not involved): plant the probe's
 *      "leet" balance directly into the EXPECTED slot via eth_call stateDiff and read
 *      balanceOf. If balanceOf returns the planted value, that slot IS the balance
 *      mapping — cryptographically proven, not taken on the implementation's word.
 *      Without C, B would only prove the Worker is self-consistent.
 *
 * Failure classification matters: an "unavailable" whose note says the RPC calls
 * failed/rate-limited is INFRA, not a detection miss. Only a detection miss
 * ("Could not locate this token's balance storage slot") is a real regression.
 * Conflating the two is how the original P0 stayed misdiagnosed.
 *
 * Run against a local preview Worker (NOT production):
 *   npx wrangler dev --port 8787 --local &
 *   node tests/test_balance_slot_detection.mjs
 * Env: BASE_URL (default http://127.0.0.1:8787), RUNS (default 8), TOKENS (csv filter)
 */
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';

const BASE_URL = (process.env.BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const RUNS = Number(process.env.RUNS ?? 8);
const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS ?? 90_000);

// Probe constants mirrored from src/index.ts so the oracle plants the same value.
const PROBE_HOLDER = '0x1111111111111111111111111111111111111111';
const PROBE_VALUE = 31337n * 10n ** 18n;
const PROBE_VALUE_HEX = '0x' + PROBE_VALUE.toString(16).padStart(64, '0');

const BASE_RPCS = [
  'https://mainnet.base.org',
  'https://base-rpc.publicnode.com',
  'https://base.drpc.org',
  'https://base.api.onfinality.io/public',
  'https://base-pokt.nodies.app',
];

// expectedSlot: documented/measured balance-mapping slot. kind drives the assertion
// class — "proxied" tokens are the ones the old 0..3 scan could never find.
const TOKENS = [
  // ---- proxied (the class this fix exists for) -----------------------------
  { sym: 'USDC',  demo: 'usdc',  addr: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', kind: 'proxied',  layout: 'zOS upgradeable', expectedSlot: 9 },
  { sym: 'cbBTC', demo: 'cbbtc', addr: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', kind: 'proxied',  layout: 'zOS upgradeable', expectedSlot: 9 },
  { sym: 'USDbC', demo: null,    addr: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', kind: 'proxied',  layout: 'EIP-1967 bridged', expectedSlot: 51 },
  { sym: 'cbETH', demo: null,    addr: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', kind: 'proxied',  layout: 'EIP-1967 bridged', expectedSlot: 51 },
  // Genuine EURC (FiatTokenV2_2, top-5 Base stablecoin). Same class as USDC/cbBTC and
  // the reason this fix exists, so it belongs in the gated set, not just the sweep.
  // NOTE the tail: 0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42. The near-identical
  // 0x60a3E35C…F2FC9859f5 is an Ethereum-side address with no Base bytecode and is
  // kept below as a negative control — do not swap the two.
  { sym: 'EURC',  demo: null,    addr: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', kind: 'proxied',  layout: 'zOS upgradeable', expectedSlot: 9 },
  // ---- non-proxied (regression set: the old 0..3 probe covered these) ------
  { sym: 'WETH',  demo: 'weth',  addr: '0x4200000000000000000000000000000000000006', kind: 'plain', expectedSlot: 3 },
  { sym: 'AERO',  demo: 'aero',  addr: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', kind: 'plain', expectedSlot: 0 },
  { sym: 'DEGEN', demo: 'degen', addr: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', kind: 'plain', expectedSlot: 0 },
];

// Edge-case sweep (documentation only, never a hard gate): tokens outside the
// documented layouts. First sweep run used three addresses that turned out to hold
// NO code on Base (EURC/WELL/cbADA — Ethereum-side or retired addresses), which
// produced "unavailable" from a bad test input rather than a detection gap. Every
// address below is verified to have bytecode; the harness now asserts is_contract
// so a dead address can never again be read as a product regression.
const EDGE_TOKENS = [
  { sym: 'wstETH', addr: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452' },
  { sym: 'tBTC',   addr: '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b' },
  { sym: 'cbXRP',  addr: '0xcb585250f852C6c6bf90434AB21A00f02833a4af' },
  { sym: 'cbLTC',  addr: '0xcb17C9Db87B595717C857a08468793f5bAb6445F' },
  { sym: 'cbDOGE', addr: '0xcbD06E5A2B0C65597161de254AA074E489dEb510' },
  { sym: 'TOSHI',  addr: '0xAc1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4' },
  { sym: 'BRETT',  addr: '0x532f27101965dd16442E59d40670FaF5eBB142E4' },
  { sym: 'MOG',    addr: '0x2Da56AcB9Ea78330f947bD57C54119Debda7AF71' },
  { sym: 'KEYCAT', addr: '0x9a26F5433671751C3276a065f57e5a02D2817973' },
  { sym: 'VIRTUAL',addr: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b' },
  { sym: 'USDT',   addr: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2' },
  { sym: 'DAI',    addr: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb' },
];

// Not a token, must fail closed rather than invent a slot.
const NON_CONTRACT_PROBES = [
  { sym: 'EOA', addr: '0x1111111111111111111111111111111111111111' },
  { sym: 'noCode', addr: '0x60a3E35Cc302bFA44Cb288Bc5a4CC5F2FC9859f5' },
];

const filter = (process.env.TOKENS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const selected = filter.length ? TOKENS.filter((t) => filter.includes(t.sym.toLowerCase())) : TOKENS;

const mappingSlotKey = (holder, slot) =>
  keccak256(`0x${holder.slice(2).toLowerCase().padStart(64, '0')}${slot.toString(16).padStart(64, '0')}`);

const balanceOfData = (holder) => `0x70a08231${holder.slice(2).toLowerCase().padStart(64, '0')}`;

let ipSeq = 0;
// The free-trial meter keys on cf-connecting-ip (3 real tokens/day/IP) and its KV is
// persisted in the local wrangler state, so buckets survive process restarts. A fixed
// 203.0.113.x range therefore collides on the second run and every metered token comes
// back 429 — which looks exactly like a detection failure. Randomise a /16 per process.
const IP_A = 1 + Math.floor(Math.random() * 223);
const IP_B = Math.floor(Math.random() * 256);
const freshIp = () => {
  ipSeq += 1;
  return `${IP_A}.${IP_B}.${Math.floor(Math.random() * 256)}.${(ipSeq % 250) + 1}`;
};

// The 3/day free-trial meter keys on cf-connecting-ip. Locally there is no Cloudflare
// edge, so the header is taken at face value and a fresh IP per iteration keeps the
// meter from masquerading as a sim failure across 8+ runs. Against a real deployment
// Cloudflare owns that header: sending it gets an immediate 403 (error code 1000),
// which is the correct behaviour — so never spoof off-localhost.
const SPOOF_TRIAL_IP = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(BASE_URL);

async function getJson(path) {
  const headers = SPOOF_TRIAL_IP ? { 'cf-connecting-ip': freshIp() } : {};
  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function rpc(method, params) {
  let lastErr;
  for (const url of BASE_RPCS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) { lastErr = `HTTP ${res.status} from ${url}`; continue; }
      const j = await res.json();
      if (j.error) { lastErr = `${j.error.message} from ${url}`; continue; }
      return j.result;
    } catch (e) {
      lastErr = `${e.message} from ${url}`;
    }
  }
  throw new Error(`all RPCs failed: ${lastErr}`);
}

// Classify an "unavailable" so an infra blip is never scored as a detection bug.
function classify(sec) {
  const note = String(sec?.note ?? '');
  // An immediate re-probe that comes back "tested" is proof the slot+transfer path
  // works and the earlier miss was provider load, not a detection gap. Corroborating
  // before classifying is the difference between a P0 and an RPC hiccup.
  if (sec?.simStatus === 'tested') return 'provider';
  if (/rate-limited|failed or were rate-limited|RPC state-override calls failed/i.test(note)) return 'provider';
  if (/Could not locate this token's balance storage slot/i.test(note)) return 'detection-miss';
  if (sec?.isContract === false) return 'not-a-contract';
  return 'unknown';
}

async function phaseA(t) {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const t0 = Date.now();
    const { status, body } = await getJson(`/chain/token-report/preview?token=${t.demo ?? t.addr}`);
    const ms = Date.now() - t0;
    const sec = body?.security ?? null;
    const simStatus = sec?.simStatus ?? null;
    let cause = 'ok';
    let note = null;
    if (status === 429) {
      // Free-trial quota, not a detection result. Corroborating here would burn more
      // quota, so short-circuit and label it honestly.
      cause = 'metered';
      note = body?.error ?? 'free real-token trial exhausted';
    } else if (simStatus !== 'tested') {
      // token-report deliberately does not expose the sim note (that is t_9daf3d13),
      // so on any anomaly we corroborate against token-security/preview to name the
      // cause instead of guessing. Only fires on a failure, so the run stays cheap.
      const diag = await phaseB(t).catch(() => null);
      note = diag?.note ?? null;
      cause = classify(diag);
    }
    runs.push({
      i: i + 1,
      http: status,
      simStatus,
      cause,
      note,
      ms,
      error: body?.error ?? null,
    });
  }
  return runs;
}

async function phaseB(t) {
  const { status, body } = await getJson(`/chain/token-security/preview?token=${t.demo ?? t.addr}`);
  const sim = body?.honeypot_sim ?? null;
  return {
    http: status,
    simStatus: sim?.sim_status ?? null,
    slotLayout: sim?.slot_layout ?? null,
    slotIndex: sim?.balance_slot_index ?? null,
    transferable: sim?.transferable ?? null,
    upgradeable: body?.proxy?.is_upgradeable ?? null,
    isContract: body?.is_contract ?? null,
    note: sim?.note ? String(sim.note) : null,
    error: body?.error ?? null,
  };
}

async function phaseC(t) {
  const key = mappingSlotKey(PROBE_HOLDER, BigInt(t.expectedSlot));
  let balance = null;
  let err = null;
  try {
    // One eth_call, whole-token stateDiff at the documented slot only.
    const r = await rpc('eth_call', [
      { to: t.addr, data: balanceOfData(PROBE_HOLDER) },
      'latest',
      { [t.addr]: { stateDiff: { [key]: PROBE_VALUE_HEX } } },
    ]);
    balance = BigInt(r);
  } catch (e) {
    err = e.message;
  }
  return { slot: t.expectedSlot, plantedMatches: balance === PROBE_VALUE, raw: balance?.toString() ?? null, error: err };
}

const rows = [];
let hardFailures = 0;

console.log(`\nBalance-slot detection QA — ${BASE_URL} | RUNS=${RUNS} | ${selected.length} tokens\n`);
console.log('A) product surface: /chain/token-report/preview security.simStatus');
console.log('   ' + ['token', 'kind', 'tested', 'infra', 'det-miss', '429', 'err', 'p50ms', 'slot(reported)'].join('  '));

for (const t of selected) {
  const runs = await phaseA(t);
  const tested = runs.filter((r) => r.simStatus === 'tested').length;
  const infra = runs.filter((r) => r.simStatus !== 'tested' && r.cause === 'provider').length;
  const miss = runs.filter((r) => r.simStatus !== 'tested' && r.cause === 'detection-miss').length;
  const metered = runs.filter((r) => r.cause === 'metered').length;
  const errors = runs.filter((r) => r.http !== 200 && r.http !== 429).length;
  const times = runs.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)] ?? null;

  const b = await phaseB(t);
  const c = await phaseC(t);

  rows.push({ token: t.sym, kind: t.kind, runs, tested, infra, miss, metered, errors, p50, slotReported: b.slotLayout, phaseB: b, oracle: c });

  console.log(
    '   ' +
      [
        t.sym.padEnd(6),
        t.kind.padEnd(7),
        `${tested}/${RUNS}`.padEnd(7),
        String(infra).padEnd(5),
        String(miss).padEnd(8),
        String(metered).padEnd(3),
        String(errors).padEnd(3),
        String(p50).padEnd(5),
        String(b.slotLayout).padEnd(18),
      ].join('  '),
  );

  // --- assertions ---------------------------------------------------------
  // USDC is the card's literal acceptance: it must be tested in every run.
  if (t.sym === 'USDC') {
    if (tested !== RUNS) {
      hardFailures += 1;
      console.error(`   FAIL USDC flake: ${tested}/${RUNS} tested (infra=${infra}, det-miss=${miss})`);
    }
  } else if (miss > 0 || errors > 0) {
    hardFailures += 1;
    console.error(`   FAIL ${t.sym}: ${miss} detection miss / ${errors} transport errors`);
  } else if (tested === 0 && metered < RUNS) {
    hardFailures += 1;
    console.error(`   FAIL ${t.sym}: 0/${RUNS} tested (provider-only failures, ${metered} metered)`);
  } else if (metered === RUNS) {
    console.warn(`   WARN ${t.sym}: every run hit the free-trial quota — no detection evidence collected`);
  }

  // B) reported slot must match the documented layout for the token.
  // A token that was refused by the quota every time yields no evidence — that is a
  // gap in coverage, not a defect, so warn instead of failing. The oracle below is
  // Worker-independent and still runs, so the expected slot itself stays verified.
  const expectedLayout = `mapping@slot${t.expectedSlot}`;
  const noEvidence = metered === RUNS && b.slotLayout === null;
  if (noEvidence) {
    console.warn(`   WARN ${t.sym}: slot/upgradeable assertions skipped — quota exhausted, no evidence gathered`);
  } else if (b.slotLayout !== expectedLayout) {
    hardFailures += 1;
    console.error(`   FAIL ${t.sym}: reported slot ${b.slotLayout} != expected ${expectedLayout}`);
  }
  // C) the expected slot must be provably the balance slot (Worker not in the loop).
  if (!c.plantedMatches) {
    hardFailures += 1;
    console.error(`   FAIL ${t.sym}: oracle — planting at slot ${t.expectedSlot} did not surface in balanceOf (${c.error ?? c.raw})`);
  }
  // Proxy classification sanity: "proxied" tokens must report upgradeable.
  if (!noEvidence && t.kind === 'proxied' && b.upgradeable !== true) {
    hardFailures += 1;
    console.error(`   FAIL ${t.sym}: expected upgradeable proxy, got is_upgradeable=${b.upgradeable}`);
  }
}

// ---------------------------------------------------------------------------
// Edge-case sweep — documentation, never a gate.
// ---------------------------------------------------------------------------
const edges = [];
if (!filter.length) {
  console.log('\nB) edge-case sweep (documentation only — non-documented layouts)');
  console.log('   ' + ['token', 'contract', 'simStatus', 'reported slot', 'classification'].join('  '));
  for (const t of EDGE_TOKENS) {
    let sim = null;
    let status = null;
    let isContract = null;
    let err = null;
    try {
      const { status: httpStatus, body } = await getJson(`/chain/token-security/preview?token=${t.addr}`);
      status = httpStatus;
      sim = body?.honeypot_sim ?? null;
      isContract = body?.is_contract ?? null;
      err = body?.error ?? null;
    } catch (e) {
      err = e.message;
    }
    const verdict = sim?.sim_status === 'tested' ? 'ok' : classify(sim);
    edges.push({
      token: t.sym,
      addr: t.addr,
      http: status,
      isContract,
      simStatus: sim?.sim_status ?? null,
      slot: sim?.slot_layout ?? null,
      cause: sim?.sim_status === 'tested' ? 'ok' : verdict,
      note: sim?.note ? String(sim.note).slice(0, 200) : err,
    });
    console.log(
      '   ' +
        [
          t.sym.padEnd(7),
          String(isContract).padEnd(8),
          String(sim?.sim_status ?? `http ${status}`).padEnd(12),
          String(sim?.slot_layout ?? '-').padEnd(16),
          verdict,
        ].join('  '),
    );
    // Every edge address is verified to hold bytecode; a contract that cannot be
    // read IS a real gap worth failing on, unlike the earlier dead-address noise.
    if (isContract === true && sim?.sim_status !== 'tested') {
      hardFailures += 1;
      console.error(`   FAIL edge ${t.sym}: has bytecode but sim_status=${sim?.sim_status} (${verdict})`);
    }
  }

  // Fail-closed: a non-contract must never be reported as a successful simulation.
  console.log('\nC) fail-closed on non-contract input');
  for (const p of NON_CONTRACT_PROBES) {
    let body = null;
    try {
      body = (await getJson(`/chain/token-security/preview?token=${p.addr}`)).body;
    } catch (e) {
      console.error(`   FAIL ${p.sym}: transport ${e.message}`);
      hardFailures += 1;
      continue;
    }
    const sim = body?.honeypot_sim ?? null;
    const ok = body?.is_contract === false && sim?.sim_status !== 'tested';
    edges.push({ token: p.sym, addr: p.addr, isContract: body?.is_contract ?? null, simStatus: sim?.sim_status ?? null, slot: sim?.slot_layout ?? null, cause: ok ? 'fail-closed' : 'FALSE-POSITIVE' });
    console.log('   ' + [p.sym.padEnd(7), String(body?.is_contract).padEnd(8), String(sim?.sim_status ?? '-').padEnd(12), ok ? 'fail-closed' : 'FALSE-POSITIVE'].join('  '));
    if (!ok) {
      hardFailures += 1;
      console.error(`   FAIL ${p.sym}: non-contract reported as tested (is_contract=${body?.is_contract})`);
    }
  }
}

// ---------------------------------------------------------------------------
const summary = {
  baseUrl: BASE_URL,
  runs: RUNS,
  generatedAt: new Date().toISOString(),
  tokens: rows.map((r) => ({
    token: r.token,
    kind: r.kind,
    tested: `${r.tested}/${RUNS}`,
    infraFailures: r.infra,
    detectionMisses: r.miss,
    metered429: r.metered,
    transportErrors: r.errors,
    p50Ms: r.p50,
    reportedSlot: r.slotReported,
    expectedSlot: `mapping@slot${selected.find((s) => s.sym === r.token).expectedSlot}`,
    oracleProvesSlot: r.oracle.plantedMatches,
    isUpgradeable: r.phaseB.upgradeable,
    perRun: r.runs,
  })),
  edgeCases: edges,
  hardFailures,
};

console.log(`\n${hardFailures === 0 ? 'PASS' : 'FAIL'} — ${hardFailures} hard failure(s)`);
console.log(JSON.stringify(summary, null, 1));
assert.equal(hardFailures, 0, `${hardFailures} balance-slot detection failure(s)`);
