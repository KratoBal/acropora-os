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
 * ESCAPE HATCH: a line carrying `scan-secrets: allow <reason>` is skipped, so
 * a genuine false positive does not force `--no-verify` on the whole commit.
 *
 * THE REASON IS REQUIRED, AND REQUIRED BY THIS CODE RATHER THAN BY THIS
 * COMMENT. An earlier version asked for it in prose and skipped the line
 * either way. That is the shape we keep finding everywhere: a rule written
 * where it cannot act. Left alone, the first bare `scan-secrets: allow`
 * teaches everyone that the marker alone works, and the hatch quietly becomes
 * a general off-switch - which is the same guard, with the guarding removed.
 *
 * So a bare marker does not skip the line. It is reported as its own finding,
 * because a hatch used without a reason is worth seeing.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const STAGED = process.argv.includes("--staged");

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// `-z` nelkul a git a nem-ASCII utvonalakat idezojelezve, oktalisan
// escape-elve irja ki. Az igy kapott nev a `git show :<fajl>`-nak mar nem
// letezo utvonal, a hibat pedig a `read` elnyeli, tehat az ekezetes nevu
// fajlok tartalma ATVIZSGALATLANUL menne at. A NUL-elvalasztas egyben a
// sortorest tartalmazo neveket is helyben kezeli.
const files = (
  STAGED
    ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    : git(["ls-files", "-z"])
)
  .split("\0")
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

/*
  THE SHAPES FOLLOW THE CI'S TRIVY, NOT LOOSER (card 9ff5f090; OS #2856, 2026-11-25): a test fixture carrying
  `sk_live_` and sixteen characters went through this hook, and the API image's trivy secret scan stopped the PR as
  CRITICAL. This list wanted twenty; trivy's `stripe-secret-token` takes ten to thirty-two, in any case. A local guard
  looser than the authoritative one only moves the refusal to CI, where it costs a run. The shapes below are trivy's
  built-in rules (pkg/fanal/secret/builtin-rules.go, read 2026-11-26) for the providers we use, plus the ones trivy does
  not carry and we hold keys of: OpenAI, Anthropic, Coolify, and Brevo (LOW in trivy, a real key to us).

  Not here, and why: a Stripe PUBLISHABLE key (`pk_`) is public by design; an Expo access token has no fixed prefix, so
  it is caught only by group B (a secret-named key with a high-entropy value).

  EVERY RULE CARRIES ITS SAMPLE (`minta`), built by joining pieces at run time so no key-shaped literal sits in this file
  for trivy or a reader to trip on. `kalibral()` runs before every scan: a rule that no longer catches its own sample
  stops the run, so an edit cannot quietly break a pattern (the calibration the hook and the three CI calls all run).
*/
const darab = (...parts) => parts.join("");
const A_RULES = [
  {
    nev: "PEM privat kulcs",
    re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----[\s\S]{0,40}?([A-Za-z0-9+/=]{40,})/,
    minta: darab("-----BEGIN ", "PRIVATE KEY-----\n", "MIIEv".repeat(10)),
  },
  {
    nev: "GitHub token",
    re: /\b(?:gh[pou]_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9._-]{36,}|ghr_[A-Za-z0-9]{76})\b/,
    minta: darab("gh", "o_", "Ab12".repeat(9)),
  },
  {
    nev: "GitHub fine-grained token",
    re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
    minta: darab("github", "_pat_", "Ab12".repeat(13)),
  },
  {
    nev: "AWS hozzaferesi kulcs",
    re: /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/,
    minta: darab("AS", "IA", "ABCD2345EFGH6789"),
  },
  {
    nev: "Google API kulcs",
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
    minta: darab("AI", "za", "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr7"),
  },
  {
    nev: "Slack token",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    minta: darab("xo", "xb-", "1234567890"),
  },
  {
    nev: "Stripe titkos vagy korlatozott kulcs",
    re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}\b/i,
    // the #2856 shape: sixteen characters, which the old twenty-minimum let through
    minta: darab("sk", "_live_", "Ab12Cd34Ef56Gh78"),
  },
  {
    nev: "Brevo API vagy SMTP kulcs",
    re: /\bx(?:keysib|smtpsib)-[a-f0-9]{64}-[A-Za-z0-9]{16}\b/,
    minta: darab("xkey", "sib-", "0a1b2c3d".repeat(8), "-", "Ab12Cd34Ef56Gh78"),
  },
  {
    nev: "OpenAI API kulcs",
    re: /\bsk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b)/,
    minta: darab("sk", "-proj-", "Ab12Cd34Ef56Gh78Ij90Kl"),
  },
  {
    nev: "Anthropic API kulcs",
    re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}/,
    minta: darab("sk", "-ant-", "api03-", "Ab12Cd34Ef56Gh78Ij90Kl"),
  },
  {
    nev: "Coolify API token",
    // Laravel Sanctum's shape, which Coolify issues: the token's id, a bar, forty characters
    re: /\b\d+\|[A-Za-z0-9]{40}\b/,
    minta: darab("12", "|", "Ab12Cd34Ef".repeat(4)),
  },
];

const PEM = A_RULES[0];

/** Every rule must catch its own sample: a rule that does not is broken, and the run stops before it guards nothing. */
const kalibral = () => {
  const vak = A_RULES.filter(({ re, minta }) => !re.test(minta)).map(
    ({ nev }) => nev,
  );
  if (vak.length > 0) {
    console.error(
      `A titok-kereses mintai elromlottak, nem fognak meg a sajat peldajukat: ${vak.join(", ")}`,
    );
    process.exit(2);
  }
};
kalibral();

const URL_JELSZO = /:\/\/[A-Za-z0-9._%-]+:([^@\s/]{12,})@/;
const B_KULCS =
  /(secret|token|password|passwd|pwd|api[_-]?key|private[_-]?key|credential|access[_-]?key|auth[_-]?key)["']?\s*[:=]\s*["']?([A-Za-z0-9+/=_-]{24,})/i;

const talalatok = [];

for (const file of files) {
  if (file.endsWith("scan-secrets.mjs")) continue; // a sajat mintai
  const content = read(file);
  if (content === null || content.includes("\0")) continue;

  /*
    A PRIVATE KEY SPANS LINES: its header and its body are never on one line, so a per-line test of the PEM rule never
    matched a real key, and the old loop's whole-file test of it stopped every OTHER rule on every line of that file
    (found 2026-11-26 while calibrating card 9ff5f090: a file with a key block reported nothing, not even the key). The
    PEM rule now reads the whole file once, and is reported at the header's line.
  */
  if (PEM.re.test(content)) {
    const sor = content
      .split("\n")
      .findIndex((l) => l.includes("PRIVATE KEY-----"));
    talalatok.push(`${file}:${sor + 1}  ${PEM.nev}`);
  }

  content.split("\n").forEach((line, i) => {
    const hol = `${file}:${i + 1}`;

    const kiut = /scan-secrets: allow(.*)$/.exec(line);
    if (kiut) {
      // Az indok legalabb harom nem-ures karakter. Kevesebb nem indok, hanem
      // a jelolo mellé irt zaj, es ugyanugy altalanos kikapcsolova tenne.
      if (kiut[1].trim().length >= 3) return;
      talalatok.push(
        `${hol}  a kiutat INDOK NELKUL hasznaltak -- a sor nincs kihagyva`,
      );
      return;
    }

    // a key spans lines, so the PEM rule reads the whole file (above); the rest are one-line shapes, each checked on its own
    for (const { nev, re } of A_RULES) {
      if (re === PEM.re) continue;
      if (re.test(line)) {
        talalatok.push(`${hol}  ${nev}`);
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
