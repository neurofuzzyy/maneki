#!/usr/bin/env node
// Fail on known vulnerable dependencies. `npm run audit`, waivers in audit.json.
//
// Canonical copy lives in the devkit repo; `npm run sync` there pushes it out
// and `npm run drift` there fails if a repo's copy has diverged.
//
// This exists because Dependabot was already opening pull requests across the
// fleet — three landed during the 2026-08-11 audit — but nothing anywhere
// *failed* on a known advisory. A bot that files a PR applies no pressure at
// all if the PR can sit; the gate is what turns a notification into work.
//
// Three design choices worth defending:
//
// A registry that cannot be reached reports UNMEASURED and does not fail.
// This gate depends on a network call, which no other gate here does, and a
// CI outage at npm must not be able to redden every repo in the portfolio.
// The row stays visible so the absence is legible rather than silent.
//
// UNLESS THE CALLER SAYS OTHERWISE, added 2026-09-04. "Visible" assumed
// somebody reads the row, and on that day nobody did: sproutvest deployed once
// with its root unmeasured and committed two generated blog posts to master
// with both roots unmeasured, in a job holding an API key. Exit 0 stays the
// default for the reason above, but `AUDIT_STRICT=1` lets a step that is about
// to deploy, or to commit unattended, refuse a tree nobody read. Two attempts
// (`measure`) and a bounded `fetch-timeout` come from the same day and are what
// make an amber row mean an outage rather than a hiccup — the flags are also
// why a hung registry costs seconds instead of the 20-minute job that died.
//
// A MISSING LOCKFILE FAILS, AND MUST NOT SHARE THAT BRANCH. Both arrive from
// npm as valid JSON carrying no `vulnerabilities` key, so folding them together
// is the easy mistake and it is barely better than the bug it replaces:
// sproutvest-worker would go from a false green to a permanent amber, exit 0
// either way, with its dependencies still read by nobody. A registry is a
// transient the fleet must not go red on. A lockfile that is not where the gate
// was told to look is a wiring error, and a wiring error is a finding.
//
// WHAT IT CANNOT SEE, now that it has a directory to be wrong about. It looks
// for `package-lock.json` by that name, so a shrinkwrap or another package
// manager's lockfile reads as absent and fails. And it audits the roots it was
// told about and no others: a second dependency tree nobody named is as
// invisible as sproutvest-worker's was, and the fleet has one — sproutvest
// keeps `@anthropic-ai/sdk` and two more under `.github/scripts` with its own
// lockfile, beside a root this gate does measure. Naming the directories is the
// price of not adopting whatever arrives next, and this is the bill.
//
// Waivers are per-advisory and require a reason. Some advisories have no fix
// available, and the honest options are to remove the dependency, accept the
// risk, or lie. `npm audit --audit-level` would lie by lowering the bar for
// everything at once; naming the advisory and writing down why keeps the
// decision reviewable and keeps the rest of the gate at full strength.

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BLOCKING = ["critical", "high"];

/**
 * The report npm printed, or null when there is nothing readable to read.
 *
 * Split out of `runAudit` because it is the only decision that function makes,
 * and it is the one with teeth. `npm audit` exits non-zero whenever it finds
 * anything, so the error path is the *normal* path and its stdout still carries
 * the whole report. Treat that as a failed call and the gate answers "registry
 * unreachable" on every run that found a vulnerability — going quiet at exactly
 * the moment it has something to say, and returning 0 while it does.
 */
export function parseReport(stdout) {
  if (!stdout) return null;
  let body;
  try { body = JSON.parse(stdout); } catch { return null; }
  // npm answers a refusal exactly the way it answers a report: valid JSON, exit
  // non-zero. `vulnerabilities` is the only thing that tells them apart, and
  // reading a refusal as a report prints a green row for a tree nobody read.
  // A clean tree carries the key with an empty object, so this is not a test
  // for "found something".
  return body?.vulnerabilities ? body : null;
}

