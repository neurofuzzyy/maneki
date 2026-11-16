#!/usr/bin/env node
// Measure this repo against the caps in budget.json. `npm run budget`.
//
// Canonical copy lives in the devkit repo; `npm run sync` there pushes it out
// and `npm run check` there fails if a repo's copy has drifted. Edit it here,
// not in the repo you happen to be standing in.
//
// "Keep it small" is a preference until something fails on it. This is the
// something. Caps are deliberately set close to current values: the point is
// to notice growth on the iteration that causes it, not to leave room to grow
// into quietly.
//
// Comments are excluded from the code-line count on purpose. Documentation is
// encouraged in these repos, and a budget payable by deleting explanations
// would buy smaller files at the cost of the reasoning behind them. The
// comment-stripping below is adapted from LearnMandarin's scripts/budget.mjs,
// which learned it the hard way: a `grep -v '^\s*//'` over-counted by 178
// lines because it cannot see a block comment's body or a JSX `{/* … */}`.
//
// Asset rows need a build first. Without one they FAIL as unmeasured, printing
// every other row as usual. Until 2026-09-26 an unmeasured row printed `?` and
// passed, so a bare `npm run budget` stayed green, and so did a CI whose build
// step had moved below the budget or into another job: scd's five asset rows
// all read `?` with exit 0 from a tree with no dist. A gate that measures
// nothing is not a pass. It is not lenient the way `audit.mjs` is, because a
// registry outage is outside a repo's control and a missing build never is;
// every recipient's `check` builds first, which is what made this safe.
//
// WHAT THIS GATE CANNOT SEE, and the first one is not the sentence above.
// `unmeasured` covers a dist that is ABSENT. The failure that actually
// happened was a dist that was STALE: scd reported 1669 KB against a real
// 1226 because a build directory is always lying around locally and the rows
// read it without knowing when it was written. Absence is loud and staleness
// is silent, so `build` goes immediately before `budget` in every repo's
// `check` — that ordering, not this file, is what makes an asset row true.
//
// It cannot see COMPLEXITY. Lines and dependency names are the two things
// counted here, and neither is a claim about whether the code is any good:
// a repo can sit comfortably under every cap and be unreadable, and a cap can
// be met by moving logic into a file the config does not name. `dirs` and
// `ext` decide what exists as far as this gate is concerned, which is why a
// missing named path throws rather than measuring an empty list.
//
// And an asset row weighs a build directory, not a page. Raw by default; a row
// declaring `"gzip": true` weighs each file gzipped at level 9 and prints
// `KB gz`, which is nearer what a visitor downloads and is still not it. It
// cannot see THIRD-PARTY bytes (gtag.js, the largest asset on most of the
// fleet's pages, exists only at runtime), THE ENCODING THE HOST CHOSE, HTTP
// overhead, caching, or a file the build emits and no page loads. On the
// encoding, this said until 2026-09-27 that Cloudflare serves brotli to most
// browsers, smaller than this figure, so the row errs high. All three halves
// were measured false (board `fleet-gzip-row-vs-wire`). Cloudflare chooses per
// asset: erickwatson.com's stylesheet goes out as gzip, matching this figure to
// the byte. Its brotli is not always smaller. And the row errs BOTH WAYS:
// 10,734 bytes high on englishcards' deck (served br), and 933 bytes LOW on
// learnxiangqi's entry chunk, served br although gzip was smaller. Under the
// wire is the unsafe direction, so a row near its cap is not proof of the
// download. Served bytes
// are Lighthouse's, in the CI job P3 of devkit's ROADMAP rolls out; this is the
// deterministic half that runs before a deploy.

import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

/**
 * The first thing on a line that ends code: a literal, or a comment opener.
 *
 * ONE alternation, leftmost-wins, for the reason `LITERAL` below says at
 * length — whichever construct opens first consumes the others. The order
 * inside it is load-bearing twice. `\/\/` and `\/\*` come before the regex
 * arm, or `/* a comment *\/` matches as a regex literal delimited by its own
 * `*\/`. The regex arm comes at all, because a regex's delimiter is `/` and
 * every quote-based guard is blind to it.
 */
