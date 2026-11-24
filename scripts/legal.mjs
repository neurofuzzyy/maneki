#!/usr/bin/env node
// Assert this repo's licensing and legal surface. `npm run legal`, config in legal.json.
//
// Canonical copy lives in the devkit repo; `npm run sync` there pushes it out
// and `npm run drift` there fails if a repo's copy has diverged. Edit it here,
// not in the repo you happen to be standing in.
//
// This exists because a 2026-08-11 fleet audit found erickwatson.com shipping
// a LICENSE that assigned copyright to an unrelated third party, scd — the
// most valuable asset in the portfolio — published under MIT, which permits a
// competitor to sell it and owe nothing, and the owner's personal address in the
// footer of every diagnostic email the worker sends. None of these were
// visible to any gate. Legal surface rots exactly like code, but silently:
// nothing 404s, nothing goes red, and the damage is discovered by a lawyer.
//
// Five claims. Four are the ones a 2026-08-11 audit found actually wrong;
// `fonts` is the fifth, added 2026-08-18 for a rule scd could state and could
// not enforce, because the file that enforces it is delivered from here:
//   licence  — the LICENSE file and the package.json field agree with the
//              fleet's chosen model, and the copyright names the right owner.
//   pages    — a privacy policy and terms exist, in every language shipped.
//   contact  — no individually identifiable address appears in anything that
//              ships. Role addresses only.
//   markers  — the policies actually say the things that make them policies:
//              a contact route, a governing owner, an effective date.
//   fonts    — a self-hosted font travels with the licence text its licence
//              requires, because a woff2 subset is a copy and every font in
//              the fleet is somebody else's work.
//
// THE `markers` CLAIM WAS PROSE UNTIL 2026-08-20 AND THE LIST ABOVE SAID
// OTHERWISE, which is the failure `conventions.md` names as worse than
// silence: a comment claiming a property the code does not have is what makes
// the next person stop checking. All the code did was compare each page
// against its own `contains` list, and every legal.json in the fleet left that
// list empty — so the sum of what this gate asserted about twenty-four
// published privacy policies and terms pages was that the files existed. A
// policy emptied to a stub went green. Deriving the three markers rather than
// hand-listing them is the same coupling argument `store.mjs` is built on:
// strings written into `contains` protect the pages somebody remembered.
//
// The fonts claim proves a licence file is present and named for the family it
// covers. It cannot read a woff2's own metadata and confirm the two are the
// same licence — scd's five subsets carry no name table at all, which is why
// a separate text file is the only thing that can satisfy OFL 2 there.
//
// What this deliberately does NOT do is read the policies for legal adequacy.
// A gate can prove a privacy policy exists, names a contact and mentions the
// analytics vendor it is supposed to disclose. It cannot prove the document is
// lawful in a given jurisdiction, and pretending otherwise would be worse than
// having no gate, because green would read as cleared.

import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/** Addresses a product is allowed to publish: a role, never a person. */
const ROLE_LOCALPARTS = [
  "privacy", "legal", "support", "info", "hello", "contact", "help",
  "security", "abuse", "noreply", "no-reply", "billing", "press", "sales",
  "team", "admin", "careers", "dmca",
];

/**
 * Is this address safe to publish?
 *
 * The rule is a role allowlist rather than a person denylist, because the
 * failure being prevented is a *new* personal address appearing, and a
 * denylist only ever knows about the ones already found. `erick@` was in four
 * files before anyone looked; `erick.watson@`, `e.watson@` and `ewatson@`
 * would each have been a fresh miss.
 */