/**
 * The directories to audit, relative to the repo root. Defaults to this one.
 *
 * NAMED, NEVER SEARCHED FOR. A gate that walks the tree looking for a lockfile
 * adopts whatever arrives next without anyone deciding, which is the coupling
 * `budget.json` names its files to avoid. sproutvest-worker is why the key
 * exists: its dependencies all live in `worker/` and its root holds none, so
 * the gate audited a directory with no lockfile and called it clean for as long
 * as it had been wired there.
 */
export function roots(cfg) {
  const named = cfg?.roots ?? [];
  // A bare string is the likely typo and it is the dangerous one: `.length` is
  // truthy on it and `for...of` would walk its letters, auditing six
  // one-character directories. Throwing matches `budget.mjs`, which throws
  // rather than quietly measuring less than it was asked to.
  if (!Array.isArray(named)) throw new Error("audit.json: `roots` must be an array of directory names");
  return named.length ? named : ["."];
}

/**
 * Run npm audit in `root`. Null when npm returned no report — which is NOT the
 * same as "the registry could not be reached", though this comment said so
 * until 2026-08-18. It is every reason npm might decline, and the caller is
 * what decides which of them is an outage and which is a wiring error.
 */
function runAudit(root) {
  // Stryker disable all
  //
  // Spawn, and nothing else. The decision this function used to contain now
  // lives in `parseReport` above, which is pure and tested; what is left cannot
  // be killed by any test that does not shell out to a real registry. Left
  // mutable, these four lines were most of why audit.mjs read 33.68% while the
  // judgement inside them was the part that mattered.
  //
  // The exclusion is a claim that nothing here decides anything. If a decision
  // moves back in — a retry, an exit code the gate forgives — it goes in a pure
  // function above instead, or this comment becomes a lie that reads like a
  // reason.
  //
  // THE TWO FLAGS ARE A CLOCK, NOT A POLICY. npm's `fetch-timeout` defaults to
  // 300000ms, and that default is where sproutvest lost a deploy on 2026-09-04:
  // the advisories endpoint hung, both roots spent five minutes each reaching
  // that conclusion, and the job hit `timeout-minutes: 20` and was killed
  // inside `Deploy to Cloudflare Pages` — after `npm run check` had passed.
  // The gate did not fail. The clock did, and it took the deploy with it.
  // `--fetch-retries=0` is here so the bound is the one `measure` states:
  // npm's own retries would multiply this timeout behind our back.
  //
  // Measured while writing this, against a registry that was actually failing:
  // 21s per attempt instead of 300s.
  try {
    return parseReport(execFileSync("npm", ["audit", "--json", "--fetch-timeout=20000", "--fetch-retries=0"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }));
  } catch (err) {
    return parseReport(err.stdout);
  }
}
// Stryker restore all
//
// Outside the brace deliberately. A directive attaches to the node that follows
// it, and inside this function nothing does — the restore was silently a no-op
// there, disabling the rest of the file and dropping audit.mjs from 95 mutants
// to 10 while the score read 80%. `smoke.mjs` gets away with the same placement
// only because a `return` statement follows its restore.

/**
 * The first attempt that produced a report, or null when none did.
 *
 * THE RETRY THE `Stryker disable all` COMMENT ABOVE PREDICTED. That comment
 * says a retry "goes in a pure function above instead, or this comment becomes
 * a lie that reads like a reason", so here it is, pure and injected rather than
 * spawning anything itself. `nap` is injected for the same reason: a test that
 * really slept would be a test nobody runs.
 *
 * THE GAP IS THE WHOLE POINT, AND THE FIRST VERSION OF THIS DID NOT HAVE ONE.
 * Retrying immediately assumes failures are independent. They are not. Sampled
 * on 2026-09-04, six runs against the failing advisories endpoint went
 * `.M..M.` — it flaps on a scale of a minute or two rather than going down, so
 * two attempts twenty seconds apart land inside the SAME bad window and a row
 * saying "npm declined twice" was very nearly a row saying it declined once.
 * Sleeping between them samples a genuinely different moment, which is the
 * difference between re-rolling a die and waiting for it to settle.
 *
 * WHAT IT STILL DOES NOT BUY. It raises the odds; it does not make them one. A
 * sustained outage returns nothing however it is spaced, which is why
 * `unmeasured` remains a real state below. `tries` is a parameter rather than a
 * constant so a caller that would rather wait longer than fail can say so —
 * nothing in the fleet does today, and the default stays two because every
 * extra try is paid in wall clock by a deploy that is holding a job open.
 *
 * Atomics.wait is the only synchronous sleep Node has, and this file is
 * synchronous throughout because `execFileSync` is. Making `measure` async to
 * get `setTimeout` would make every caller async for a sleep on the sad path.
 */
