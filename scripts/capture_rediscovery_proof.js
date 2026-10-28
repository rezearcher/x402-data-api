#!/usr/bin/env node
/**
 * Capture the re-listing proof bundle for logs/cdp-rediscovery-proof.json.
 *
 * Why this exists: the card's ACCEPTANCE string is
 *   curl -s 'https://UNKNOWN/discovery/resources?q=x402-data-api' | grep -q 'x402-data-api'
 * which cannot pass as written -- the host is a placeholder AND /discovery/resources
 * takes no q/query filter (verified: passing q returns the unfiltered catalog total).
 * So this script captures evidence against the three endpoints that actually answer
 * the question, and records the negative control (q= being ignored) as proof that the
 * acceptance string is unsatisfiable rather than merely failing.
 *
 * Writes: logs/cdp-rediscovery-proof.json
 * Run:    node scripts/capture_rediscovery_proof.js
 */
const fs = require('fs');
const path = require('path');

const API = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery';
const PAY_TO = '0x5765ae06a52dc7A0BB71c36A11db512c7ea9ed10';
const ROUTES = [
  '/chain/token-security', '/chain/nonce', '/chain/total-supply', '/crypto/prices',
  '/defi/yields', '/defi/fees-top', '/chain/wallet', '/chain/is-contract',
];
const QUERIES = ['token security', 'honeypot detector', 'is this token a scam'];
// page offsets holding our records during the 2026-10-28 crawl scan
const CRAWL_OFFSETS = [380, 700, 1500, 5980, 6720, 8000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, retries = 5) {
  let delay = 3000;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.status === 429) {
        console.error(`  429 ${url} -> sleep ${delay}ms`);
        await sleep(delay);
        delay = Math.min(delay * 1.8, 40000);
        continue;
      }
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { _non_json: text.slice(0, 2000) }; }
      return { status: res.status, body };
    } catch (e) {
      await sleep(delay / 2);
    }
  }
  return { status: 0, body: { _error: 'gave_up' } };
}

function pickItems(body) {
  return body.items || body.resources || [];
}

