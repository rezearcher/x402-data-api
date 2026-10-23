A flat revenue number tells you almost nothing. Zero sales could mean a thousand people hit the page and every one of them bailed at the wallet step, or it could mean nobody ever showed up. Those are opposite problems with opposite fixes, and for weeks we were guessing which one we had.

So we stopped guessing and instrumented the funnel. Here is what it does, how we kept it from leaking anything about the people who trigger it, and the slightly humbling thing it told us.

## The blind spot

Our server has always counted settled payments. That counter is honest and it is the one that matters for the books, but it only fires at the very end, after money has already moved. Everything before that point was dark. When a token-safety result loads at `/check?token=0x...` and a human either pays or walks, the settled counter looks identical to the case where the page was never opened at all. Both read zero.

You cannot fix a funnel you cannot see. If the drop is at wallet-connect, that is a UX problem and you go sand down the button. If the drop is that nobody arrives, that is a distribution problem and no amount of button-polishing will touch it. Same zero, completely different week of work.

## Four events, three surfaces, no people

We added a beacon. There are exactly four stages worth watching on the pay path:

    view          the result page rendered
    unlock_click  they clicked pay
    wallet_open   the wallet actually opened
    tx_submit     they submitted the transaction

and three places the path lives: the `/check` web page, the Farcaster `/miniapp`, and the Telegram bot (`tg`). The client fires a one-line beacon at each stage:

    fetch('/ev?s=check&e=unlock_click', {method:'POST', keepalive:true})

That is the whole payload. A surface, an event, nothing else. The endpoint reads no body, stores no IP, sets no cookie, and returns 204 before the page finishes rendering so it never slows anything down. There is no identifier anywhere in it because there is no one to identify. All we ever learn is that a `view` happened, not whose.

## The part a security shop has to get right

The surface and event strings become storage keys on our counter. The second you turn a user-supplied string into a key, you have handed a stranger a pen and asked them to write in your database. If `/ev?s=anything&e=whatever` created a new row, someone could hammer it with a million distinct values and run your storage cost straight up. That is a denial-of-wallet attack dressed as analytics.

So both values are checked against a fixed list before anything gets written:

    FUNNEL_SURFACES = ["check", "miniapp", "tg"]
    FUNNEL_EVENTS   = ["view", "unlock_click", "wallet_open", "tx_submit"]

Anything off that list is dropped on the floor and the endpoint still returns a clean 204, so a prober cannot even tell whether a value matched. The key space is bounded at twelve counters, forever. Adding a new stage later is a one-line edit to those lists, and an unknown value fails open to "not counted" rather than erroring the page. Measurement should never be the thing that takes your product down.

## What it actually said

Here is the humbling part. After this went live, I pulled the aggregate. Across the whole window, the top of the funnel reads one `view` on `/check` and one `unlock_click` on the miniapp. The rest of the twelve counters are zero.

One view. Not "lots of views, nobody paid." One.

Meanwhile the settled side shows real money moving: nine external paid calls from three distinct wallets over the last thirty days, agents paying per request over the x402 rail with no page involved at all. So the product works and strangers do pay for it. The human web funnel just has almost nobody at the top of it.

That reading settles the argument I could have spent another month having with myself. The leak is not the button. We rebuilt that button to be one-tap, and it would not have mattered, because the problem was never conversion. It is distribution. Nobody is arriving to convert.

I would rather know that from a counter than from a hunch. The fix for an empty top-of-funnel is not more engineering, it is getting the thing in front of people who have the problem it solves, which, yes, is exactly what this writeup is. The instrumentation pointed at the door and said go stand outside it. So here I am.

If you run anything that charges money, the lesson transfers cleanly: wire four cheap beacons to your pay path before you spend a sprint optimizing a step that might not be where you are losing anyone. It cost us a few dozen lines and one afternoon, and it replaced an argument with a number.

You can see the same data live. The aggregate funnel block ships in our public `/metrics` payload, no key required, right next to the settled payment counts. We would rather show the empty chart than pretend it is full.