export const measure = (run, tries = 2, gap = 30000, nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)) =>
  tries < 1 ? null : run() ?? (tries < 2 ? null : (nap(gap), measure(run, tries - 1, gap, nap)));

/**
 * Waived by name, or flagged ONLY through packages that are.
 *
 * npm reports every package on a vulnerable path as vulnerable itself, with
 * `via` naming the dependency it came through; only the package carrying the
 * advisory has an object there. Added 2026-11-18, when GHSA-fc5q-39xc-vjpf
 * landed on picomatch with no patched version and reddened 14 of 15 repos
 * through vite, vitest, typescript-eslint and lint-staged. Waiving the root
 * alone left every parent red; waiving the parents too would have silenced
 * vitest's next real advisory. So a parent passes only while EVERY path it is
 * flagged through ends at a waived name, and an advisory of its own (an object
 * in `via`) keeps it red. It is a walk over the graph rather than over one path,
 * because `via` has cycles (vitest and @vitest/coverage-v8 name each other) and
 * a path-based first version read the cycle as uncovered from one end. Every
 * package reached at high or above is visited once, the walk stops at waived
 * names, an advisory at any unwaived package fails it, and it passes only if it
 * reached a waived name, so a cycle with no waived way out stays red. Edges to
 * a package below high are not followed: that is not what made this one high
 * (typescript-estree also lists a moderate minimatch).
 */
export function covered(name, vulns, waived) {
  const todo = [name], seen = new Set(todo);
  for (let n; (n = todo.pop()) !== undefined;) for (const x of waived[n] ? [] : vulns[n]?.via ?? []) {
    if (typeof x !== "string") return false;
    if (!seen.has(x) && BLOCKING.includes(vulns[x]?.severity ?? "high")) seen.add(x), todo.push(x);
  }
  return [...seen].some((n) => waived[n]);
}

/**
 * Blocking findings, minus anything explicitly waived.
 *
 * Waiver keys are package names rather than advisory ids because that is what
 * `npm audit --json` reports at the top level; the id lives inside `via` and
 * is absent for transitive chains.
 */
