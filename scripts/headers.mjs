#!/usr/bin/env node
// Does the deployed site actually send the headers this repo declares?
//
//   node scripts/headers.mjs https://example.com
//
// Canonical copy lives in the devkit repo; `npm run sync` there pushes it out
// and `npm run drift` there fails if a repo's copy has diverged.
//
// NOT A GATE, and delivered as an asset rather than a bare entry in
// targets.json so the wiring gate does not demand it appear in `check`. It runs
// after a deploy. A gate runs before a push, and a live site is the *previous*
// deploy — so a `check` that curled production would go green while your change
// broke the headers, and red when somebody else's outage happened. Both
// directions are worse than not asking.
//
// It exists because of a failure no gate could reach. sproutvest.com served no
// Content-Security-Policy, no X-Frame-Options, no Permissions-Policy and no
// HSTS for months while its `_headers` declared all four, because Cloudflare
// Pages silently discards a rule whose path duplicates an earlier one and
// reports "Parsed 6 valid header rules" either way. The file was right, the
// deployment log was clean, and every check devkit owns passed it every day.
//
// So the question it asks is deliberately not "does this meet the floor" —
// `conventions.md` states the floor and a test in devkit holds the files to it.
// This asks the only question a file cannot answer: **is the response carrying
// what the file promised**. That needs no list of its own and cannot drift from
// one, which is the same coupling argument `store.mjs` is built on.

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The header names a `_headers` file promises on every route.
 *
 * Only the `/*` rule, because that is the one whose promise covers the URL
 * being fetched; a header on `/blog/*` is not broken by a homepage that lacks
 * it. Lower-cased because HTTP header names are case-insensitive and `fetch`
 * normalises them, and comparing raw would report a false absence for
 * `Referrer-Policy` versus `referrer-policy`.
 */
export function promised(text) {
  const names = [];
  let inAll = false;
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (/^\S/.test(raw)) { inAll = raw.trim() === "/*"; continue; }
    if (inAll && raw.includes(":")) names.push(raw.split(":")[0].trim().toLowerCase());
  }
  return names;
}

/** Promised and not delivered. `headers` is anything with a `.get`. */
export function absent(names, headers) {
  return names.filter((n) => headers.get(n) === null || headers.get(n) === undefined);
}

export function report(missing, url, reachable) {
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("");
  if (!reachable) {
    console.log(`  ?  Deployed headers            unmeasured — ${url} did not answer`);
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log("\n  Not a pass. This needs the network, and an outage between a deploy and");
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log("  this check must not be able to fail a deploy that worked.\n");
    return 0;
  }
  if (!missing.length) {
    console.log(`  ✓  Deployed headers            ${url} sends everything \`_headers\` promises`);
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log("");
    return 0;
  }
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  for (const name of missing) console.log(`  ✗  ${name.padEnd(30)} declared in \`_headers\`, absent from the response`);
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("");
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log(`  ${missing.length} header${missing.length === 1 ? "" : "s"} promised and not sent. The file being right is not`);
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("  evidence: check for a duplicate path rule, then the host's own transforms.\n");
  return missing.length;
}

/**
 * This repo's `_headers`, or null if it keeps none.
 *
 * Where it lives differs — Astro serves from `public/`, Eleventy from
 * `content/`, scd's client is a workspace package, and a site with no build
 * (maneki) serves its root — so it is found rather than configured. The root
 * is asked last, so a built repo's served copy wins over anything beside it.
 * Until 2026-11-16 the root was not asked at all, and maneki's six-header
 * `_headers` read as "nothing is promised": a pass that had measured nothing. A repo with no such file makes no promise, and a check with
 * nothing to assert is a pass rather than a failure: couyon-life declines a CSP
 * in writing and would otherwise be failed for honouring its own argument.
 */
export function headersFile(root) {
  const candidates = ["public/_headers", "content/_headers", "packages/client/public/_headers", "_headers"];
  return candidates.map((c) => join(root, c)).find(existsSync) ?? null;
}

// Only runs as a command, like every script here. The URL is an argument rather
// than config because the thing being asserted is a deploy, and the deploy knows
// where it just published.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Stryker disable all
  //
  // Argument handling, one fetch, and printing. Every decision this file makes
  // now lives in `promised`, `absent`, `headersFile` and `report` above, which
  // are pure and tested. What is left cannot be killed by a test that does not
  // make a network call, and left mutable it held this file at 43.56% while the
  // judgement inside it was the part that mattered.
  //
  // The exclusion is a claim that nothing below decides anything. A retry, a
  // status this forgives, a second URL — any of those is a decision and belongs
  // in a pure function above, or this comment becomes a lie that reads like a
  // reason. There is no `restore` because there is nothing after it; a
  // directive attaches to the node that follows, and on 2026-08-15 a restore
  // with nothing following it silently disabled the rest of a file.
  const root = new URL("..", import.meta.url).pathname;
  const url = process.argv[2];
  if (!url) {
    console.error("usage: node scripts/headers.mjs <url>");
    process.exitCode = 1;
  } else {
    const found = headersFile(root);
    if (!found) {
      console.log("\n  ·  Deployed headers            no `_headers` in this repo, so nothing is promised\n");
    } else {
      const names = promised(readFileSync(found, "utf8"));
      let res = null;
      try {
        res = await fetch(url, { redirect: "follow" });
      } catch {
        // Left null: unreachable is unmeasured, never a failure. Same rule
        // audit.mjs settled for the npm registry, and for the same reason — a
        // transient outage that fails a deploy teaches people to re-run it.
      }
      if (report(res ? absent(names, res.headers) : [], url, res !== null)) process.exitCode = 1;
    }
  }
}
