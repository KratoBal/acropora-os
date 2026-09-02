#!/usr/bin/env node
/**
 * Refuses content that carries what looks like a live credential.
 *
 * WHY THIS EXISTS, and it is not hypothetical: between 2026-08-25 and 08-26 a
 * real 64-character API key sat in a `.env.example` file in a PUBLIC
 * repository. The key has since been rotated and the old value now returns
 * 401, so it opens nothing - but the value stays in the repository's HISTORY,
 * and the mechanism that put it there is unchanged. A leaked secret cannot be
 * withdrawn; rotating it is damage control, not a fix.
 *
 * WHY NODE AND NOT A `git grep` LINE. The first attempt was a shell pattern
 * list, and it failed the half of the measure that matters: it refused the
 * CLEAN tree. Twelve files, all of them legitimate - the local development
 * connection string `postgresql://acropora:acropora@localhost`, a test fixture
 * whose PEM body is the three letters `abc`, a placeholder reading
 * `replace_with_at_least_32_random_characters`, and the example UUID
 * `550e8400-...`. A marker alone does not make a secret. What separates a real
 * credential from those is the ENTROPY OF THE MATERIAL, and that needs
 * arithmetic, which a grep does not do.
 *
 * ---
 *
 * TWO GROUPS, AND THE SPLIT IS THE DESIGN.
 *
 * Group A - a known marker PLUS enough material behind it. A PEM header with
 * forty or more base64 characters after it; a `ghp_` token at its real length;
 * a URL password that is long and high-entropy. The marker says what it is,
 * the material says it is real.
 *
 * Group B - a secret-NAMED key carrying a high-entropy value. This is the
 * group that would have caught the real incident. It is narrowed three times:
 * the key reads like a secret, the value is at least 24 characters, and its
 * Shannon entropy clears 3.6 bits per character. `replace_with_..._characters`
 * is English and does not clear it; a 64-character hex key does.
 *
 * WHAT THE OTHER REPOSITORY'S SCAN GETS WRONG, recorded because the mistake is
 * the instructive part: it excludes `*.example` and `*.template`. That is
 * exactly the file type the real leak was in. The exclusion had a reason -
 * templates carry placeholder assignments - but the answer to that is group
 * B's entropy test, not skipping the files. A guard blind to the place the
 * incident happened is decoration.
 *
 * ---
 *
 * THE BLIND SPOT, STATED SO A GREEN RUN IS NOT READ AS SAFETY:
 *
 * Group A looks for KNOWN markers. A credential from a provider not on the
 * list is invisible to it, by definition - the list is what we already know.
 * Group B closes part of that gap, but only where the key is NAMED like a
 * secret: a real token assigned to `FOO=` passes both groups.
 *
 * And entropy is a proxy, not a proof. A high-entropy value that is not a
 * secret will be refused (there is an escape hatch below), and a low-entropy
 * secret - a short passphrase - will not be caught at all.
 *
 * This makes the known shapes impossible and leaves the unknown ones exactly
 * as likely as before. It is a floor, not a ceiling.
 *
 * ESCAPE HATCH: a line carrying the marker `scan-secrets: allow` is skipped,
 * so a genuine false positive does not force `--no-verify` on the whole
 * commit. Use it with the reason on the same line.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const STAGED = process.argv.includes("--staged");

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const files = (
  STAGED
    ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    : git(["ls-files"])
)
  .split("\n")
  .filter(Boolean);

const read = (file) => {
  try {
    return STAGED ? git(["show", `:${file}`]) : readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/** Shannon entropy in bits per character. */
const entropy = (value) => {
  const counts = new Map();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let sum = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    sum -= p * Math.log2(p);
  }
  return sum;
};

/** Values that look random to a counter but are not secrets. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER =
  /replace|changeme|change_me|your[_-]|example|placeholder|supersecret|^x+$|^<.*>$|\.\.\./i;

/**
 * Reads as separated words rather than as key material.
 *
 * Entropy alone is not enough, and this is where the second pass of the clean
 * tree said so: `raw-test-token-should-never-be-persisted` scores 3.77 bits,
 * higher than plenty of real keys, purely because it is long and varied. What
 * it is not is RANDOM - it is English, hyphenated. A generated credential does
 * not split into two or more all-alphabetic parts, and these test fixtures
 * always do.
 *
 * The cost of this rule is stated rather than hidden: a real secret that
 * happens to be a hyphenated passphrase passes it. That trade is deliberate -
 * a guard that refuses the clean tree gets turned off, and then it guards
 * nothing at all.
 */
