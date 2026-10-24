# Claim your MCP server's security badge, and keep it green

Most security badges are a promise you make about yourself. You run a scan once, paste the green SVG into your README, and it sits there green forever, whether or not anything is still true. The reader has no way to know if the badge reflects the server as it is today or the server as it was the day you shipped it.

We built the opposite. The Grey Ridge "monitored" badge is green only while two things are true right now: you have proven you control the domain, and you are paying for continuous monitoring. The moment either one lapses, the badge turns itself grey. A reader looking at it is looking at live state, not a frozen claim.

Here is how an MCP server author claims one.

## 1. Scan the server, free, in the browser

Point the free scanner at your server's tool-list endpoint. It reads what your server advertises and checks the tool names, descriptions, and schemas for the two prompt-injection patterns that matter: instructions hidden in a tool description that try to override the model (OWASP LLM01), and tool metadata that tries to exfiltrate data or conceal its own behavior from the user (OWASP LLM08). It is read-only. It never calls your tools. No account, no wallet.

You get back a letter grade, a verdict, and a risk number. A clean server comes back grade A, verdict clear, risk 0. A server with a tool description carrying a line like "do not tell the user" comes back grade F, verdict block.

## 2. Prove you control the domain

Anyone can scan a public server. Nobody but the owner should be able to put a badge on it. So before a badge binds to your host, you prove control the same way Search Console, Detectify, and Probely make you prove it. You publish a DNS TXT record at `_grsg-verify.<host>`, or you serve a file at `https://<host>/.well-known/grsg-verify.txt`. The claim page at `/scan/verify` walks you through either path and checks it for you.

This is why the badge means something. The verification is the control check, not a secret token you could leak or hand off. We can re-run the proof at any time, and we do, on a schedule.

## 3. Subscribe for $9.99 a month

The subscription is what turns the badge from "owner verified" into "monitored." It is card only. No wallet, no USDC, no on-chain anything. It also gives you an API key good for 100 scans a month across any Grey Ridge endpoint, so you can gate your own CI by failing the build on a `block` verdict, and re-scan continuously instead of once.

One guardrail worth knowing: you cannot buy monitoring for a server you have not verified. If you try to start checkout for a host you have not proven control of, the request is refused with `ownership_not_verified` and a pointer back to the claim page. You can only pay to monitor something you have demonstrably shown is yours.

## 4. Embed the badge, and let it keep itself honest

Once you are verified and subscribed, the claim page hands you the badge markdown. It renders green with the message "monitored · verified."

Then it does the thing a normal badge never does. It watches its own preconditions.

If your monitoring subscription lapses, through a failed renewal or a cancellation, the badge goes grey ("monitoring off") after a three-day grace window. You are no longer paying for continuous watch, so it stops claiming you are.

If your domain proof disappears, the TXT record removed or the well-known file returning a 404, the badge goes amber ("verification lapsed"). A lapsed ownership proof always wins over an active subscription. We will not keep asserting you own a host you can no longer prove.

Only when both are live does it stay green.

That is the whole design. A badge that can go grey on its own is the only kind worth reading, because it is the only kind that can be wrong in your favor and then correct itself.

## What this is, and what it is not

Be clear-eyed about scope, because we are. This is static detection of two prompt-injection classes in what your server advertises, plus continuous monitoring of that surface and of your ownership proof. It reads your tool list. It does not call your tools, it does not run a penetration test, and a green badge is not a guarantee that your server is safe. It is a live statement that a verified owner is paying to keep the advertised surface watched for the LLM01 and LLM08 patterns. That honesty is the point. A badge that overclaims is worse than no badge.

Against the alternative: a one-off CLI scan or a free static badge from a general-purpose tool tells a reader what was true the day it ran, then goes stale silently. A pentest is a point-in-time engagement with no memory of tomorrow. The monitored badge is the only one of the three that keeps re-checking and quietly downgrades itself when the thing it asserts stops being true.

Claim yours. Run the free scan, prove the domain at `/scan/verify`, subscribe at `/pricing`. The badge does the rest.