const MARKER = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*(`?)|\/\/|\/\*|\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\[])+\/[a-z]*/g;

/** Non-blank lines that aren't comments — line, block, or JSX. */
export function codeLines(source) {
  let count = 0;
  let inBlock = false;
  let inTemplate = false;
  for (const original of source.split("\n")) {
    let line = original;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*[\s\S]*?\*\//g, " ");
    // WHICHEVER OPENS FIRST CONSUMES THE OTHER. Neither `//` nor `/*` means
    // anything inside the other, so the only correct rule is leftmost-wins, and
    // deciding one of them unconditionally first is wrong in one direction or
    // the other. Getting this wrong does not miscount a line: it latches
    // `inBlock` and silently drops every line after it in the file.
    //
    // Both directions have now happened, on the same function, a week apart.
    // `/*` unguarded made erickwatson-com's eleventy.config.js measure 51 lines
    // against a real 113, three repos under-counting by 233 between them. The
    // fix for that tested `/*` FIRST, so a line comment naming a route —
    // `// /api/* is sign-in` — latched instead, and scd, sproutvest and
    // learnxiangqi dropped 42 lines across four Pages Functions and a service
    // worker, every one of them shipped code. Route globs live in comments in
    // exactly those files, which is why it clustered there and nowhere else.
    //
    // The guard used to ask whether ANY QUOTE appeared earlier on the line, and
    // that question has two answers this one does not. A REGEX IS DELIMITED BY
    // `/`, NOT BY A QUOTE, so `p.replace(/^\/*/, "")` — strip leading slashes,
    // ordinary code — carried a bare `/*` that opened a block nothing closed and
    // zeroed every line below it. And A TEMPLATE SPANS LINES, so on the
    // continuation holding `content/Appearances/*.md` the opening backtick was
    // on an earlier line and no same-line test could see it. Both found
    // 2026-08-25, both the same latch, neither reachable by counting quotes.
    //
    // So the guard stopped asking and started SCANNING. `MARKER` consumes each
    // literal whole, which is why the marker it returns is the first one that is
    // really a comment — and it is a scan rather than a wider heuristic because
    // the obvious cheap fix, toggling on the parity of backticks per line, is
    // worse than the bug. The backtick inside this file's own `/["'`]/` is odd,
    // which stranded the flag for three hundred lines: scd's copy measured 140
    // against 373. An over-count that large is not the safe direction, it is a
    // gate nobody can read.
    //
    // WHAT IT STILL CANNOT SEE. `${}` interpolation is treated as template body,
    // so a comment inside one is billed as code. An escaped backtick on a
    // continuation line closes the template early. Division reads as a regex
    // when a later `/` completes it — `a / b; /* note` misses the opener. All
    // three OVER-count, which is the direction that turns a row red rather than
    // hiding growth, and each is rarer than the two latches above were.
    MARKER.lastIndex = 0;
    if (inTemplate) { const c = line.indexOf("`"); if (c === -1) { if (line.trim()) count++; continue; } inTemplate = false; MARKER.lastIndex = c + 1; }
    for (let m; (m = MARKER.exec(line)); ) {
      if (m[0] === "//" || m[0] === "/*") { inBlock = m[0] === "/*"; line = line.slice(0, m.index); break; }
      if (m[0][0] === "`" && !m[1]) { inTemplate = true; break; }
    }
    if (/^\s*\{?\s*\}?\s*$/.test(line)) continue; // what a JSX comment leaves behind
    if (line.trim()) count++;
  }
  return count;
}

/**
 * Every comment, string, char and raw string in `source`, in one alternation.
 *
 * ONE pass, not five sequential replaces, and that is the whole reason this is
 * a constant rather than a chain. Blanking comments first turns `"http://x"`
 * into an unterminated string; blanking strings first eats a `"` inside a
 * comment. A single regex takes the LEFTMOST match at each position, so
 * whichever construct opens first consumes the others — which is the same bug
 * the header above records `codeLines` learning the hard way.
 */