const SZAVAKRA_BOMLIK = (value) => {
  const parts = value.split(/[-_]/);
  return parts.length >= 2 && parts.every((p) => /^[A-Za-z]+$/.test(p));
};

const A_RULES = [
  {
    nev: "PEM privat kulcs",
    re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----[\s\S]{0,40}?([A-Za-z0-9+/=]{40,})/,
  },
  { nev: "GitHub token", re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { nev: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { nev: "AWS hozzaferesi kulcs", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nev: "Google API kulcs", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { nev: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { nev: "Stripe titkos kulcs", re: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
];

const URL_JELSZO = /:\/\/[A-Za-z0-9._%-]+:([^@\s/]{12,})@/;
const B_KULCS =
  /(secret|token|password|passwd|pwd|api[_-]?key|private[_-]?key|credential|access[_-]?key|auth[_-]?key)["']?\s*[:=]\s*["']?([A-Za-z0-9+/=_-]{24,})/i;

const talalatok = [];

for (const file of files) {
  if (file.endsWith("scan-secrets.mjs")) continue; // a sajat mintai
  const content = read(file);
  if (content === null || content.includes("\0")) continue;

  content.split("\n").forEach((line, i) => {
    if (line.includes("scan-secrets: allow")) return;
    const hol = `${file}:${i + 1}`;

    for (const { nev, re } of A_RULES) {
      if (
        re.test(line) ||
        (re.source.includes("PRIVATE KEY") && re.test(content))
      ) {
        if (re.test(line)) talalatok.push(`${hol}  ${nev}`);
        break;
      }
    }

    const url = URL_JELSZO.exec(line);
    if (url && entropy(url[1]) >= 3.2 && !SZAVAKRA_BOMLIK(url[1])) {
      talalatok.push(
        `${hol}  jelszo egy URL-ben (entropia ${entropy(url[1]).toFixed(2)})`,
      );
    }

    const b = B_KULCS.exec(line);
    if (b) {
      const ertek = b[2];
      // KET UT VEZET A TALALATHOZ, es a masodik azert van itt, mert az elso
      // ATENGEDTE A VALODI INCIDENS ALAKJAT.
      //
      // Merve: egy 37 karakteres hex kulcs entropiaja 3.55 bit/karakter. A hex
      // abece 16 jelu, tehat a MAXIMUM 4.0, es egy valodi veletlen hex kulcs
      // 3.5 es 3.7 kozott all - vagyis pont a 3.6-os kuszob KET OLDALAN. Az
      // elso valtozat ezert engedte at azt, amiert az egesz orzo keszult.
      //
      // Ezert a masodik ut nem entropiat mer, hanem ALAKOT: egy titok-nevu
      // kulcs melletti, harminckettonel hosszabb tiszta hex vagy base64 ertek
      // kulcs-anyag, barmennyi is az entropiaja. Angol szoveg soha nem ilyen.
      const ALAK_KULCSANYAG =
        /^[0-9a-fA-F]{32,}$/.test(ertek) ||
        /^[A-Za-z0-9+/]{40,}={0,2}$/.test(ertek);

      if (
        !UUID.test(ertek) &&
        !PLACEHOLDER.test(ertek) &&
        !SZAVAKRA_BOMLIK(ertek) &&
        (entropy(ertek) >= 3.6 || ALAK_KULCSANYAG)
      ) {
        talalatok.push(
          `${hol}  titok-nevu kulcs magas entropiaju ertekkel (${entropy(ertek).toFixed(2)})`,
        );
      }
    }
  });
}

if (talalatok.length > 0) {
  console.error("A tartalom elutasitva: elo hitelesito adat allhat itt.\n");
  for (const t of talalatok) console.error(`  ${t}`);
  console.error(
    "\nEgy kimeno titok VISSZAVONHATATLAN. A lecserelese kar-enyhites, nem javitas.",
  );
  console.error(
    "Ha valodi: NE commitold, es szolj, mielott barmit teszel vele.",
  );
  console.error(
    "Ha teves talalat: tedd a sor vegere a `scan-secrets: allow` jelolot, indokkal.",
  );
  process.exit(1);
}

process.exit(0);
