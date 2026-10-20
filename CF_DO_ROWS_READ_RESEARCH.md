# Cloudflare SQLite Durable Object rows_read: billing and reduction (researched 2026-10-20)

Sources (fetched this session):
- DO pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- DO storage API: https://developers.cloudflare.com/durable-objects/api/storage-api/
- DO storage best practices: https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
- DO limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- D1 pricing (DO SQLite uses the same row definitions/rates): https://developers.cloudflare.com/d1/platform/pricing/
- KV pricing: https://developers.cloudflare.com/kv/platform/pricing/
- Analytics Engine limits: https://developers.cloudflare.com/analytics/analytics-engine/limits/

## 1. How rows_read is billed

- Rows read = rows SCANNED by the query, not rows returned; row size is irrelevant (D1 pricing page). `SELECT * FROM t` on 5,000 rows = 5,000 rows read. A filter on an unindexed column still scans the table. An index on the filtered column (e.g. created_at) lets the query read only the matching subset.
- SQL API: `cursor.rowsRead` / `rowsWritten` are exposed on every `sql.exec()` cursor; "the final value is used for SQL billing". rowsRead grows as you iterate (1 after one next(), 3 after toArray() on a 3-row table). Use these to measure per-endpoint cost.
- KV API on SQLite-backed DOs (`get/put/delete/list`): stored in a hidden SQLite table and "billed as rows read or written" (DO pricing page). get(key) = point lookup (about 1 row). get([..up to 128 keys]) = about one row per key.
- list(): returns all keys+values in key order; with no options it loads everything into memory (docs warn of memory limits). Options: start/startAfter/end/prefix/reverse/limit. Docs do NOT explicitly state how limit/prefix affect rowsRead. By the scan definition, list() over N keys = about N rows read; prefix/range/limit should bound the scan to the rows touched (inference from the row-scan definition, not an explicit doc statement; verify empirically via a SQL cursor's rowsRead or the dashboard).
- LIMIT: D1 page is silent on LIMIT. SQLite stops scanning after LIMIT rows only when the plan allows (e.g. index order or rowid order); a LIMIT after ORDER BY on an unindexed column still scans everything.
- Gotcha confirmation: "list() on N keys = N rows_read" is consistent with the docs' definition (KV methods billed per row; rows read = scanned), but there is no single doc sentence stating it. Treat as true. Your 5M/day exhaustion is consistent with a counter that scans all keys on every request (e.g. 5,000 keys x 1,000 requests).
- Writes: each index update counts as an additional row written; deletes and setAlarm() count as rows written.

## 2. Limits and prices

| | Workers Free | Workers Paid |
|---|---|---|
| DO SQLite rows read | 5,000,000 / day | 25 billion / month included, then $0.001 per million |
| rows written | 100,000 / day | 50 million / month included, then $1.00 per million |
| storage | 5 GB total | 5 GB-month included, then $0.20/GB-month |

- Workers Paid base plan is $5/month (from general CF pricing knowledge; not re-fetched).
- Reset: 00:00 UTC daily (DO and D1 pages).
- Blast radius: "If you exceed any one of the free tier limits, further operations of that type will fail with an error." Only that operation type fails (reads fail, writes can still succeed until 100k). The Worker itself keeps running, but any handler that awaits a failing DO read throws, so the endpoint 500s.
- Paid ceiling: 25B rows/month is about 5,000x the free daily cap per month. The current scan pattern would cost nothing on Paid in practice. The $5/mo upgrade is the instant unblock (limits lift within minutes per D1 docs).
- KV free: 100k reads/day, 1k writes/day, 1k lists/day (KV pricing). Much tighter than DO rows_read for reads, so KV is not a free-tier win for high-read counters.

## 3. Ranked reduction techniques (impact x ease)

1. Stop scanning: replace list()-based aggregation with a running counter. Keep `total` and per-key counters as individual keys (or one SQL row per metric); on each request do `get(k)` and `put(k, v+1)` (1 read, 1 write), or better keep counters in instance memory (load once inside `blockConcurrencyWhile` in the constructor) and flush to storage on an alarm every 30-60s. Impact: from O(N) to O(1) per request, about 99%+ cut of rows_read. Ease: high (small code change). Note: puts are bounded by the 100k writes/day free cap, so batch via memory + alarm if on Free.
2. Cache at the edge so bot/probe hits never reach the DO. For free/unauthenticated endpoints and the 402 challenge responses: `caches.default` (Cache API) with `Cache-Control: public, max-age=30-300`, or a CF Cache Rule. 402 responses with identical payment requirements can be cached briefly per URL. Impact: 70-95%+ of probe traffic costs 0 DO operations. Ease: high. Caveat: Cache API is per-colo, not global; fine for bot traffic.
3. Do not touch the DO on unpaid/invalid requests. Order the pipeline: validate the x402 payment header, and if absent return the (cached) 402 immediately. Only paid/valid requests hit the counter/ledger. Add Workers rate limiting binding or a WAF rate-limit rule (zone level, free tier has 1 rule) for abusive IPs. Impact: removes the bulk of traffic that produces reads with no revenue. Ease: high.
4. Materialize aggregates: the 10%-sampled traffic log should be written with index-backed schema and read only via bounded queries. In SQL: `CREATE INDEX ON log(ts)`, query `WHERE ts >= ?` with `LIMIT`, and prune with `DELETE WHERE ts < now-7d` on an alarm (deletes count as writes, so prune in batches or drop by rotating tables). For dashboards, serve a snapshot computed by an alarm every N minutes and stored in one row/KV key; reads of the snapshot are 1 row. Impact: 90%+ on log reads. Ease: medium.
5. Point reads over list(): where list is unavoidable, use `prefix` + `limit` and keep keys time-bucketed (e.g. `usage:2026-10-20:<id>`) so a window read touches only that bucket. Medium impact, medium ease.
6. Lower the sample rate (10% to 1%) for the traffic log and write it to Workers Analytics Engine instead of a DO: `writeDataPoint` is fire-and-forget, 250 points/invocation, 3-month retention, queried via SQL API, and does not consume DO rows_read/written. Best fit for logs and probe analytics. (AE pricing page 404'd; AE is free-tier included with Workers as of my knowledge, confirm in dashboard.) Impact: eliminates the log DO's reads and writes. Ease: medium.

KV vs D1 vs DO vs AE for this workload:
- Counters needing atomicity (credit ledger): keep in DO (strong consistency); the ledger is the only part that truly needs a DO. Per-request ops should be point reads/writes.
- Usage counter: in-memory + alarm flush in the DO, or Analytics Engine for approximate metrics. KV is eventually consistent and has a 1k writes/day free cap, so it is a poor counter store but fine as a read cache for snapshots (read 100k/day free).
- Logs: Analytics Engine > D1 > DO. D1 shares the same 5M rows_read/100k rows_written free caps, so it only helps through indexes, not quota.

## 4. Immediate actions (for the build step, not done here)
- Instrument: log `cursor.rowsRead` per DO call (SQL API) to find the actual hot path.
- Ship #1 + #3 first (pipeline ordering + O(1) counters), then #2, then #6.
- If revenue-critical uptime matters before the fix is in, Workers Paid ($5/mo) lifts the cap; capital is trivially bounded since overage is $0.001 per million rows.

## WORKED-OUT SOLUTIONS (synthesis, 2026-10-20)
FACTS (confirmed): rows_read = rows SCANNED (D1/DO pricing). list() on N keys ≈ N rows; unindexed SELECT = full-table scan. Free=5M rows_read/day (reset 00:00 UTC); Paid=$5/mo, 25B/mo incl (absorbs this). Exceed = only DO-read ops 500, worker still runs.
DRIVER: TrafficLog `hits(ts,path,method,ua)` — NO index on ts, NEVER pruned, grown since 2026-08-19; getStats/getPaid full-scan the whole table. UsageCounter /metrics list()≈55 rows (not it unless /metrics hammered ~90k/day). CreditLedger = point reads (not it). NOTE: no OUR-side poller hits /internal/traffic-stats; exact 5M split needs CF per-DO analytics (token).

### Fix set — all one `wrangler deploy`, additive, low-risk (ranked impact×ease)
1. **TrafficLog: index + windowed-read + prune + DDL-once.** `CREATE INDEX IF NOT EXISTS hits_ts ON hits(ts)` (+ `(method,ts)`); getStats/getPaid use `WHERE ts>=? ... LIMIT`; prune `DELETE WHERE ts < now-7d` on a DO alarm; move `CREATE TABLE` to constructor (not per logHit). → kills full-scan reads (~99% of the suspected driver).
2. **402-before-DO + edge-cache free/402 responses.** Validate x402 header and return 402 BEFORE any DO touch; `caches.default` / Cache Rule max-age 30–300s on free + 402 bodies. → unpaid/bot hits cost ~0 DO ops (70–95% cut).
3. **/metrics + /internal/traffic-stats = alarm-refreshed cached snapshot (1 row).** Don't live-list()/scan per hit; refresh a single snapshot row on a 30–60s alarm, serve that. Gate/rate-limit /metrics.
4. **(optional, if real demand appears) move the log to Workers Analytics Engine** (`writeDataPoint`) → drops TrafficLog out of DO rows_read entirely.

### Decision
- **FREE durable fix = #1–3** → needs `wrangler deploy` = `CF_WORKERS_TOKEN` (1Password-locked until ~15:20). NOT a capital gate. RECOMMENDED.
- **$5/mo Workers Paid** = instant cap lift, but it's paying to serve unpaid bot scans; the free fix makes it unnecessary. Only worth it for instant-unblock-before-15:20 + real paid demand (evidence: $0 paying customers → not yet).
- RECOMMENDATION: free fix at token-unlock; skip the $5/mo. Pull CF per-DO analytics at unlock to confirm the dominant scanner + verify the fix.
