# Put your x402 MCP server in both official registries — the dual-namespace recipe

Most "publish to the MCP registry" write-ups stop at one listing. That leaves
discovery on the table, because the official registry hands out names in two
very different namespaces, and the one that is trivial to automate in CI is not
the one that carries your brand. You want both. Here is the exact recipe,
worked against two of our own listings that are live right now.

## The two namespaces, and why you want both

The official Model Context Protocol registry ties a server name to a proof of
ownership. There are two ways to prove it, and they map to two namespaces:

| | Branded reverse-DNS | GitHub-owned |
|---|---|---|
| Example name | `ai.greyridgesignals/tech-risk` | `io.github.rezearcher/tech-risk` |
| Proof of ownership | DNS TXT record on your domain | GitHub OIDC — the repo owner *is* the proof |
| Automatable in CI with no secret? | No (DNS login needs a key) | Yes (`id-token: write`, zero stored token) |
| What it signals to a reader | your company | the source repo |

The reverse-DNS name (`ai.<your-domain>/...`) is the one agents and humans read
as *your brand*. But publishing it hands-free is awkward: the `mcp-publisher
login dns` path wants a signing key, and those keys expire, so it tends to rot.
The `io.github.<owner>/...` name is the opposite. It is less pretty, but the
registry authorizes it automatically when a GitHub Actions OIDC token's repo
owner matches the namespace — no device flow, no stored secret, nothing to
rotate. (Community write-ups of the publish flow, e.g. the
[Registry CLI reference](https://modelcontextprotocol.info/tools/registry/cli/)
and [Registry FAQ](https://modelcontextprotocol.info/registry/faq/),
describe the same split: `io.github.*` names are tied to a GitHub account or org,
`com.company.*` / `ai.company.*` names need DNS verification.)

So you publish both: the branded one for the humans, the GitHub one for the
robot that keeps your listing current on every push.

## The part nobody writes down: one package, two owners

Namespace auth proves you own the *name*. A second, separate check proves the
*package* you point at is really yours — the `mcp-name` marker. For a PyPI
package you put a line in the README; for npm it is an `mcpName` field in
`package.json`.

The gotcha: a naive reading says one package validates for one server name. But
you have two server names pointing at the *same* PyPI package. The fix is to put
**both** markers in the one README. Ours carries, verbatim:

```
<!-- mcp-name: ai.greyridgesignals/tech-risk -->
<!-- mcp-name: io.github.rezearcher/tech-risk -->
```

They coexist. The same published `greyridge-x402-tools` package now validates as
belonging to both the branded listing and the GitHub listing, so you ship one
package and feed two registry entries with it.

## The packages block that makes it one command to install

A registry entry with only a `remotes` array is a URL someone has to wire up by
hand. Add a `packages` block and the entry becomes one-command installable. Ours
points at the PyPI package with a `uvx` runtime hint:

```json
"packages": [{
  "registryType": "pypi",
  "identifier": "greyridge-x402-tools",
  "version": "0.8.3",
  "runtimeHint": "uvx",
  "runtimeArguments": [
    { "type": "named", "name": "--from", "value": "greyridge-x402-tools" },
    { "type": "positional", "value": "greyridge-x402-verify" }
  ],
  "transport": { "type": "stdio" }
}]
```

That translates directly to the command a user runs:

```
uvx --from greyridge-x402-tools greyridge-x402-verify
```

I ran exactly that from a cold cache (`--refresh`) while writing this. It
initializes a stdio server whose `serverInfo.name` is `greyridge-x402-verify`
and lists two tools: `x402_preflight` and `x402_receipt_verify`. That is the
whole point of the packages block — a reader goes from "found it in the
registry" to "it's running locally" in one line, no README spelunking.

Scope honesty, because it matters: those two stdio tools do one narrow job each.
`x402_preflight` answers *will this x402 payment settle, is the charged price
the advertised one, does the endpoint leak its resource unpaid, and is the payee
sanctioned or a known scammer* — a PAY / CAUTION / AVOID verdict before you spend.
`x402_receipt_verify` takes a transaction hash and reconciles the on-chain USDC
transfer across two independent Base RPCs before it will call a receipt settled.
Neither is a pentest and neither is a guarantee — they are checks that return a
verdict with its evidence. The full tool catalog lives on the remote `/mcp` endpoint, not in this
two-tool local server.

## The OIDC workflow that keeps the GitHub listing current

The branded listing you refresh by hand when the version bumps. The GitHub
listing you never touch again. A GitHub Actions workflow, triggered on any push
that changes the server manifest, installs `mcp-publisher`, validates the
manifest against the official 2025-12-11 schema, then:

```
mcp-publisher login github-oidc
mcp-publisher publish registry/server.github.json
```

with `permissions: { id-token: write }`. The OIDC subject's repo owner
(`rezearcher`) matches the `io.github.rezearcher/*` namespace, so the registry
accepts the publish with no token in the repo at all. Every time the builder
ships a new package version, that listing re-publishes itself.

One deliberate detail in that GitHub manifest: its `remotes` URL points at the
`workers.dev` host, not the custom domain. Custom domains behind a bot-managing
CDN can 403 datacenter IPs, and a registry crawler is a datacenter IP. The
`workers.dev` origin answers them, so the automated listing stays reachable to
the thing that indexes it. Small thing, easy to miss, and it is the difference
between a listing that resolves and one that silently looks dead.

## Verify it yourself

Both listings are live and marked `isLatest` as of this writing. You can pull
them straight from the registry API:

```
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=tech-risk"
```

You will get back `ai.greyridgesignals/tech-risk` (v0.1.7, remote
`api.greyridgesignals.ai/mcp`) and `io.github.rezearcher/tech-risk` (v1.4.0,
remote `x402-data-api.sigrunner.workers.dev/mcp`), each with the `uvx` packages
block above. The package itself is on
[PyPI as `greyridge-x402-tools`](https://pypi.org/project/greyridge-x402-tools/)
(0.8.3 latest).

## The recipe, condensed

1. Publish two manifests: a branded `ai.<domain>/...` name (DNS auth, for the
   brand) and an `io.github.<owner>/...` name (OIDC auth, for hands-free CI).
2. Put **both** `mcp-name:` markers in the one package README so a single
   published package validates for both names.
3. Add a `packages` block with a `uvx`/`npx` runtime hint so the entry is
   one-command installable, not remote-only.
4. Wire the `io.github` manifest to an OIDC publish workflow (`id-token: write`,
   `mcp-publisher login github-oidc`) so it re-publishes on every push.
5. Point the automated listing's remote at an origin a datacenter crawler can
   actually reach.

That is the full path from "my MCP server exists" to "it is discoverable in two
namespaces and installable in one line, and it stays that way without me." We
built it for a pay-per-call x402 server, but steps 1–5 are generic to any MCP
server you want found.
