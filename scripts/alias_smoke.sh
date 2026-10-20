#!/usr/bin/env bash
# Regression: gate previews must honor integrator param aliases and reject garbage (I12).
B=${1:-https://api.greyridgesignals.ai}; W=0x4200000000000000000000000000000000000006; ok=1
for r in chain/token-report gate/swap; do
 for k in token address tokenAddress contract; do
  s=$(curl -s -m 25 "$B/$r/preview?$k=$W" | grep -o '"token":"[^"]*"' | head -1)
  [ "$s" = "\"token\":\"$W\"" ] || { echo "FAIL $r $k -> $s"; ok=0; }
 done
 c=$(curl -s -o /dev/null -w %{http_code} "$B/$r/preview?token=garbage"); [ "$c" = 400 ] || { echo "FAIL $r garbage $c"; ok=0; }
done; [ $ok = 1 ] && echo PASS
