#!/usr/bin/env bash
# start_mocks.sh <STORM_K> — launch 3 mock RPCs (9111/9112/9113) that all 429 the
# transfer probe STORM_K times per report, i.e. a correlated fleet-wide storm.
K="${1:-1}"
for P in 9111 9112 9113; do
  pid=$(ss -ltnp 2>/dev/null | grep ":$P " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
  [ -n "$pid" ] && kill "$pid" 2>/dev/null
done
sleep 1
for P in 9111 9112 9113; do
  STORM_K="$K" MOCK_PORT="$P" setsid nohup node $(dirname "$0")/mock_rpc_storm.mjs > "/tmp/mock_${P}.log" 2>&1 < /dev/null &
done
sleep 2
for P in 9111 9112 9113; do head -1 "/tmp/mock_${P}.log"; done
