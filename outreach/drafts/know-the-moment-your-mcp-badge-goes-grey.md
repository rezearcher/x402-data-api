A trust badge is a claim you make in public. It says: this MCP server passed a static check for prompt injection and tool poisoning. The hard part was never printing the badge. The hard part is the day after, when a new release ships, a tool description changes, and the claim quietly stops being true. A badge that only reflects the last scan is a photograph. What a team running an agent in production actually needs is a phone call the moment the picture changes.

That call is now wired. When a verified owner registers a webhook, Grey Ridge posts a signed event to it the instant the monitored state transitions, and only then.

## What it does

A monitoring subscriber registers one https endpoint. From then on, two events can arrive:

- `ownership_lapsed`: the DNS TXT record or the served `.well-known/grsg-verify.txt` file that proved you control the host is gone, so the monitored badge has downgraded itself from green to amber.
- `ownership_restored`: control came back and the badge returned to green.

Each event is a small JSON body: the service name, the event type, the host, the verification method, an ISO timestamp, and two links back to the live report and status pages. A `test` event fires at registration so you can confirm the wiring before you rely on it.

The delivery is authenticated the way Snyk, Checkly, and UptimeRobot authenticate theirs. The body is signed with HMAC-SHA256 under a per-host secret and sent as `X-GRSG-Signature: sha256=<hex>`, with the event type mirrored in `X-GRSG-Event`. Your receiver recomputes the HMAC over the raw body and rejects anything that does not match, so a forged or replayed POST goes in the bin. The secret is handed to the proven owner exactly once and is never returned by the unauthenticated status read.

## Why this is not a generic alerting integration

Two design choices separate this from bolting a webhook onto a monitor, and both exist because an attacker-supplied outbound URL is a liability if you are careless with it.

First, you cannot register a webhook on a host you do not control. Registration requires the host to already be claimed, so an unclaimed host is refused with `409 claim_required`. That is not a copywriting promise. Point the endpoint at a host you have not proven and you get it back verbatim:

```
POST /scan/verify/notify?domain=example.com
{"notify_url":"https://hooks.example.com/x"}

HTTP 409
{"error":"claim_required","host":"example.com",
 "how":"Claim example.com first at /scan/verify?domain=example.com ..."}
```

Registration then re-runs the live DNS or file proof of control at that moment. If you no longer control the host, the change is refused with `403 control_not_proven`. No stored secret is trusted to authorize a webhook change, so only the current operator can bind or move the destination. If ownership of a host moves to someone else, they cannot inherit your alert stream, and you cannot keep listening to theirs.

Second, the destination URL is validated before anything is ever sent to it. It must be https, it must be a public dotted hostname, and it may not be localhost, a `.local` name, or any Grey Ridge domain. Anything else is refused with `400 invalid_notify_url`. Delivery itself uses `redirect: "manual"` so the target cannot bounce the request somewhere else, a four second timeout, and runs on an edge runtime that cannot route to private address space regardless. The public-host rule is defense in depth on top of that, not the only thing standing between a user-supplied URL and your internal network.

## The part worth being precise about

Alerts fire only on a genuine verified-to-lapsed transition, and only while a monitoring subscription is active for that host. A steady state sends nothing. A host with no subscription sends nothing. You are not going to get a daily heartbeat you learn to ignore, and you are not paying for a channel that stays silent whether or not anything happened. The event means something changed.

This is still a static check plus monitoring, not a penetration test and not a guarantee. The scanner reads what a server advertises against OWASP LLM01 and LLM08. It does not call your tools, and a clean badge is not a statement that a server is safe in any absolute sense. What the webhook adds is the thing a point-in-time scan structurally cannot give you: notice, at delivery speed, the moment the thing you published a claim about stops being the thing that is live.

A one-off CLI scan tells you about the state of the world when you ran it. The badge keeps re-checking on its own and downgrades when it should. The signed webhook closes the last gap, which is the gap between the badge going grey and you finding out. Continuous monitoring with drift alerts is $9.99/mo at /pricing. For teams that want a scoped human assessment behind it, with a severity-ranked report and a monitoring retainer, that runs $3,000 to $5,000/mo on top of a fixed engagement. Scanning your own server, as always, is free.