export function isRoleAddress(email) {
  const local = String(email).split("@")[0].toLowerCase();
  return ROLE_LOCALPARTS.includes(local);
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

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Whether `text` carries any address at `domain`.
 *
 * Built from `EMAIL` for the reason its own comment gives — one fact about what
 * an address is — and then compared on the host rather than by substring,
 * because `privacy@notlearnxiangqi.com` contains `learnxiangqi.com` and is a
 * different mailbox at a different registrar. A subdomain counts: mail for
 * `privacy@mail.example.com` is example.com's to route.
 */
function addressAt(text, domain) {
  const want = String(domain).toLowerCase();
  for (const a of text.match(EMAIL) ?? []) {
    const host = a.slice(a.lastIndexOf("@") + 1).toLowerCase();
    if (host === want || host.endsWith("." + want)) return true;
  }
  return false;
}

const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i;

/**
 * A route the reader can use to exercise a right, in writing.
 *
 * A profile link is deliberately not one. erickwatson-com's privacy policy
 * ends with a Contact heading offering a name, a website and a LinkedIn — a
 * way to find somebody, not a channel to send a deletion request down and have
 * a record of having sent it. That page is the reason this is a channel test
 * rather than a heading test: `## Contact` is present there and satisfies
 * nothing.
 *
 * BUILT FROM `EMAIL` RATHER THAN BESIDE IT. Written out longhand on 2026-08-20
 * this was the same address pattern a second time, differing only by the
 * alternation and the missing `g` — two regexes that must agree about what an
 * address is, kept in step by whoever notices. `.source` makes them one fact.
 * The flag is the reason this cannot simply reuse the object: `EMAIL` is global
 * and carries `lastIndex`, so a `.test()` against it would answer differently
 * on alternate calls.
 */
const CONTACT = new RegExp(`mailto:|${EMAIL.source}`);

/**
 * A policy dating itself: the label, then a year or a template's slot.
 *
 * The year is what stops the Changes section passing on its own — every
 * policy in the fleet ends by promising to move the effective date, and
 * learnxiangqi's Chinese copy says 生效日期 there without a date beside it.
 * `{{EFFECTIVE_DATE}}` is admitted because the four templates here are
 * published documents in their own right and carry the slot, not the date.
 *
 * Both label sets are needed and neither is a translation of the other:
 * chainlodge dates its Chinese pages 最近更新 and its English ones "Last
 * updated", and a fleet gate that knew only the words devkit's own templates
 * use would have failed four correct pages.
 */
const EFFECTIVE = /(?:effective|last updated|生效日期|更新日期|最近更新)[^\n<]{0,40}?(?:\d{4}|\{\{[A-Z_]+\}\})/i;

/**
 * The slot a template carries where a rendered page carries the operator.
 *
 * Admitted for the same reason `EFFECTIVE` admits `{{EFFECTIVE_DATE}}`, and
 * the alternative is worse in a way worth writing down. devkit's four
 * templates named Erick Watson outright until 2026-08-21, which is where
 * englishcards got the wrong legal person in good faith: six repos declare
 * SproutVest, LLC as `entity` and rendered a document saying otherwise. The
 * fix is a placeholder, and a placeholder cannot match a `legal.json` string —
 * so without this the four canonical templates would have to `omit: ["owner"]`
 * and the gate would stop asserting they name an operator at all, in exactly
 * the files that syndicate the sentence to the fleet.
 *
 * WHAT IT LETS THROUGH is a rendered page shipping the literal `{{OPERATOR}}`
 * because its build never substituted it. That is the same exposure the
 * effective-date slot already accepts, and it is the visible kind: a reader
 * sees the braces, where a page quietly naming the wrong company reads fine.
 */
const OPERATOR_SLOT = "{{OPERATOR}}";

/**
 * The four markers, keyed for `omit` and worded for the row.
 *
 * Not exported, unlike every other pure function here, and the asymmetry is the
 * point: the ones this file exports are the ones `tests/legal.test.mjs` imports
 * and drives directly. These two are reached through `audit()` because that is
 * where the `omit` filtering and the row wording live, and an export nobody
 * imports is a promise about a boundary nobody asked for.
 */
const MARKERS = {
  contact: "a contact route",
  owner: "an operator",
  effective: "an effective date",
  domain: "a contact at its own domain",
};

/**
 * Which of the four a page does not carry.
 *
 * READ TWICE, RAW AND WITH THE MARKUP TAKEN OUT, because a label and its value
 * sit either side of a tag as often as they sit inside one and neither reading
 * finds both. sproutvest writes `<strong>Effective date:</strong> March 18,
 * 2026`, where the tag falls between them; chainlodge passes the whole string
 * as an attribute — `lastUpdated="Last updated: February 2025"` — where
 * stripping tags deletes the evidence along with the markup. Two cheap reads
 * beat one parser that would have to be right about Astro, Nunjucks, Markdown
 * and raw HTML.
 *
 * WHAT IT CANNOT SEE is a marker the page inherits rather than states. These
 * are declared file paths, and an Astro page assembled from a layout can carry
 * its operator in the layout, where this will not look and will report its
 * absence. That is the safe direction — a false red gets read — but it means a
 * repo may owe an `omit` with the argument written beside it rather than a
 * change to the page.
 *
 * AND IT CANNOT TELL THAT AN OPERATOR IS THE WRONG LEGAL PERSON. It compares a
 * page against a string in `legal.json`; whether that string names the party
 * actually answerable for the data is a question no gate reaches.
 * englishcards demonstrated the whole sequence on 2026-08-20, the day this
 * landed: it shipped Chinese policies naming Erick Watson as operator — taken
 * in good faith from the template beside this file, which says exactly that —
 * and every gate passed for a full review loop. A human asked the owner, the
 * answer was SproutVest, LLC, the pages were corrected, and only THEN did this
 * go red, because the pages and the config had come to disagree. Green while
 * wrong, red once half-fixed. What it buys is agreement between two places,
 * which is worth a gate; being right is upstream of it and is not.
 *
 * THE FALLBACK IS THE SHARP EDGE OF THAT. `entity ?? license.owner` is what
 * lets a repo the owner runs personally say nothing and be correct, and it is
 * also why englishcards had no `entity` for as long as it had no pages worth
 * checking: nothing ever asked. A repo whose operator and copyright holder are
 * the same person cannot discover the field is missing, because the fallback
 * answers correctly for the wrong reason. The day those two part company is
 * the day it matters, and that day arrives without a red row.
 */
function missingMarkers(text, operator, domain) {
  const stripped = text.replace(/<[^>]*>/g, " ");
  const has = (re) => re.test(text) || re.test(stripped);
  const missing = [];
  if (!has(CONTACT)) missing.push("contact");
  // A SEPARATE MARKER FROM `contact` RATHER THAN A STRICTER VERSION OF IT, so
  // the two failures read differently: a policy with no contact route at all is
  // a document nobody can reply to, and a policy routing its readers to another
  // site's mailbox is one that works until that domain changes hands. Only the
  // second is what `omit` should ever be able to wave through.
  //
  // Checked only where `legal.json` says `domain`, because the fleet holds two
  // kinds of repo that have no domain to be at fault about: devkit, whose four
  // pages are templates rather than a published policy, and learning-engine,
  // whose only declared page is the COMMERCIAL.md every repo receives. Both
  // would otherwise fail for naming the licensing mailbox, which is the one
  // address that is correct portfolio-wide.
  // ONE READING, NOT TWO, unlike every marker around it. Stripping replaces a
  // tag with a SPACE and an address cannot span one, so the stripped read is
  // incapable of finding a host the raw read missed — it can only lose the
  // `mailto:` in an `href`. Checked across the fleet's 90 published legal
  // documents before the second call was removed: 0 where it added anything.
  if (domain && !addressAt(text, domain)) missing.push("domain");
  // No operator declared anywhere is a miss rather than a skip: `legal.json`
  // going quiet is the cheapest possible way to make this row green.
  const names = (s) => text.includes(s) || stripped.includes(s);
  if (!operator || !(names(operator) || names(OPERATOR_SLOT))) missing.push("owner");
  if (!has(EFFECTIVE)) missing.push("effective");
  return missing;
}

/** The names a licence file carries before any family suffix. */
const LICENCE_NAME = /^(?:licen[cs]es?|copying|arphicpl|apache|ofl|ufl|mit)(?:[-_. ]+|$)/i;

/** Lowercase alphanumerics only, so `Space-Grotesk` and `spacegrotesk` agree. */
const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The font family a licence file covers, or null if it is not a licence file.
 *
 * `OFL-Rajdhani.txt` covers `rajdhani`. A bare `OFL.txt` or `ARPHICPL.txt`
 * strips to the empty string, which covers every font in its directory — that
 * is what upstream means by shipping one, and both readings are in the fleet
 * today: scd names its two files after their families, LearnMandarin ships one
 * of each. The names strip repeatedly so `MIT-LICENSE.txt` also reaches empty.
 *
 * The separator after the name is why `Mitr.txt` — a real Google family — is
 * not read as a `mit` licence covering everything that begins with `r`.
 */
export function licenceFamily(stem) {
  let rest = stem;
  let matched = false;
  for (let m; (m = LICENCE_NAME.exec(rest)); rest = rest.slice(m[0].length)) matched = true;
  return matched ? normalise(rest) : null;
}

/**
 * Credentials, by the shape their issuer gave them.
 *
 * Vendor-specific prefixes only, deliberately. The tempting alternative is an
 * entropy heuristic that flags any long random-looking string, which in a repo
 * full of content hashes, base64 images and minified bundles cries wolf until
 * someone adds `--no-verify` to their muscle memory. A gate that is ignored is
 * worse than absent, because it still reads as coverage. High precision beats
 * high recall for anything that blocks a commit.
 *
 * A live key committed to a private repo is still a live key: it is in the
 * clone on every machine, in every backup, and in the history forever after.
 *
 * This is the fleet's only committed-secret scanner. GitHub's secret scanning
 * is not offered on private repositories owned by a personal account, which is
 * every repo here, so nothing else reads for a key before it ships. Until
 * 2026-09-27 the list had no row for three of the credentials the fleet
 * actually holds — Cloudflare, Sentry and GitHub's fine-grained tokens — while
 * it carried Slack and AWS, which no repo uses.
 *
 * WHAT THIS CANNOT SEE, and it is most of the ways a key actually leaks:
 *
 * - Anything outside `contact.dirs` and `contact.ext`. It reads shippable
 *   files only, so a `.env`, `.dev.vars`, `wrangler.toml` or workflow `.yml`
 *   is never opened, and neither is git history. Those are guarded by
 *   `.gitignore`, which is a habit rather than a gate.
 * - A Cloudflare token issued before 2026, which has no prefix: 40 characters
 *   of alphanumerics that are indistinguishable from a hash. It is matched only
 *   when assigned to a name that says what it is — `cloudflare`, `CF_` or
 *   `api_token` — and never when it is 40 lowercase hex, the shape of a git
 *   SHA. An unprefixed token in `const t = "…"` is invisible, by design.
 * - Every vendor not listed. A new provider's key is found the day somebody
 *   adds its row, and `tests/legal.test.mjs` will not let a row land without a
 *   sample.
 */
export const SECRET_PATTERNS = [
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  // Classic, OAuth, user, server and refresh tokens, then the fine-grained
  // PAT: 22 and 59 around a separator, exact so `github_path` and friends
  // never reach the second underscore.
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59})\b/],
  // User, account and Global API Key, each 40 characters then a checksum
  // (developers.cloudflare.com/fundamentals/api/get-started/token-formats).
  ["Cloudflare token", /\bcf(?:ut|at|k)_[A-Za-z0-9]{40,}\b/],
  // The pre-2026 form, found only by the name it is assigned to — see above.
  // The lookahead refuses 40 hex so `CF_PAGES_COMMIT_SHA = "<sha>"` is not one.
  ["Cloudflare token (by name)", /(?:cloudflare|(?<![a-z0-9])cf_|api_?token)[\w.-]{0,40}["'`]?[ \t]*[:=][ \t]*["'`]?(?![0-9a-f]{40}(?![\w-]))[a-z0-9_-]{40}(?![\w-])/i],
  // Org tokens carry a base64 payload, `=` padding and an `_` separator, so
  // there is no trailing `\b` to lean on; user tokens are 64 hex.
  ["Sentry token", /\bsntry(?:s_[A-Za-z0-9+/=_]{40,}|u_[a-f0-9]{64}\b)/],
  ["Stripe live key", /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/],
  ["Slack token", /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["OpenAI key", /\bsk-proj-[A-Za-z0-9_-]{20,}\b/],
  // Base58, 8 then 24. It was `{8,}_{16,}` of any alphanumeric until
  // 2026-09-27, which `re_rendered_componentInstances` satisfies; base58 has
  // no `I`, `O`, `l` or `0`, and the exact lengths do the rest.
  ["Resend key", /\bre_[1-9A-HJ-NP-Za-km-z]{8}_[1-9A-HJ-NP-Za-km-z]{24}\b/],
  ["Private key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
];

/**
 * Credential-shaped strings in text. Returns [label, redacted] pairs.
 *
 * Never echo the credential. A gate that prints the secret it found relocates
 * it into CI logs, which are retained longer and read wider than the file it
 * came from. The by-name Cloudflare row starts its match at the name, so its
 * seven characters are the variable's — only a name as short as `cf_` shows
 * any of the token, and then fewer characters than every other row shows.
 */
export const secrets = (source) => SECRET_PATTERNS
  .map(([label, re]) => [label, source.match(re)?.[0]])
  .filter(([, m]) => m).map(([label, m]) => [label, `${m.slice(0, 7)}…`]);

/**
 * Personal addresses in text, ignoring the obviously fictional.
 *
 * example.com and friends are reserved by RFC 2606 precisely so documentation
 * and fixtures can use them. Flagging those would train everyone to ignore the
 * row, which is how a gate dies.
 */
export function personalAddresses(source) {
  const found = new Set();
  for (const m of source.match(EMAIL) ?? []) {
    const domain = m.split("@")[1].toLowerCase();
    // RFC 2606 reserves these two ways: as second-level names (example.com)
    // and as whole TLDs (anything.test). Matching only the first form let
    // `you@company.test` through, which is how a fixture becomes a finding.
    if (/^(example|test|invalid|localhost)$/.test(domain.split(".").pop())) continue;
    if (/^example\.(com|org|net)$/.test(domain)) continue;
    if (/\.(png|jpg|jpeg|webp|svg|woff2?|ttf)$/i.test(m)) continue;
    if (!isRoleAddress(m)) found.add(m);
  }
  return [...found];
}

/**
 * What a Cargo manifest means by `license.workspace = true`: the answer lives
 * in the workspace root, which is itself a tracked manifest and checked there.
 * A sentinel rather than `null`, because "inherited" and "absent" are opposite
 * findings and collapsing them would let a crate declare nothing and pass.
 */
const WORKSPACE = Symbol("workspace-inherited");

/**
 * The licence a manifest declares, or null if it declares none.
 *
 * TOML is read with a regex rather than parsed, and that is a real limit worth
 * naming: it finds `license = "X"` at the start of a line, so a licence given
 * as a `{ workspace = true }` inline table, or inside a `[target.*]` block that
 * happens to precede `[package]`, is not understood. Every Cargo manifest in
 * the fleet uses one of the two plain forms. A third form arriving should add
 * a parser, not a third regex.
 */
export function declaredLicence(file, text) {
  if (file.endsWith("package.json")) return JSON.parse(text).license ?? null;
  if (/^\s*license\.workspace\s*=\s*true/m.test(text)) return WORKSPACE;
  return text.match(/^\s*license\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

/**
 * Every manifest this repo tracks — `package.json` and `Cargo.toml`, at any
 * depth.
 *
 * ENUMERATED FROM GIT, NOT BY WALKING, and that is what lets this row exist
 * without a deny-list. A walk would have to know that `node_modules`, `dist`,
 * `.stryker-tmp`, a wasm-pack `pkg/` and scd's untracked `.ds-sync/` are not
 * source — five names today and whatever arrives next — and `conventions.md`
 * argues that a sweep adopting new files without anyone deciding is the
 * failure rather than the convenience. `.gitignore` is where a repo already
 * says what is not its source, and it is maintained for other reasons, so it
 * is maintained.
 *
 * WHAT IT CANNOT SEE is the working tree: this reads the INDEX, so a manifest
 * written and never `git add`ed is invisible until something stages it. scd's
 * copyright gate had the same shape and produced a green local run against a
 * red CI run for the same tree. The direction is the safe one — a file becomes
 * visible when it becomes part of the repo — but a green row here is a claim
 * about what is tracked, never about what is on disk.
 */
function trackedManifests(root) {
  const args = ["-C", root, "ls-files", "-z", "--", "*package.json", "*Cargo.toml"];
  try {
    const out = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    // Tracked and on disk. The index still lists a file deleted but not yet
    // committed, and reading it would crash the gate for the one reason it is
    // not about — a licence check should not be the thing that notices a
    // half-finished `git rm`.
    return out.split("\0").filter((f) => f && existsSync(join(root, f)));
  } catch {
    return null;
  }
}

/** Check every configured claim. Returns rows; does not print or exit. */
export function audit(root, cfg) {
  const rows = [];
  const read = (f) => readFileSync(join(root, f), "utf8");
  const ok = (label, detail) => rows.push({ label, ok: true, detail });
  const bad = (label, detail) => rows.push({ label, ok: false, detail });

  // --- licence -------------------------------------------------------------
  if (cfg.license) {
    const { spdx, file = "LICENSE", owner } = cfg.license;
    if (!existsSync(join(root, file))) {
      bad("LICENSE file", `missing — expected ${file}`);
    } else {
      const text = read(file);
      // The owner check is the one that would have caught erickwatson.com:
      // the file was a valid MIT licence, correctly formatted, granting rights
      // over this repo on behalf of someone who has never seen it.
      if (owner && !text.includes(owner)) {
        bad("LICENSE file", `does not name ${JSON.stringify(owner)} as copyright holder`);
      } else if (cfg.license.contains && !cfg.license.contains.every((n) => text.includes(n))) {
        const missing = cfg.license.contains.filter((n) => !text.includes(n));
        bad("LICENSE file", `missing ${missing.map((m) => JSON.stringify(m)).join(", ")}`);
      } else {
        ok("LICENSE file", `${file}, © ${owner ?? "unchecked"}`);
      }
    }

    // A LICENSE file and a manifest field that disagree is worse than either
    // alone: tooling reads the field, humans read the file, and the two
    // audiences walk away with different rights.
    //
    // EVERY TRACKED MANIFEST, NOT THE ROOT ONE. This read exactly one path —
    // `join(root, "package.json")` — until 2026-09-16, and scd is what that
    // cost: its Cargo workspace and its client package both declared MIT for
    // five weeks while this row printed green, and the crates inheriting that
    // MIT are the deterministic simulation the repo exists for. This file's
    // own header says it was written because scd had been published under MIT.
    // It was, and then it went on being, one directory below where anyone had
    // thought to look.
    // `null` and `[]` are different answers and get different rows. No
    // manifests is nothing to ask about — the old `existsSync` guard's
    // decision, kept. No git is an inability to ask, and a gate that cannot
    // run its own check says so rather than printing the green that a reader
    // would take for a clean sweep.
    const found = spdx ? trackedManifests(root) : [];
    if (found === null) {
      bad("Manifest licences", "not a git checkout — cannot enumerate manifests");
    } else if (found.length) {
      const wrong = found.filter((f) => ![spdx, WORKSPACE].includes(declaredLicence(f, read(f))));
      if (wrong.length) bad("Manifest licences", `${wrong.length} of ${found.length}: ${wrong.join(", ")}`);
      else ok("Manifest licences", `${found.length} agree on ${spdx}`);
    }
  }

  // --- pages ---------------------------------------------------------------
  // Bilingual repos ship both languages or neither. A privacy policy that
  // exists only in English on a site serving Chinese is not a lesser version
  // of compliance, it is the absence of it for those users.
  //
  // Existence was the whole claim until 2026-08-20. The markers below are what
  // make the row about the document rather than about the file — `omit` is the
  // escape, and it is the shape `store.json`'s `disclose` entries already use:
  // a page states which markers it does not owe, beside the argument for why.
  // COMMERCIAL.md is the case it exists for and the only one so far. It is a
  // licence offer rather than a policy governing a reader, so it dates nothing
  // and names no operator, and it is declared here because the contact route
  // in it is worth holding.
  const operator = cfg.entity ?? cfg.license?.owner;
  for (const page of cfg.pages ?? []) {
    if (!existsSync(join(root, page.path))) {
      bad(page.label ?? page.path, "missing");
      continue;
    }
    const text = read(page.path);
    const missing = (page.contains ?? []).filter((n) => !text.includes(n));
    const omit = page.omit ?? [];
    const silent = missingMarkers(text, operator, cfg.domain).filter((m) => !omit.includes(m));
    if (missing.length) {
      bad(page.label ?? page.path, `present but missing ${missing.map((m) => JSON.stringify(m)).join(", ")}`);
    } else if (silent.length) {
      bad(page.label ?? page.path, `present but names ${silent.map((m) => MARKERS[m]).join(" or ")} nowhere`);
    } else {
      // The declined markers are in the row rather than in the config alone,
      // because an `omit` nobody sees is how a page opts out of the claim and
      // still reads as having passed it.
      // THE DOMAIN IS NAMED IN THE PASSING ROW, not just the failing one,
      // because without it a repo that checked its contact domain and a repo
      // that declares none print the same green sentence — and the second is
      // the state worth being able to see from the output alone.
      const at = cfg.domain ? ` at ${cfg.domain}` : "";
      ok(page.label ?? page.path, omit.length ? `present; ${omit.length} marker${omit.length === 1 ? "" : "s"} declined — ${omit.join(", ")}` : `present, dated, and names an operator and a contact${at}`);
    }
  }

  // --- contact -------------------------------------------------------------
  if (cfg.contact) {
    const exclude = (cfg.contact.exclude ?? []).map((r) => new RegExp(r));
    const ext = cfg.contact.ext ?? [".astro", ".html", ".njk", ".ts", ".tsx", ".js", ".jsx", ".md", ".json"];
    const candidates = (cfg.contact.dirs ?? [])
      .flatMap((d) => walk(root, d))
      .filter((f) => ext.some((e) => f.endsWith(e)));
    // A pattern is live when it removes at least one file this scan would
    // otherwise read — `budget.mjs`'s test, and the one this row's name always
    // claimed. Until 2026-09-21 it checked only for a literal backslash, the
    // JSON slip where `"\\\\.test\\\\."` parses to a regex wanting a backslash
    // where the author wrote a dot. Seven of ten legal.json files carried that
    // on 2026-08-18. The narrower check then passed a different dead pattern
    // 44 times out of 49: one five-line block, pasted into every repo, guarding
    // against test files that never arrived in the scanned dirs, and green as
    // "5 patterns" everywhere. The backslash case is still caught, as one
    // instance of the general rule.
    //
    // WHAT THIS CANNOT SEE is a pattern that is live and too wide. It proves
    // each exclusion removes something, never that it removes only what it
    // should: `/src/` would pass and exempt everything.
    const dead = (cfg.contact.exclude ?? []).filter((_, i) => !candidates.some((f) => exclude[i].test(f)));
    const files = candidates.filter((f) => !exclude.some((r) => r.test(f)));
    const hits = [];
    const leaked = [];
    for (const f of files) {
      const text = read(f);
      for (const addr of personalAddresses(text)) hits.push(`${addr} in ${f}`);
      for (const [label, redacted] of secrets(text)) leaked.push(`${label} ${redacted} in ${f}`);
    }

    // Reported as its own row rather than folded into the address row. They
    // fail for different reasons and want different reactions: a personal
    // address is an edit, a committed credential is a rotation — the key is
    // already compromised and deleting the line does not un-compromise it.
    if (leaked.length) {
      bad("No committed secrets", `${leaked.length} found — ${leaked.slice(0, 2).join("; ")}${leaked.length > 2 ? " …" : ""}. Rotate them, then remove.`);
    } else {
      ok("No committed secrets", `${files.length} shippable files scanned`);
    }

    // Its own row rather than a note on the scan count, because the count
    // cannot show it: a dead pattern leaves the number higher, and higher is
    // what a widening exclusion looks like when it is working.
    if (dead.length) bad("Exclusions are live", `${dead.length} match no path — ${dead.map((d) => JSON.stringify(d)).join(", ")}`);
    else if (exclude.length) ok("Exclusions are live", `${exclude.length} pattern${exclude.length === 1 ? "" : "s"}`);

    if (hits.length) {
      // Capped because the first three tell you what to fix and a wall of
      // sixty tells you to stop reading.
      const shown = hits.slice(0, 3).join("; ");
      bad("No personal addresses", `${hits.length} found — ${shown}${hits.length > 3 ? " …" : ""}`);
    } else {
      ok("No personal addresses", `${files.length} shippable files scanned`);
    }
  }

  // --- fonts ---------------------------------------------------------------
  // A self-hosted font is a redistribution. scd served five OFL faces for
  // months with no notice anywhere, fixed it, and guarded the fix with a CSS
  // comment saying "do not remove them when pruning" — prose, which is the
  // shape store.mjs exists to argue against.
  for (const dir of cfg.fonts?.dirs ?? []) {
    const label = `Font licences (${dir})`;
    // Grouped by the directory each file actually sits in, not flattened: a
    // licence covers what is beside it, and a font one level down that the
    // gate silently ignored would be the failure this claim is about.
    const groups = new Map();
    for (const rel of walk(root, dir)) {
      const at = rel.lastIndexOf("/");
      const name = rel.slice(at + 1);
      const group = groups.get(rel.slice(0, at)) ?? { fonts: [], covers: [] };
      const stem = name.replace(/\.[^.]+$/, "");
      if (FONT_FILE.test(name)) group.fonts.push([name, normalise(stem)]);
      else if (licenceFamily(stem) !== null) group.covers.push(licenceFamily(stem));
      groups.set(rel.slice(0, at), group);
    }
    const all = [...groups.values()];
    const fonts = all.flatMap((g) => g.fonts);
    // `startsWith`, so a hypothetical `notspacegrotesk` cannot pass on the
    // strength of `OFL-SpaceGrotesk.txt`.
    const bare = all.flatMap(({ fonts: f, covers }) =>
      f.filter(([, s]) => !covers.some((c) => s.startsWith(c))).map(([n]) => n));
    const wide = all.filter((g) => g.covers.includes("")).length;
    // A declared directory with no fonts is the cheapest possible green row,
    // so it fails — the rule store.mjs applies to a capability declared with
    // nothing disclosed.
    if (!fonts.length) {
      bad(label, "declared, but holds no font files");
    } else if (bare.length) {
      bad(label, `${bare.length} of ${fonts.length} ship with no licence text — ${bare.slice(0, 3).join(", ")}${bare.length > 3 ? " …" : ""}`);
    } else {
      // The gap is in the row rather than in a comment, because a
      // directory-wide licence is exactly the case a green row overstates.
      ok(label, `${fonts.length} covered${wide ? `; ${wide} dir-wide, blind to a new family added bare` : ""}`);
    }
  }

  // A DECLARED DIRECTORY IS A PLACE TO LOOK, NOT A CLAIM THAT IT IS THE ONLY
  // ONE. The loop above only ever visits what `fonts.dirs` names, so until
  // 2026-08-20 the claim was opt-in on a fact that is not a decision: `ads` is
  // a product choice a repo makes and can honestly not make, while a woff2
  // arriving in a shipped directory is somebody else's work already being
  // redistributed whether or not anyone wrote it down. Seven of the fleet's
  // repos declare no `fonts` block and are right to, having none; not one of
  // them would have been asked anything on the day that changed.
  //
  // BOUNDED BY `contact.dirs`, WHICH IS THE GAP AND NOT AN OVERSIGHT. That
  // list is the repo's own answer to "what ships", so this asks about exactly
  // the fonts a visitor could download, and a font somewhere the repo does not
  // call shippable is invisible here. LearnMandarin's `assets/fonts` is that
  // case from the other side: a subsetting input, outside `contact.dirs`,
  // declared anyway because the copy in it is a redistribution too. A declared
  // dir may exceed what this sweeps; it may not fall short of it.
  if (cfg.contact?.dirs) {
    const declared = cfg.fonts?.dirs ?? [];
    const loose = cfg.contact.dirs
      .flatMap((d) => walk(root, d))
      .filter((f) => FONT_FILE.test(f))
      .filter((f) => !declared.some((d) => f.startsWith(`${d}/`)));
    if (loose.length) {
      bad("Fonts all declared", `${loose.length} outside \`fonts.dirs\` — ${loose.slice(0, 3).join(", ")}${loose.length > 3 ? " …" : ""}`);
    } else {
      ok("Fonts all declared", `${cfg.contact.dirs.length} shipped dir${cfg.contact.dirs.length === 1 ? "" : "s"} swept; blind to fonts outside them`);
    }
  }

  return rows;
}

export function report(rows) {
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("");
  let failed = 0;
  for (const r of rows) {
    if (!r.ok) failed++;
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log(`  ${r.ok ? "✓" : "✗"}  ${r.label.padEnd(30)} ${r.detail}`);
  }
  // Stryker disable next-line StringLiteral: printed wording, which no test should assert
  console.log("");
  // An empty config is the failure mode this gate is most likely to die of:
  // someone adds legal.json, fills in nothing, and every repo goes green.
  if (!rows.length) {
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log("  legal.json asserted nothing — that is a broken gate, not a pass.\n");
    return 1;
  }
  if (failed) {
    // Stryker disable next-line StringLiteral: printed wording, which no test should assert
    console.log(`  ${failed} legal check${failed === 1 ? "" : "s"} failed. Green here means consistent, never means lawful.\n`);
  }
  return failed;
}

// Only runs as a command. Left unguarded, importing this for a test would
// audit whatever directory the test happened to run in and set exitCode —
// a red suite with every test green.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = new URL("..", import.meta.url).pathname;
  const cfg = JSON.parse(readFileSync(join(root, "legal.json"), "utf8"));
  if (report(audit(root, cfg))) process.exitCode = 1;
}
