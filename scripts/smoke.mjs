#!/usr/bin/env node
// Assert the build actually produces a page. `npm run smoke`, config in smoke.json.
//
// Canonical copy lives in the devkit repo; `npm run sync` there pushes it out
// and `npm run check` there fails if a repo's copy has drifted.
//
// This exists because on 2026-08-10 an astro 7 upgrade in chainlodge built
// cleanly, passed `astro check`, passed the budget gate, and rendered every
// route as a 15-byte body containing the string "[object Object]". Every gate
// in the repo said green while the site served nothing. A build that succeeds
// is not the same claim as a page that has content, and nothing here was
// making the second one.
//
// Two modes, because the repos divide two ways:
//   "files"  — the build writes HTML. Assert the file is there, is bigger than
//              a floor, and still contains something only a real render emits.
//   "serve"  — nothing is written; the worker renders per request. Boot the
//              built artifact, hit the routes, assert the same three things.
//              It boots its own server and refuses the port if anything is
//              already on it — see `evaluateAdoption`.
//
// The floors are deliberately loose. This gate answers "is the page real",
// not "is the page correct" — that is what the byte budget and your eyes are
// for. A floor set just under the current size would fail on every copy edit.

import { readFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The whole judgement, as a pure function: is this body a real page? */
export function evaluate(body, bytes, spec) {
  if (bytes < spec.minBytes) return { ok: false, detail: `${bytes} bytes, floor is ${spec.minBytes}` };
  for (const needle of spec.contains ?? []) {
    if (!body.includes(needle)) return { ok: false, detail: `${bytes} bytes but missing ${JSON.stringify(needle)}` };
  }
  return { ok: true, detail: `${bytes} bytes` };
}

/**
 * The same judgement for a served response, plus the status it had to arrive
 * with.
 *
 * Split out of the serve loop rather than left inline, because these are the
 * only two decisions in that whole block — everything around them is spawn,
 * poll and kill — and inline they could be exercised only by booting a real
 * server. A decision reachable only through a subprocess is a decision nothing
 * will ever test.
 *
 * The size is `Buffer.byteLength` and not `body.length`. Four of these repos
 * ship Chinese, where a hanzi is one UTF-16 unit and three UTF-8 bytes, so a
 * page measured wrong reads as a fraction of its real size and trips a floor
 * it clears comfortably.
 */
export function evaluateResponse(status, body, spec) {
  const expected = spec.status ?? 200;
  if (status !== expected) return { ok: false, detail: `HTTP ${status}, expected ${expected}` };
  return evaluate(body, Buffer.byteLength(body), spec);
}

/**
 * The third judgement: is this port ours to serve on?
 *
 * Bought by scd's `4.34`, where Playwright's `reuseExistingServer` adopted a
 * sibling repo's `vite preview` on 4173 and ran an entire accessibility suite
 * against a Chinese chess tutor, reporting its contrast violations as scd's.
 * This gate had the same hole and a worse version of it: the readiness poll
 * below asks only whether *something* answers, so a leftover server — another
 * repo's, or this repo's own from an aborted run three builds ago — was
 * adopted silently, in every environment, with no flag to decline it.
 *
 * There a title assertion happened to catch it, because the neighbour had a
 * different `<title>`. Nothing here would: the routes would have been measured
 * against the wrong bytes and passed or failed on their merits. A stale server
 * from this same repo is the quietest case of all, since every marker still
 * matches and only the build is wrong.
 *
 * So the rule is scd's rule, and it holds in both environments because a gate
 * that may test a server it did not start is exactly where `npm run check` and
 * CI stop meaning the same thing: serve what you built, or fail.
 *
 * WHAT THIS CANNOT SEE. It asks over HTTP, so a socket that accepts a
 * connection and never answers reads as free. That case is not silent — the
 * spawn loses the port, the readiness poll times out, and the row says "never
 * became ready" — which is the loud failure this gate already had. The silent
 * one is a working server, and a working server answers.
 */
export function evaluateAdoption(answering, port) {
  if (answering) return { ok: false, detail: `port ${port} already answers — refusing to adopt a server this gate did not start` };
  return { ok: true, detail: "port is free" };
}

export async function runSmoke(root, cfg) {
  const results = [];
  const record = (label, r) => results.push({ label, ...r });

  for (const spec of cfg.files ?? []) {
    const abs = join(root, spec.path);
    if (!existsSync(abs)) {
      record(spec.path, { ok: false, detail: "missing — run `npm run build` first" });
      continue;
    }
    record(spec.path, evaluate(readFileSync(abs, "utf8"), statSync(abs).size, spec));
  }

  // Stryker disable all
  //
  // Everything from here to the end of this block is spawn, poll and kill, and
  // it is excluded from mutation testing on purpose. The judgement it used to
  // contain now lives in `evaluateResponse` above, which is pure and tested;
  // what is left cannot be killed by any test that does not boot a real
  // server, and tests that boot real servers are the ones that get commented
  // out on a bad CI day. Left mutable, this block alone held smoke.mjs at
  // 20.61% and made the number say "these tests are weak" when what it meant
  // was "this is a subprocess".
  //
  // The exclusion is a claim that nothing here decides anything. If a decision
  // ever moves back in — a retry rule, a status the gate forgives — it goes in
  // a pure function above instead, or this comment becomes a lie that reads
  // like a reason. The refusal to adopt a running server is the third decision
  // to be kept out this way: `evaluateAdoption` holds it, and the block below
  // only asks the port and reports what that function says.
  if (cfg.serve) {
    const port = cfg.serve.port ?? 8799;
    const base = `http://127.0.0.1:${port}`;
    // One probe, asked twice for opposite reasons: before the spawn an answer
    // means a stranger holds the port, after it an answer means our own child
    // is up. Same question, and only the reply we are hoping for changes.
    const answering = () => fetch(base + (cfg.serve.readyPath ?? "/"), { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);

    const claim = evaluateAdoption(await answering(), port);
    if (!claim.ok) {
      record(cfg.serve.label ?? "server", claim);
    } else {
      // detached so the whole process group can be killed: wrangler spawns a
      // workerd child that outlives a plain kill on the shell.
      const child = spawn(cfg.serve.command.replaceAll("{PORT}", String(port)), {
        shell: true, detached: true, stdio: "ignore", cwd: root,
      });

      const deadline = Date.now() + (cfg.serve.readyTimeoutMs ?? 90_000);
      let up = false;
      while (!up && Date.now() < deadline) {
        up = await answering();
        if (!up) await new Promise((r) => setTimeout(r, 500));
      }

      try {
        if (!up) {
          record(cfg.serve.label ?? "server", { ok: false, detail: "never became ready" });
        } else {
          for (const spec of cfg.routes ?? []) {
            try {
              const res = await fetch(base + spec.path, { signal: AbortSignal.timeout(15_000) });
              record(spec.path, evaluateResponse(res.status, await res.text(), spec));
            } catch (err) {
              record(spec.path, { ok: false, detail: `request failed: ${err.message}` });
            }
          }
        }
      } finally {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The group is already gone — the server exited on its own, or the
          // earlier SIGTERM landed. Either way there is nothing left to kill and
          // nothing a caller could do about it.
        }
      }
    }
  }
  // Stryker restore all

  return results;
}

export function report(results) {
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("");
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log(`  ${r.ok ? "✓" : "✗"}  ${r.label.padEnd(38)} ${r.detail}`);
  }
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("");
  if (!results.length) {
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log("  smoke.json matched nothing to check — that is a broken gate, not a pass.\n");
    return 1;
  }
  if (failed) {
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log(`  ${failed} smoke check${failed === 1 ? "" : "s"} failed. The build succeeded and the site did not.\n`);
  }
  return failed;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = new URL("..", import.meta.url).pathname;
  const cfg = JSON.parse(readFileSync(join(root, "smoke.json"), "utf8"));
  if (report(await runSmoke(root, cfg))) process.exitCode = 1;
}