const LITERAL =
  /r(#*)"[\s\S]*?"\1|"(?:\\[\s\S]|[^"\\])*"|'(?:\\u\{[0-9a-fA-F]+\}|\\[\s\S]|[^'\\])'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/**
 * `source` with those blanked to spaces.
 *
 * Only ever used to find the braces that delimit a block. Blanking rather than
 * deleting keeps every offset and newline where it was, so a line index into
 * the mask is a line index into the original. It exists because `{` and `}` are
 * ordinary characters inside a string, a char literal or a comment, and a brace
 * counter that cannot tell them apart stops at the wrong brace — silently,
 * because what it returns is still a plausible-looking block.
 *
 * A Rust lifetime (`&'a str`) is deliberately not matched: the char alternative
 * needs a closing quote, and a lifetime has none. It holds no braces either way.
 *
 * The escape is `\\[\\s\\S]` and not `\\.`, which is not a nicety. `.` does not match a
 * newline, so a Rust line-continuation — a backslash as the last character of a
 * line inside a string — made the string alternative fail, and the engine then
 * read that string's CLOSING quote as an opening one. On scd's `interactive.rs`
 * that masked 149 lines including the `mod tests {` this is here to find, and
 * the file quietly stopped being stripped. Found by measuring the real corpus
 * against a second implementation, not by the 65 unit tests, all of which
 * passed either way.
 */
export function maskLiterals(source) {
  return source.replace(LITERAL, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * Rust source with its `#[cfg(test)]` blocks removed.
 *
 * # Why this is derived rather than declared
 *
 * Every other test exclusion in this gate is a path pattern a repo writes down,
 * because where a repo puts its tests is a repo's decision. Rust's is not:
 * `#[cfg(test)] mod tests` lives *inside the file under test*, in every Rust
 * codebase there has ever been. Asking a repo to declare that is asking it to
 * copy a fact — the move `conventions.md` already refuses for the CMP origin —
 * so it is read off the language instead.
 *
 * # What it is worth
 *
 * scd carried **8,252 counted lines** of `#[cfg(test)]` — 64% of its Rust and
 * 27.5% of its whole cap — while its TypeScript tests cost nothing at all. So
 * `4.43` added twenty TypeScript tests for free and `4.50` added two Rust tests
 * for 65, and the incentive pointed away from the half holding damage,
 * movement, arcs, energy, validation and the AI. This makes "a test is not
 * counted" true in both languages instead of true wherever the language
 * happens to put tests in a separate file.
 *
 * # WHAT THIS CANNOT SEE
 *
 * A test that is not in a `#[cfg(test)]` block. `tests/` directory integration
 * tests are separate files and were never counted anyway; a `#[test]` fn
 * written at module scope with no `cfg` gate is counted, and should be — it
 * compiles into the shipped binary.
 *
 * It also cannot see whether the block it removed *was* tests. `#[cfg(test)]`
 * gates a block out of release builds, which is what makes it safe to stop
 * counting; it does not promise the contents are test code.
 *
 * AND IT DOES NOT REMOVE A GATED STRUCT FIELD, which is a deliberate refusal
 * rather than an oversight. A field ends at a comma; this scan recognises a
 * closing brace and a semicolon, and guessing at the comma would mean deciding
 * where an item ended with no way to be sure. So the attribute and its field
 * stay counted — an over-count of one item, in the direction a budget may
 * safely be wrong. Until 2026-08-23 it did something far worse: it consumed
 * the enclosing block's brace and every item after it.
 *
 * A `#[cfg(all(test, ...))]` is not matched either. That is scope, not a gap
 * anyone has paid for: 0 of the 38 attributes in the fleet's only Rust repo
 * use the form, and all 38 sit at column zero.
 */
export function stripRustTests(source) {
  const mask = maskLiterals(source);
  const lines = source.split("\n");
  const masked = mask.split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*#\[cfg\(test\)\]/.test(masked[i])) { kept.push(lines[i]); continue; }
    // The item ends at the `}` closing its first `{`, or at the first `;`
    // outside every bracket — whichever comes first. The `;` branch is not a
    // nicety: `#[cfg(test)] mod fixtures;` and `#[cfg(test)] const X: [u8; 2]`
    // have no braces at all, and a scan that only looked for `}` ran on into
    // the NEXT item and removed that instead. `[` and `(` are counted for the
    // same reason — the first `;` in `const X: [u8; 2]` is inside a bracket.
    let d = 0, opened = false, closed = false, j = i;
    for (; j < lines.length && !closed; j++) {
      for (const ch of masked[j]) {
        if (ch === "{" || ch === "[" || ch === "(") { d++; if (ch === "{") opened = true; }
        else if (ch === "}" || ch === "]" || ch === ")") {
          // A `}` AT DEPTH ZERO WITH NOTHING YET OPENED IS THE ENCLOSING
          // BLOCK'S, not this item's. A field gated with `#[cfg(test)]` ends at
          // its comma and carries no closer of its own, so consuming that brace
          // ran the scan on and removed the struct's closing line and THE NEXT
          // REAL ITEM with it — `pub fn shipped()` disappeared and the count
          // fell from 4 to 1. The same run-on the `;` branch above fixed for
          // `mod fixtures;` and did not fix for `seen: bool,`, because a comma
          // is not a terminator this scan can recognise.
          //
          // Abandoning the scan rather than closing here is the deliberate
          // half. It leaves the gated field counted, which over-counts by one
          // item; closing at the previous line would guess where an item ended
          // and report the smaller, comfortable number. Same answer the
          // unclosed-block branch below gives, for the same reason.
          if (ch === "}" && !opened && d <= 0) { j = lines.length; break; }
          d--; if (ch === "}" && opened && d <= 0) closed = true;
        }
        else if (ch === ";" && d <= 0) closed = true;
        if (closed) break;
      }
    }
    j--;
    // An unclosed block is a syntax error the compiler will report. Running off
    // the end of the file here would stop counting everything after the
    // attribute and report a smaller, comfortable number, so nothing is removed
    // unless a matching close was actually found. `opened` alone is not that
    // test — it is true the moment the first `{` is seen, which is why the
    // first version of this swallowed the file and its test caught it.
    if (!closed) { kept.push(lines[i]); continue; }
    i = j;
  }
  return kept.join("\n");
}

/**
 * Every file under `dir`, recursively. Missing directories are simply empty.
 *
 * A recursive `readdirSync` since 2026-09-22, replacing a hand-rolled
 * recursion that asked `statSync` at every level. The two agree on symlinks,
 * which is not what the queue item that proposed this expected: on Node 22,
 * which every CI in the fleet runs, the recursive read descends a symlinked
 * directory just as `statSync` did, and a symlink cycle throws `ELOOP` from
 * both. The test beside this pins that, because it is a property of the
 * runtime rather than of this file, and a Node that stopped following links
 * would quietly shrink every count and scan built on it.
 */
export const walk = (root, dir) => !existsSync(join(root, dir)) ? []
  : readdirSync(join(root, dir), { recursive: true }).map((e) => `${dir}/${e}`).filter((rel) => !statSync(join(root, rel)).isDirectory());

/**
 * The files devkit delivered here, which this repo's budget must not count.
 *
 * A repo cannot shrink, edit or trade away a file that arrives from devkit and
 * is held byte-identical by `npm run drift` there. Counting it leaves exactly
 * one legal move when the row goes red — raise the cap — which is the move the
 * conventions forbid, so the gate would be teaching the habit it exists to
 * prevent. They are counted once already, against devkit's own cap, by the one
 * repo that can act on the number.
 *
 * The decisive case is not that argument though, it is that the row moves on
 * its own. On 2026-08-15 a devkit review took `audit.mjs` from 111 lines to
 * 138 — a change nobody outside devkit asked for or could refuse — and scd's
 * code count went up by it. A budget another repository can push over is a gate
 * failing for a reason unrelated to the change under test, which is the false
 * red this portfolio has now fixed four times.
 *
 * scd was the only repo it reached, and only because `ext` there includes
 * `.mjs`; everywhere else the delivered scripts went uncounted by accident of
 * an extension list rather than by anyone deciding. That is the weaker half of
 * the same problem: six repos were right for a reason that would stop being
 * true the day one of them counted `.mjs`.
 *
 * Read from a generated file rather than listed in each budget.json, because
 * hand-listing delivered paths is the same check with the coupling removed — it
 * protects the file somebody remembered and goes on counting the next one.
 * erickwatson-com had exactly that: a careful, correct exclusion naming
 * `consent.js` alone. An absent file means devkit delivers nothing here, which
 * is true of devkit itself.
 */
export function deliveredHere(root) {
  const path = join(root, "devkit.files.json");
  if (!existsSync(path)) return new Set();
  return new Set(JSON.parse(readFileSync(path, "utf8")).files ?? []);
}

/** Measure every configured row. Returns rows; does not print or exit. */
export function measure(root, cfg) {
  const rows = [];
  const deadExcludes = [];

  const devkits = deliveredHere(root);

  // ONE CATEGORY OR SEVERAL, and the single-object form is not a legacy shape
  // to migrate off. Most repos measure one body of code and should go on saying
  // so in the simplest way the config allows; wrapping and flattening means the
  // eight repos holding an object need no edit and behave identically.
  //
  // Several exist because a repo can hold two bodies of code whose caps are not
  // comparable. devkit is about to: the shared learning engine arrives as
  // TypeScript under `engine/`, ~669 lines against tooling's 1,080, and rolling
  // them into one number would mean either a cap bump — which `_cap_comment`
  // forbids for exactly this — or a total nobody can argue with, because a
  // single figure cannot say which half grew. Separate caps keep each half
  // arguable on its own terms, which is the whole reason the contract asked for
  // a category rather than a raise.
  for (const c of [cfg.code ?? []].flat()) {
    const exclude = (c.exclude ?? []).map((r) => new RegExp(r));
    // `files` names individual paths. It exists because the largest single
    // piece of logic in a repo is often a root-level config — an Eleventy or
    // Vite config — which `dirs` cannot reach: walk() calls readdirSync and
    // throws ENOTDIR on a file. The alternative, putting "." in dirs with
    // excludes, walks node_modules and silently adopts every future root file.
    //
    // Not extension-filtered: naming an exact path is already the decision.
    // A named path that does not exist is an error rather than an empty list,
    // unlike a missing dir. A typo here would silently shrink the measured
    // set, which is the one failure a budget must never have. Checked as a
    // guard before the list is built rather than inside a `map` that returned
    // its own argument, which was four lines doing the work of one.
    for (const f of c.files ?? []) if (!existsSync(join(root, f))) throw new Error(`budget.json names a file that does not exist: ${f}`);
    const candidates = (c.dirs ?? [])
      .flatMap((d) => walk(root, d))
      .filter((f) => c.ext.some((e) => f.endsWith(e)))
      .concat(c.files ?? []);
    const files = candidates.filter((f) => !exclude.some((r) => r.test(f)) && !devkits.has(f));
    // A PATTERN THAT MATCHES NOTHING IS A FAILURE, and it gets its own row for
    // the reason `legal.mjs` gives about the identical field: the count cannot
    // show it, because a dead exclusion leaves the number HIGHER, and higher is
    // what a widening exclusion looks like when it is working.
    //
    // The fleet has already had this exact bug in the other config. Seven of
    // ten `legal.json` files carried `"\\\\.test\\\\."`, which parses to a
    // pattern asking for a literal backslash and matched nothing for a year.
    // `budget.json` is the same field, with the same JSON double-escaping trap
    // and, until now, nothing watching it — while `conventions.md` was busy
    // telling every repo to add path-shaped entries to it for policy pages.
    //
    // WHAT THIS DOES NOT DO, so the row is not read as more than it is: it
    // cannot tell an exclusion that removes a policy page from one that removes
    // a layout, a helper or a component. `exclude` takes a regex and applies it
    // unanchored, so `src/pages/privacy` also swallows `src/pages/privacy-calc.ts`.
    // Liveness catches the typo. Nothing here catches the pattern that is alive
    // and too wide — that is what naming exact anchored paths is for, and it is
    // a discipline rather than a check.
    for (const [i, r] of exclude.entries()) {
      if (!candidates.some((f) => r.test(f))) deadExcludes.push(c.exclude[i]);
    }
    // `.rs` is stripped of its `#[cfg(test)]` blocks first — see
    // `stripRustTests` for why that is derived from the language rather than
    // declared per repo. Both rows get the same source, so the parenthetical
    // "with comments" stays a statement about the same body of code as the
    // number in front of it.
    //
    // `.njk` has its `{# #}` comments blanked, newlines kept, because
    // `codeLines` knows JavaScript's comments and not Nunjucks', so every line
    // of one was billed as code: erickwatson-com's `base.njk` counted 264
    // against 236. Keyed on the extension because `{#` is legal JavaScript
    // (`class A {#x}`) and must stay counted there. WHAT IT CANNOT SEE: a `{#`
    // inside a string in a template's inline script also opens a comment here,
    // and nothing in the fleet writes one today.
    //
    // `.astro` has its `<!-- -->` blanked the same way, but ONLY AFTER THE
    // FRONTMATTER. The fence holds real JavaScript, where `<!--` is legal, so
    // one alternation matches the fenced block first (anchored at the file's
    // start, leftmost wins) and hands it back untouched. Measured 2026-09-27:
    // chainlodge and sproutvest, the two repos counting `.astro`. WHAT IT
    // CANNOT SEE: a `<!--` inside a string in a template's `<script>`, and a
    // fence written with CRLF line endings, which the fleet does not use.
    const read = (f) => {
      const src = readFileSync(join(root, f), "utf8"), comments = { njk: /\{#[\s\S]*?#\}/g, astro: /^---\n[\s\S]*?\n---|<!--[\s\S]*?-->/g }[/\.(njk|astro)$/.exec(f)?.[1]];
      return f.endsWith(".rs") ? stripRustTests(src) : comments ? src.replace(comments, (m) => m.startsWith("---") ? m : m.replace(/[^\n]/g, "")) : src;
    };
    const code = files.reduce((n, f) => n + codeLines(read(f)), 0);
    const raw = files.reduce((n, f) => n + read(f).split("\n").length - 1, 0);
    // A CATEGORY THAT MATCHED NOTHING IS A FAILURE, not a comfortable zero.
    // Zero is the most reassuring number a budget can print and the least
    // trustworthy: it is what a stale path, a wrong `ext` and a directory that
    // never arrived all look like, and every one of them reports green while
    // measuring nothing. `coverage.mjs` already refuses the identical shape —
    // a configured directory matching no file fails there, because 0 of 0
    // lines is trivially 100%. The two gates should not disagree about what an
    // empty configuration means.
    //
    // THE TWO WAYS OF BEING EMPTY ARE REPORTED APART, because a gate that
    // fails while naming the wrong cause sends somebody to check a path that
    // was right all along. Nothing matched means the config is stale. Files
    // matched and were all excluded means the category is entirely devkit's or
    // entirely swept by `exclude` — the paths are correct and the category is
    // measuring nothing of this repo's own work, which is a different fix.
    rows.push({
      label: c.label ?? "Code lines", value: code, cap: c.cap, shown: `${code} (${raw} with comments)`,
      empty: !files.length, allExcluded: !files.length && candidates.length > 0,
    });
    // A total cannot say WHICH file grew, and the cut then lands wherever it
    // is easiest. devkit carried per-file guardrails as prose in a JSON comment
    // for a month while three files crossed them green. `fileCap` is the
    // default ceiling and `fileCaps` names the files argued larger, each held
    // to liveness like `exclude`: a cap on a file this row no longer measures
    // is stale, because a ceiling nobody is under is how a rename escapes one.
    if (c.fileCap) {
      const capOf = (f) => c.fileCaps?.[f] ?? c.fileCap;
      const over = files.map((f) => [f, codeLines(read(f))]).filter(([f, n]) => n > capOf(f)).map(([f, n]) => `${f} ${n}/${capOf(f)}`);
      const found = over.concat(Object.keys(c.fileCaps ?? {}).filter((f) => !files.includes(f)).map((f) => `${f} is not measured here`));
      rows.push({ label: `${c.label ?? "Code lines"}, files over`, value: found.length, cap: 0,
        shown: `${found.length} of ${files.length}${found.length ? ` — ${found.join(", ")}` : ""}` });
    }
  }

  // One row for every category's exclusions together, because the question a
  // reader has is "is anything in this config lying about what it measures",
  // not which of two caps owns the typo — and the patterns are named in full,
  // so the answer to "which one" is in the row.
  if (deadExcludes.length) {
    rows.push({
      label: "Exclusions are live", value: deadExcludes.length, finding: true,
      shown: `${deadExcludes.length} match no file — ${deadExcludes.map((d) => JSON.stringify(d)).join(", ")}`,
    });
  }

  if (cfg.deps) {
    // `manifest` takes one path or several. Several exist for the monorepos: a
    // workspace splits its dependencies across packages, and measuring only the
    // root — which typically declares none — reports a cap-respecting 0 while
    // any package underneath adds freely. A gate that cannot see the thing it
    // caps is worse than no gate, because it reads as evidence.
    const manifests = [cfg.deps.manifest ?? "package.json"].flat();
    // Distinct names, not a sum: zod in two packages is one dependency the
    // portfolio has taken on, and the rule this enforces is about what the repo
    // depends on, not how many times it says so.
    const names = new Set();
    for (const m of manifests) {
      const pkg = JSON.parse(readFileSync(join(root, m), "utf8"));
      for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
        // A `file:`/`workspace:` link is one of this repo's own packages. It is
        // not a dependency in the sense the rule means — nothing is being taken
        // on — and counting it would price splitting a package as a violation.
        if (/^(file|workspace|link):/.test(spec)) continue;
        names.add(name);
      }
    }
    const n = names.size;
    rows.push({ label: "Runtime dependencies", value: n, cap: cfg.deps.cap, shown: String(n) });
  }

  for (const a of cfg.assets ?? []) {
    const files = walk(root, a.dir).filter((f) => f.match(a.match));
    if (!files.length) {
      rows.push({ label: a.label, value: null, finding: true, shown: `unmeasured — nothing in ${a.dir}; build before budget` });
      continue;
    }
    const bytes = files.reduce((n, f) => n + weigh(join(root, f), a.gzip), 0);
    // The count rides along on every row, capped or not, because it is what
    // makes the difference between "this got bigger" and "something else is
    // writing here" legible at a glance. scd spent a session on 1451.7 KB
    // against a 1280 cap that was a 69-file mirror of `src/` emitted by a
    // typecheck: obvious as a count, invisible as a total somebody reads as a
    // size problem.
    rows.push({ label: a.label, value: bytes, cap: a.cap, bytes: true, gz: a.gzip,
      shown: `${size(bytes, a.cap, 1, a.gzip)} in ${files.length} file${files.length === 1 ? "" : "s"}` });
    // A declared `files` cap is a SECOND ROW rather than a second comparison on
    // the one above, so shipping too many files reads as a different failure
    // from shipping too many bytes — which they are: Cloudflare Pages refuses a
    // deployment over 20,000 files whatever they weigh. englishcards' budget
    // said that limit "cannot be expressed as an asset row at all" and
    // hand-rolled it in scripts/audio.mjs; this is the row that lets that go.
    // The renderer needed no new path — it already prints an integer cap.
    // `!== undefined` and not truthiness: this repo's own budget.json carries
    // `deps.cap: 0` with a comment saying the zero IS the point, so a falsy cap
    // is a real configuration here and skipping it would be silent.
    if (a.files !== undefined) rows.push({ label: `${a.label} (files)`, value: files.length, cap: a.files, shown: String(files.length) });
  }

  return rows;
}

/**
 * A file's weight: its bytes as they sit, or gzipped at level 9 when the row
 * asks. Level 9 and not zlib's default 6 because it is LearnMandarin's, whose
 * own budget.mjs has weighed a gzipped deck this way since before this option
 * existed, and two gates answering one question with different arithmetic is
 * how a number stops being comparable across the fleet.
 */
export const weigh = (path, gzip) => gzip ? gzipSync(readFileSync(path), { level: 9 }).length : statSync(path).size;

/**
 * Bytes in the unit its row's cap is written in: MB from a 10 MB cap up, KB
 * below it.
 *
 * THE CAP CHOOSES, NOT THE VALUE, and only for a row already known to hold
 * bytes. That is the answer to the argument in `report` below against magnitude
 * heuristics: nothing here guesses what a number measures, so a line count can
 * never print as kilobytes, and a row's value and cap always share one unit
 * however far the value moves. It exists because englishcards' audio row read
 * `97241.9 KB` against `100000 KB`, which that repo's own `budget.json` called
 * ugly and true. It is the only row in the fleet over the threshold.
 */
const size = (n, cap, digits = 1, gz) => `${cap >= 1e7 ? `${(n / 1e6).toFixed(digits)} MB` : `${(n / 1000).toFixed(digits)} KB`}${gz ? " gz" : ""}`;

export function report(rows) {
  let over = 0;
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("");
  for (const r of rows) {
    // A row that is a finding rather than a measurement: no cap, because "1
    // dead pattern against a cap of 0" reads as arithmetic and it is not.
    if (r.finding) {
      over++;
      // Stryker disable next-line StringLiteral: printed wording, which no test should assert
      console.log(`  ✗  ${r.label.padEnd(30)} ${r.shown}`);
      continue;
    }
    if (r.empty) {
      over++;
      // Stryker disable next-line StringLiteral: printed wording, which no test should assert
      console.log(`  ✗  ${r.label.padEnd(30)} ${r.allExcluded
        ? "every file matched is excluded or devkit's — this measures none of your own code"
        : "matched no files — the path or the extension list is wrong"}`);
      continue;
    }
    const bad = r.value > r.cap;
    if (bad) over++;
    // Caps print in the row's own unit. A magnitude heuristic would render a
    // 7,400-line cap as "7 KB", which is how a gate loses its credibility.
    // `size` switches KB to MB only for a byte row, keyed on its cap. A cap
    // that is not a whole unit keeps the decimal the value has: learnxiangqi's
    // bundle printed `108.2 KB gz` against `cap 108 KB gz` while 223 bytes
    // under, and a green row that reads as over teaches people to stop reading.
    // Both sides rounded alike cannot swap order.
    const capShown = r.bytes ? size(r.cap, r.cap, r.cap % (r.cap >= 1e7 ? 1e6 : 1e3) ? 1 : 0, r.gz) : r.cap;
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log(`  ${bad ? "✗" : "✓"}  ${r.label.padEnd(30)} ${r.shown.padEnd(24)} cap ${capShown}`);
  }
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("");
  if (over) {
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log(`  ${over} row${over === 1 ? "" : "s"} red. Over a cap: trade something out, or argue the cap in its own commit. No cap: fix what the row names.\n`);
  }
  return over;
}

// Only runs as a command. Left unguarded, importing this for a test would
// measure whatever directory the test happened to run in and set exitCode —
// a red suite with every test green.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = new URL("..", import.meta.url).pathname;
  const cfg = JSON.parse(readFileSync(join(root, "budget.json"), "utf8"));
  if (report(measure(root, cfg))) process.exitCode = 1;
}