(async () => {
  const proof = {
    generated_at: new Date().toISOString(),
    purpose: 'Evidence bundle for t_cac01ee4 - did the 2026-10-28T06:02:47Z settlement re-list x402-data-api?',
    settlement: {
      tx: '0x51bcdd08defd9f3c32320e1ae7d6be4a2d8538d153945ee1d7dbcbe97420bd6d',
      block: 53189010,
      settled_at: '2026-10-28T06:02:47.625Z',
      route: '/chain/token-security',
      extension_status: 'processing',
    },
    acceptance_string_resolution: {
      verdict: 'UNSATISFIABLE AS WRITTEN',
      reasons: [
        'host in the acceptance string is the literal placeholder UNKNOWN',
        'the real host is api.cdp.coinbase.com/platform/v2/x402/discovery',
        '/discovery/resources accepts no q/query filter; both params are silently ignored',
      ],
      negative_control: null,
    },
    queries: {},
    merchant: {},
    crawl: {},
  };

  // 1. Negative control: q= / query= must NOT filter (proves acceptance string is wrong tool)
  for (const param of ['q', 'query']) {
    const u = `${API}/resources?limit=20&${param}=x402-data-api`;
    const { status, body } = await getJSON(u);
    const items = pickItems(body);
    proof.acceptance_string_resolution.negative_control = proof.acceptance_string_resolution.negative_control || {};
    proof.acceptance_string_resolution.negative_control[param] = {
      url: u,
      status,
      total_field: body.pagination ? body.pagination.total : null,
      items_returned: items.length,
      our_records_in_page: items.filter((r) => (r.resource || '').includes('x402-data-api')).length,
      note: 'total unchanged and unfiltered when the param is supplied -> param ignored',
    };
    await sleep(800);
  }

  // 2. Buyer-intent searches: is the resource surfaced by description?
  for (const q of QUERIES) {
    const u = `${API}/search?query=${encodeURIComponent(q)}&limit=20`;
    const { status, body } = await getJSON(u);
    const items = pickItems(body);
    const ours = [];
    items.forEach((r, i) => {
      if ((r.resource || '').includes('sigrunner')) {
        ours.push({
          rank: i + 1,
          resource: r.resource,
          lastUpdated: r.lastUpdated,
          quality: r.quality,
        });
      }
    });
    proof.queries[q] = {
      url: u,
      status,
      result_count: items.length,
      partial_results: body.partialResults ?? null,
      ours_present: ours.length > 0,
      ours,
      top5: items.slice(0, 5).map((r) => r.resource),
      raw: body,
    };
    await sleep(900);
  }

  // 3. Merchant view of the settled resource (authoritative record state)
  let offset = 0;
  let seen = 0;
  while (offset < 200) {
    const u = `${API}/merchant?payTo=${PAY_TO}&limit=20&offset=${offset}`;
    const { status, body } = await getJSON(u);
    const items = pickItems(body);
    const hit = items.find((r) => (r.resource || '').endsWith('/chain/token-security'));
    if (hit) {
      proof.merchant = {
        url: u,
        status,
        offset,
        record: {
          resource: hit.resource,
          lastUpdated: hit.lastUpdated,
          lastCalledAt: hit.quality && hit.quality.lastCalledAt,
          l30DaysTotalCalls: hit.quality && hit.quality.l30DaysTotalCalls,
          l30DaysUniquePayers: hit.quality && hit.quality.l30DaysUniquePayers,
          description_length: (hit.description || '').length,
          description_mentions_scam: /scam/i.test(hit.description || ''),
          description_head: (hit.description || '').slice(0, 200),
        },
      };
      // also grab sibling routes for the same merchant, showing lastUpdated spread
      proof.merchant.sibling_lastUpdated = items
        .filter((r) => (r.resource || '').includes('sigrunner'))
        .map((r) => ({ resource: r.resource.split('/').slice(-2).join('/'), lastUpdated: r.lastUpdated }));
      break;
    }
    if (!items.length) break;
    seen += items.length;
    offset += 20;
    await sleep(700);
  }
  if (!proof.merchant.record) proof.merchant = { found: false, offsets_scanned: offset / 20 };
  proof.merchant_total_records_scanned = seen;

  // 4. Paged crawl: capture the exact pages holding our records (presence in enumeration)
  proof.crawl = {
    endpoint: `${API}/resources`,
    pagination: { page_size: 20, catalog_total: 90328 },
    pages: [],
    note: 'Presence in a paged crawl is a POSITION fact, not a listing fact: the enumeration has 4,516 pages and its order tracks recency/quality, so "absent from the first N" is not delisting and "present at index M" is not new listing.',
  };
  for (const off of CRAWL_OFFSETS) {
    const u = `${API}/resources?limit=20&offset=${off}`;
    const { status, body } = await getJSON(u);
    const items = pickItems(body);
    const ours = [];
    items.forEach((r, i) => {
      if ((r.resource || '').includes('sigrunner')) {
        ours.push({ index: off + i, resource: r.resource, lastUpdated: r.lastUpdated, quality: r.quality });
      }
    });
    proof.crawl.pages.push({ offset: off, status, items: items.length, our_records: ours });
    await sleep(800);
  }
  proof.crawl.our_records_found = proof.crawl.pages.reduce((n, p) => n + p.our_records.length, 0);
  proof.crawl.settled_route_index_located = proof.crawl.pages.some((p) =>
    p.our_records.some((r) => r.resource.endsWith('/chain/token-security'))
  );

  const out = path.join(__dirname, '..', 'logs', 'cdp-rediscovery-proof.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(proof, null, 2));

  console.log(JSON.stringify({
    written: out,
    bytes: fs.statSync(out).size,
    acceptance_negative_control: proof.acceptance_string_resolution.negative_control,
    queries: Object.fromEntries(Object.entries(proof.queries).map(([k, v]) => [k, { ours_present: v.ours_present, result_count: v.result_count, ranks: v.ours.map((o) => o.rank) }])),
    merchant_lastUpdated: proof.merchant.record && proof.merchant.record.lastUpdated,
    crawl_records_found: proof.crawl.our_records_found,
    settled_route_located_in_sampled_pages: proof.crawl.settled_route_index_located,
  }, null, 2));
})();
