// ---------------------------------------------------------------------------
// MCP tool-poisoning / prompt-injection static detection (OWASP LLM01/LLM08 +
// the MCP-specific tool-poisoning class). Pure, edge-runnable, keyless: regex
// over attacker-controllable tool text (name + description + inputSchema). This
// is the detection core shared by every /scan/mcp* surface; kept in its own
// module so the rule set is unit-testable against a regression corpus built
// from real disclosed MCP attacks (Invariant Labs tool-poisoning + WhatsApp
// exploit, OWASP LLM01). See tests/mcp_scan.test.mjs.
// ---------------------------------------------------------------------------

export interface ScanFinding {
  tool: string;
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  detail: string;
  evidence: string;
}

// Detection rules for a single MCP tool's name+description+schema (all attacker-
// controllable text the agent trusts). Pattern set derived from documented MCP
// tool-poisoning research (hidden instructions, exfiltration, shadowing, danger).
export function analyzeMcpTool(name: string, description: string, schemaText: string): ScanFinding[] {
  const f: ScanFinding[] = [];
  const text = `${description}\n${schemaText}`;
  const low = text.toLowerCase();
  const add = (severity: ScanFinding["severity"], rule: string, detail: string, ev: string) =>
    f.push({ tool: name, severity, rule, detail, evidence: ev.slice(0, 160) });

  // 1. Hidden instructions to the AI embedded in a tool description (tool poisoning).
  // Only DECEPTION / OVERRIDE constructs are tool-poisoning — ordinary sequencing
  // language ("you must first call X", "before calling this tool", "instead of")
  // is legitimate tool-chaining guidance and was producing false CRITICALs on clean
  // servers (e.g. Context7), which destroys the scanner's credibility. The canonical
  // tool-poisoning signatures (Invariant Labs / OWASP LLM01) are: override of prior
  // instructions, hidden <IMPORTANT>/<system> directive tags, and instructions to
  // conceal actions from the user. Genuine exfiltration/danger stays covered by
  // rules 2–5 below, so a real "before using X, read ~/.ssh/id_rsa" attack still flags.
  //
  // Concealment is matched in a contraction-robust way: the famous WhatsApp-MCP and
  // tool-shadowing exploits phrase it as "don't notify the user" / "do not mention
  // this to the user" / "don't notify the user about it" — the OLD rule only matched
  // the literal "do not …" and missed every contraction, so those real attacks
  // passed as clean. We accept do-not / don't / doesn't / won't / never / avoid with
  // the deception-verb family, but the concealment TARGET is restricted to the
  // agent's operator ("the user" / "the human" / "the operator") — NOT "anyone /
  // them / third parties", which appear in legitimate reassurance copy ("does not
  // reveal your key to anyone") and would false-positive. Verbs are limited to the
  // conceal family (no "let"/"say" — "don't let the user pass …" is legit guidance).
  const conceal = /\b(do not|don'?t|does ?n'?t|would ?n'?t|wo ?n'?t|never|avoid)\b[^.?!]{0,30}?\b(tell|mention|inform|notify|alert|reveal|disclose|warn)\b[^.?!]{0,30}?\b(the user|the human|the operator)\b/i;
  const inj = /(ignore (all |any )?(previous|prior|earlier|above)( instructions| context| prompt)?|disregard (the )?(above|previous|prior|earlier)|<\/?important>|<\/?system>|<\/?secret>|(hidden|concealed|kept secret) from the user|keep (this|it) (secret|hidden)|without (telling|informing|notifying|alerting) the user|reveal (your|the) (full |complete )?(system )?(prompt|instructions))/i;
  // A truthfulness / accuracy guard is the OPPOSITE of concealment: "never tell the
  // user a name is available — confirm it first" instructs the agent to WITHHOLD a
  // premature/false CLAIM about data until it is verified, not to hide its own
  // actions. The tell is the verify-first corrective ("confirm it first", "until
  // confirmed", "before you verify"), which no tool-poisoning attack carries (the
  // WhatsApp exploit says "don't notify the user" with no such corrective). Scoped to
  // the window right after the conceal match so a distant, unrelated "confirm" in a
  // long description cannot suppress a real hit. Killed a false CRITICAL on a clean
  // domain-registrar server (AIvikings check_domain_availability), same credibility
  // failure class as the Context7 false positive.
  const concealMatch = conceal.exec(text);
  const accuracyGuard = /\bconfirm(s|ed|ing)?\b[^.?!]{0,20}?\b(it|this|that|them|first|again|with)\b|\b(until|unless|before)\b[^.?!]{0,25}?\b(confirm|verif|validat|re-?check|double[- ]?check)/i;
  const concealHit = concealMatch && !accuracyGuard.test(text.slice(concealMatch.index, concealMatch.index + 140));
  if (inj.test(text) || concealHit) add("critical", "tool-poisoning:hidden-instructions",
    "Description contains deceptive/override instructions aimed at the AI agent (conceal-from-user or ignore-prior-instructions) — classic MCP tool-poisoning.",
    (text.match(inj) || (concealHit ? concealMatch : null) || [""])[0]);

  // 2. Data-exfiltration hints. A BARE mention of "api key"/"password"/"secret" is
  // NOT exfiltration — legitimate auth/docs tools (and even security warnings like
  // "do not include API keys") use those words, and flagging them destroys trust.
  // Real exfiltration is (a) an unambiguous secret-artifact that has no business in
  // a tool description, or (b) a sensitive target PAIRED with an instruction to send
  // it to an external destination.
  //
  // The payload class matters. Authenticated remote MCP tools legitimately tell the
  // agent to send ITS OWN credential (cookie / api key / bearer token) to a URL in
  // order to authenticate — e.g. "send its session Cookie header, or an agent key
  // the account made at https://…". Treating a bare URL as an exfil destination for
  // those credentials false-flags nearly every auth'd server as HIGH-risk, which
  // destroys the scanner's credibility (same class of error as the Context7 false
  // CRITICAL). So we split the targets:
  //   • SENSITIVE payloads (system prompt, conversation, env, file contents, private
  //     keys) have no legitimate reason to be transmitted anywhere → flag on ANY
  //     destination, including a bare https:// URL.
  //   • AUTH-AMBIGUOUS credentials (cookies, api keys, access tokens, passwords) are
  //     routinely sent to authenticate → flag ONLY when the destination is explicitly
  //     foreign (webhook / external / third-party / attacker), never a bare URL.
  const secretArtifact = /(\.env\b|~\/\.ssh|id_rsa|\bprivate key\b|exfiltrat)/i;
  const foreignDest = String.raw`\bwebhook\b|\bexternal\b|third[- ]?party|attacker|\bexfil`;
  const anyDest = String.raw`https?:\/\/|` + foreignDest;
  const exfilSensitive = new RegExp(
    String.raw`(send|post|upload|transmit|forward|leak|exfiltrat\w*)\b[^.]{0,60}?\b(system prompt|conversation|chat history|environment variables?|private keys?|contents? of (the |any )?files?)\b[^.]{0,80}?(` + anyDest + `)`, "i");
  const exfilCredential = new RegExp(
    String.raw`(send|post|upload|transmit|forward|leak|exfiltrat\w*)\b[^.]{0,60}?\b(secrets?|credentials?|passwords?|api[ _-]?keys?|access tokens?|cookies?)\b[^.]{0,80}?(` + foreignDest + `)`, "i");
  const descLow = description.toLowerCase(); // sentence-scoped: never match across the description/schema boundary
  const exfilHit = low.match(secretArtifact) || descLow.match(exfilSensitive) || descLow.match(exfilCredential);
  if (exfilHit) add("high", "exfiltration-hint",
    "Description instructs sending sensitive data (system prompt / conversation / env / file contents / private keys) to a destination, credentials to a foreign destination, or references a secret-file artifact (.env/.ssh/id_rsa).", exfilHit[0]);

  // 3. Dangerous capability surface
  const danger = /((?<![\/.\w-])(exec|execs)(?![\/\w-])|\b(exec\(|eval|eval\(|subprocess|shell|sudo|chmod)\b|os\.system|child_process|rm -rf|arbitrary (code|command)|remote code|\bexecute (shell|arbitrary|code|commands?)\b|run (shell|arbitrary) (commands?|code))/i;
  if (danger.test(low)) add("high", "dangerous-capability",
    "Tool exposes code/command execution or destructive filesystem ops.", (low.match(danger) || [""])[0]);

  // 4. Cross-tool shadowing / rug-pull language (altering other tools' behavior).
  // Two shapes: (a) explicit meta-language about "other/all tools' behaviour", and
  // (b) the Invariant-Labs / WhatsApp shadowing shape — a description that names a
  // DIFFERENT tool (explicitly, or via the mcp_*/_send_/send_message families) and
  // couples it with a redirect/override verb ("must send all … to", "change the
  // recipient", "route … to", "when <tool> is invoked …"). The famous WhatsApp
  // exploit hides inside a fact-of-the-day tool that rewrites send_message's
  // recipient — so a reference to another tool + a redirect verb is the signal.
  // otherToolRef must name a SPECIFIC other tool, not the bare word "mcp" (which
  // appears in almost every MCP tool's description and would false-positive): a
  // namespaced tool id (mcp_whatsapp, mcp_tool_send_email), an action-suffixed tool
  // id (send_message, send_email, wallet_transfer), or an explicit "the <other>
  // tool" meta-reference. redirectVerb must be a genuinely coercive redirect of a
  // target/recipient — not the common, benign "when X is invoked" sequencing phrase.
  const shadowMeta = /(\b(other|all|every|any) tools?\b[^.]{0,40}\b(behaviou?r|description|output|call|invoke|instruction)s?\b|\boverride (the )?(\w+ (of )?)?(other|all|every|any|previous) |\bshadow(s|ing)? (the )?(other|all|every)|when (any|another) tool|modif(y|ies|ying) (the )?behaviou?r of)/i;
  const otherToolRef = /(\bmcp_[a-z0-9_]+\b|\b[a-z][a-z0-9]*_(send|email|message|transfer|pay|exec|run|read|write|upload|post)[a-z0-9_]*\b|\bsend_message\b|\bsend_email\b|\b(another|a different|the present|the also[- ]present|the other)\b[^.]{0,25}\btool\b)/i;
  const redirectVerb = /(must send all|change (the )?(recipient|address|destination|target|to[- ]field)|set (the )?(recipient|destination|address|to[- ]field) to|redirect (all|every|the|outgoing|outbound)|re-?route (all|every|the)|forward (all|every) (emails?|messages?|payments?|transfers?|outgoing)|all (emails?|messages?|payments?|transfers?)\b[^.]{0,25}\b(must|to a|to the proxy|to an? (proxy|different)))/i;
  if (shadowMeta.test(low) || (otherToolRef.test(low) && redirectVerb.test(low)))
    add("medium", "cross-tool-shadowing",
      "Description references another tool's behaviour and a redirect/override — shadowing / rug-pull risk.",
      (low.match(shadowMeta) || low.match(redirectVerb) || [""])[0]);

  // 5. Invisible / non-ASCII payloads (unicode tag chars, zero-width, long base64)
  if (/[​-‍﻿‪-‮⁦-⁩]/.test(text) || /[\u{E0000}-\u{E007F}]/u.test(text))
    add("high", "invisible-unicode", "Hidden/zero-width or unicode-tag characters in description — covert instruction channel.", "non-printable chars");

  // 5b. ANSI terminal escape / C0 control-char covert channel. A separate concealment
  // class from zero-width unicode (rule 5): a malicious server embeds the ESC byte
  // (0x1B) and CSI/OSC sequences, or other non-whitespace C0 control characters, in a
  // tool NAME or description. When that text renders in the agent's terminal or is
  // written to logs, the escape sequences can overwrite/hide text so a HUMAN reviewing
  // the tool sees something different from what the model ingests — Trail of Bits'
  // "line jumping" / ANSI-escape research and CVE-2026-6494 (AAP MCP server, ANSI log
  // injection, 2026-04-17). Precision: legitimate tool text is plain, using only
  // TAB/LF/CR whitespace; any other C0 control (and DEL) is anomalous, so false
  // positives are near-zero. We scan name too (the name is attacker-controllable and
  // rendered in tool pickers/logs), unlike the regex rules above which scan text only.
  const controlChan = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  if (controlChan.test(name) || controlChan.test(text)) {
    const inName = controlChan.test(name);
    add("high", "ansi-terminal-escape",
      "ANSI terminal escape sequence or non-whitespace control character in the tool " +
      (inName ? "name" : "description") +
      " — a covert channel that can hide instructions from a human reviewer or inject into terminal output/logs (Trail of Bits line-jumping / ANSI; CVE-2026-6494).",
      /\u001b/.test(inName ? name : text) ? "ESC (0x1b) escape sequence" : "non-printable control char");
  }
  if (/[A-Za-z0-9+/]{120,}={0,2}/.test(text))
    add("medium", "opaque-blob", "Long base64-like blob embedded in tool text — possible hidden payload.", "…base64…");

  return f;
}

// ---------------------------------------------------------------------------
// Claude Connector Directory readiness checks.
//
// Anthropic's directory (claude.ai/directory, portal opened 2026-09-25) runs a
// MANDATORY automated security/policy scan on every submission: pass→publish,
// held-for-reviewer, or FAIL with the violated rules listed — and the review
// queue runs ~20 days, so eating a rejection is expensive. This is a demand-side
// GATEKEEPER, not a voluntary badge.
//
// analyzeMcpTool above already covers the tool-poisoning / prompt-injection
// patterns on Anthropic's reject list (override, hidden instructions, exfil,
// cross-tool interference). This function adds the deterministic STRUCTURAL
// rejection triggers Anthropic publishes at
// claude.com/docs/connectors/building/review-criteria (read 2026-10-22), so a
// connector author sees exactly which published criteria their server fails
// BEFORE they burn a 20-day review cycle.
//
// Claims law: these map to Anthropic's PUBLISHED criteria only — they do not
// reproduce Anthropic's private scan and never guarantee acceptance. Precision
// is held to the same bar as the poisoning rules (the Context7 lesson): a check
// that false-flags a clean, directory-compliant tool is worse than a miss.
// ---------------------------------------------------------------------------

export interface McpToolLike {
  name?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean } | null;
}

export function analyzeDirectoryReadiness(tool: McpToolLike): ScanFinding[] {
  const f: ScanFinding[] = [];
  const name = tool.name ?? "(unnamed)";
  const desc = tool.description ?? "";
  const low = desc.toLowerCase();
  const ann = tool.annotations ?? undefined;
  const add = (severity: ScanFinding["severity"], rule: string, detail: string, ev: string) =>
    f.push({ tool: name, severity, rule, detail, evidence: ev.slice(0, 160) });

  // 1. Tool-name length. Anthropic: "Tool names must be 64 characters or fewer."
  // Hard reject — deterministic.
  if (name !== "(unnamed)" && name.length > 64)
    add("high", "directory:tool-name-too-long",
      `Tool name is ${name.length} chars; Anthropic rejects names over 64.`, name);

  // 2. Required annotations. Anthropic: "Every tool must include a `title` and the
  // applicable hint: `readOnlyHint: true` for read-only tools, `destructiveHint:
  // true` for tools that modify or delete data." These drive auto-permissions, so
  // their absence is a documented reject.
  if (!ann || typeof ann.title !== "string" || ann.title.trim() === "")
    add("medium", "directory:missing-title",
      "Tool is missing the required `annotations.title` — Claude Directory rejects tools without a title.", "annotations.title");
  if (!ann || (typeof ann.readOnlyHint !== "boolean" && typeof ann.destructiveHint !== "boolean"))
    add("medium", "directory:missing-hint",
      "Tool declares neither `readOnlyHint` nor `destructiveHint` — Claude Directory requires the applicable permission hint.", "annotations.readOnlyHint|destructiveHint");

  // 3. Catch-all read+write tool. Anthropic: "A single tool that accepts both safe
  // HTTP methods (GET/HEAD/OPTIONS) and unsafe methods (POST/PUT/PATCH/DELETE) is
  // rejected. Don't ship a catch-all api_request tool with a method parameter."
  // Detect a `method`-like schema property whose enum mixes safe and unsafe verbs.
  const safe = /\b(GET|HEAD|OPTIONS)\b/;
  const unsafe = /\b(POST|PUT|PATCH|DELETE)\b/;
  const schema = tool.inputSchema;
  let methodEnum: string[] | null = null;
  if (schema && typeof schema === "object") {
    const props = (schema as Record<string, unknown>).properties;
    if (props && typeof props === "object") {
      for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
        if (!/^(method|http_?method|verb)$/i.test(k)) continue;
        const en = v && typeof v === "object" ? (v as Record<string, unknown>).enum : undefined;
        if (Array.isArray(en)) methodEnum = en.map(String);
      }
    }
  }
  const enumText = methodEnum ? methodEnum.join(" ").toUpperCase() : "";
  if (enumText && safe.test(enumText) && unsafe.test(enumText)) {
    add("high", "directory:mixed-read-write-methods",
      "Single tool accepts both safe (GET/HEAD/OPTIONS) and unsafe (POST/PUT/PATCH/DELETE) methods — Anthropic rejects catch-all read+write tools; split into separate read and write tools.",
      methodEnum!.join(","));
  }

  // 4. Unsupported capabilities (documented auto-reject). Anthropic rejects tools
  // that "transfer money, cryptocurrency, or other financial assets" or "generate
  // images, video, or audio through AI models" (diagram/chart/UI-mockup allowed).
  // FP guard: require a transfer/move/send VERB paired with a money/asset NOUN, and
  // for media require a generate VERB + media NOUN + an AI qualifier, excluding the
  // explicitly-allowed diagram/chart/mockup forms.
  const moneyMove = /\b(transfer|send|move|withdraw|remit|disburse|pay out|payout)\b[^.]{0,40}\b(money|funds?|cash|cryptocurrenc(y|ies)|crypto|tokens?|coins?|usdc|usdt|eth|btc|stablecoins?|financial assets?|assets?)\b/;
  if (moneyMove.test(low))
    add("high", "directory:unsupported-capability",
      "Tool appears to transfer money/crypto/financial assets — a documented Claude Directory auto-reject.", (low.match(moneyMove) || [""])[0]);
  const aiMedia = /\b(generate|create|produce|synthesi[sz]e|render)\b[^.]{0,40}\b(image|images|picture|photo|video|audio|speech|voice|music|sound)s?\b/;
  const allowedMedia = /\b(diagram|chart|graph|flowchart|ui ?mock[- ]?up|mockup|wireframe)s?\b/;
  if (aiMedia.test(low) && !allowedMedia.test(low) && /\b(ai|model|diffusion|gpt|generative|neural|gan|text[- ]to[- ])\b/.test(low))
    add("high", "directory:unsupported-capability",
      "Tool appears to generate image/video/audio via an AI model — a documented Claude Directory auto-reject (diagram/chart/mock-up generation is allowed).", (low.match(aiMedia) || [""])[0]);

  return f;
}