export function findings(report, waived = {}) {
  const rows = [];
  for (const [name, v] of Object.entries(report?.vulnerabilities ?? {})) {
    if (!BLOCKING.includes(v.severity) || covered(name, report.vulnerabilities, waived)) continue;
    const ids = (v.via ?? []).map((x) => (typeof x === "object" ? x.source ?? x.url ?? x.title : null)).filter(Boolean);
    rows.push({
      name,
      severity: v.severity,
      // `fixAvailable` is false, true, or an object describing a breaking
      // upgrade. Only an outright false means there is nothing to install.
      fixable: v.fixAvailable !== false,
      detail: ids.length ? String(ids[0]).slice(0, 60) : "",
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function report(rows, state, waived = {}, dir = ".", fatal = false) {
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("");
  // The row names the directory it read whenever that is not the obvious one.
  // A gate reporting on somewhere else must say where, or its green means
  // something different from what everyone reads it to mean.
  const scope = dir === "." ? "Dependency advisories" : `Dependency advisories (${dir}/)`;
  if (state === "nolock") {
    console.log(`  ✗  ${scope.padEnd(28)} no package-lock.json — nothing here was measured`);
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log("\n  Not an outage, and not a pass. Either these dependencies live somewhere");
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log("  else, which `roots` in audit.json is for, or the missing lockfile is\n  itself the finding.\n");
    return 1;
  }
  // Anything that is not a measurement reports as one is missing, rather than
  // the measured path being the fallthrough. An unrecognised state should cost
  // an amber row, never a green one.
  //
  // `fatal` IS THE CALLER SAYING THIS TREE MATTERS MORE THAN THE FLEET DOES.
  // Exit 0 on unmeasured is right as a default and stays the default: an npm
  // outage must not redden every repo at once. But "right as a default" is not
  // "right everywhere", and on 2026-09-04 sproutvest showed the other end —
  // its Soro sync committed two generated blog posts to master with BOTH roots
  // unmeasured, in the one job that holds ANTHROPIC_API_KEY and can write to
  // the default branch. Nothing escalated, because nothing could: the gate had
  // no way to be told that this particular caller would rather stall.
  //
  // So the decision moves to whoever owns the blast radius. `AUDIT_STRICT=1` on
  // a step that is about to deploy, or about to commit unattended, turns amber
  // into red for that step alone and leaves every other run lenient.
  //
  // WHAT IT CANNOT DO, and it is the reason this is opt-in rather than clever:
  // the gate cannot tell which callers are high-stakes. A workflow that should
  // set it and does not is invisible here and always will be — this closes the
  // hole for callers that ASK, and names the rest rather than pretending to
  // cover them. Cross-run escalation ("unmeasured three days running") is still
  // absent too: this gate holds no state between runs and is not the right
  // place to start.
  if (state !== "measured") {
    const why = fatal ? "AUDIT_STRICT is set, so this caller does not proceed on a tree nobody read." : "Not a pass. This gate needs the network, and an npm outage must not be able to redden the whole fleet.";
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log(`  ${fatal ? "✗" : "?"}  ${scope.padEnd(28)} unmeasured — npm returned no report\n\n  ${why}\n`);
    return fatal ? 1 : 0;
  }
  const waivers = Object.keys(waived);
  if (!rows.length) {
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log(`  ✓  ${scope.padEnd(28)} none at high or critical${waivers.length ? ` (${waivers.length} waived)` : ""}\n`);
    return 0;
  }
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  for (const r of rows) console.log(`  ✗  ${r.name.padEnd(28)} ${r.severity.padEnd(9)} ${r.fixable ? "fix available" : "NO FIX — remove, replace, or waive with a reason"}`);
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("");
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log(`  ${rows.length} advisor${rows.length === 1 ? "y" : "ies"} at high or critical${dir === "." ? "" : ` in ${dir}/`}. Upgrade, or waive by name in`);
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("  audit.json with a reason — never by lowering the level for everything.\n");
  return rows.length;
}

// Only runs as a command. Left unguarded, importing this for a test would
// shell out from whatever directory the test ran in and set process.exitCode.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = new URL("..", import.meta.url).pathname;
  const cfgPath = join(root, "audit.json");
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
  const waived = cfg.waive ?? {};
  let failed = 0;
  // The lockfile is checked here rather than read out of npm's error code,
  // because whether the file is there is a fact this gate owns and npm's error
  // taxonomy is not. It also keeps the two absences apart: no lockfile is a
  // wiring error, and everything else npm declines to answer is an outage.
  for (const dir of roots(cfg)) {
    if (!existsSync(join(root, dir, "package-lock.json"))) { failed += report([], "nolock", waived, dir); continue; }
    // `process.env` is read here rather than in a helper because the DECISION
    // it feeds lives in `report`, which is pure and tested both ways. What is
    // left at this call site is a string comparison, and wrapping that in a
    // function would be a test asserting `===` works.
    const result = measure(() => runAudit(join(root, dir)));
    failed += report(findings(result, waived), result ? "measured" : "unmeasured", waived, dir, process.env.AUDIT_STRICT === "1");
  }
  if (failed) process.exitCode = 1;
}
