#!/usr/bin/env python3
"""Exports the r11 redactor's DATA from the Python reference into TypeScript, and
the reference OUTPUTS into test vectors. The TypeScript side (src/redact.ts) ports
only the program logic; every pattern string and word list comes from here, read
out of the loaded Python module, so a hand copy cannot drift.

The reference: marveen scripts/jev/redact.py (r11). Any change on either side
means running this again and the parity check (README, "Kitakaras").

Usage:
  python3 -B packages/jev/scripts/redact-r11-export.py <marveen>/scripts/jev

Writes:
  packages/jev/src/redact-r11-data.ts        patterns, word sets, constants
  packages/jev/redact-vectors/r11-expected.json
      the reference output for every leak-suite case (default and pairing
      mode, runtime guard), with the suite common-words subset, plus the
      synthetic known-entity cases.
  packages/jev/redact-vectors/leak-suite.json, leak-suite-pairing.json
      the two suites, copied byte for byte.
"""
import hashlib
import json
import os
import shutil
import sys
import tempfile

JEV = os.path.abspath(sys.argv[1])
HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
VEC = os.path.join(PKG, "redact-vectors")

# The real common-words file is derived from internal text and never enters the
# repo. The vectors use only the subset the suites actually look up (see below).
os.environ["JEV_COMMON_WORDS"] = os.environ.get("JEV_COMMON_WORDS", "/home/marveen/marveen/store/jev-common-words.txt")
os.environ["JEV_KNOWN_ENTITIES"] = os.path.join(tempfile.mkdtemp(), "none.json")
sys.path.insert(0, JEV)
import build_known  # noqa: E402
import leak_gate  # noqa: E402
import offline  # noqa: E402
import redact  # noqa: E402
import shadow  # noqa: E402

if not redact.COMMON:
    sys.exit("the common-words file is missing: the vectors would not be the measured r11")


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def ts(value):
    return json.dumps(value, ensure_ascii=False)


# ------------------------------------------------------------ data
P = [[k, rx.pattern] for k, rx in redact._P]
INLINE = {
    # the regexes _find_spans and its helpers build inline, assembled exactly as there
    "singleCap": r"(?<![\w-])" + redact.UP + redact.L + r"+(?:-" + redact.UP + redact.L + r"+)?(?![\w])",
    "afterWord": r"[ \t]+([^\W\d_][\w']*)",
    "identifier": r"[^\W\d_]{2,}(?:[_.][^\W\d_]{2,})+",
    "letters": r"[^\W\d_]+",
    "social": r"(?:facebook|instagram|linkedin|tiktok)\.com/$",
    "lowerName": r"(?<![^\W_])" + redact.LO + r"{3,}(?![^\W_])",
    "nonSpace": r"\S+",
    "alnum": r"[^\W_]+",
    "spaces": r"\s+",
    "halfPlaceholder": r"<[A-Z_]*\d*$",
    # build_known.aliases, assembled exactly as there
    "aliasParen": r"\(([^)]{2,40})\)",
    "aliasCaps": r"\b[A-ZÁÉÍÓÖŐÚÜŰ]{3,}\b",
}
OTHER = {
    "formInHit": redact._FORM_IN_HIT.pattern,
    "formAfterHit": redact._FORM_AFTER_HIT.pattern,
    "soleTrader": redact._SOLE_TRADER.pattern,
    "companyFormEnd": redact._COMPANY_FORM_END.pattern,
    "token": redact._TOKEN.pattern,
    "council": redact._COUNCIL.pattern,
    "offlineCompany": offline._COMPANY.pattern,
    "knownForm": build_known._FORM.pattern,
}
assert all("(?i)" not in v or v.startswith("(?i)") for v in OTHER.values())

ref = os.path.join(JEV, "redact.py")
lines = [
    "/**",
    " * GENERALT FAJL, NE SZERKESZD KEZZEL. Forras: marveen scripts/jev/redact.py",
    f" * (sha256 {sha(ref)}), a scripts/redact-r11-export.py irta ki.",
    " *",
    " * A Python a referencia. Barmelyik oldal valtozasa = az export es a paritas-",
    " * futas ujra (README, \"Kitakaras\").",
    " */",
    "",
    f"export const REDACTION_VERSION = {ts(redact.REDACTION_VERSION)};",
    f"export const REFERENCE_SHA256 = {ts(sha(ref))};",
    f"export const BUILD_KNOWN_SHA256 = {ts(sha(os.path.join(JEV, 'build_known.py')))};",
    "/** build_known.EXTRA: a flotta szintu nevek, amik nem adatbazis-sorok; a szuro NEM fut rajtuk. */",
    f"export const KNOWN_EXTRA: readonly (readonly [string, string])[] = {ts([list(e) for e in build_known.EXTRA])};",
    "",
    "/** [fajta, Python-minta] a Python _P sorrendjeben: a sorrend szamit. */",
    f"export const PATTERNS: readonly (readonly [string, string])[] = {ts(P)};",
    f"export const INLINE = {ts(INLINE)} as const;",
    f"export const OTHER = {ts(OTHER)} as const;",
    "",
    f"export const HOMOGLYPHS: Readonly<Record<string, string>> = {ts({chr(k): v for k, v in redact._HOMOGLYPHS.items()})};",
    f"export const GIVEN_NAMES: readonly string[] = {ts(sorted(redact.GIVEN_NAMES))};",
    f"export const PRESERVE: readonly string[] = {ts(sorted(redact.PRESERVE))};",
    f"export const NAME_CUES: readonly string[] = {ts(sorted(redact._NAME_CUES))};",
    f"export const LABELS: readonly string[] = {ts(sorted(redact._LABELS))};",
    f"export const COMMON_I: readonly string[] = {ts(sorted(redact._COMMON_I))};",
    f"export const AMBIGUOUS: readonly string[] = {ts(sorted(redact._AMBIGUOUS))};",
    f"export const OPENERS: readonly string[] = {ts(sorted(redact._OPENERS))};",
    "/** A Python sorrendje (hossz szerint csokkeno, stabil): a _stem es a _strip_suffix az elso talalatot veszi. */",
    f"export const SUFFIXES: readonly string[] = {ts(redact._SUFFIXES)};",
    # the Python builds this from a set, so its order is per-process (hash seed); it only
    # decides which variant is tried first, and the known table maps a key to one kind.
    # Sorted here so a re-export is byte-identical.
    f"export const SUFFIXES_F: readonly string[] = {ts(sorted(redact._SUFFIXES_F, key=lambda x: (-len(x), x)))};",
    f"export const DOUBLED: readonly (readonly [string, string])[] = {ts(list(redact._DOUBLED.items()))};",
    f"export const ALWAYS_MASKED: readonly string[] = {ts(sorted(redact.ALWAYS_MASKED))};",
    f"export const KEEPABLE: readonly string[] = {ts(sorted(redact.KEEPABLE))};",
    f"export const KNOWN_ALLOWABLE: readonly string[] = {ts(sorted(redact.KNOWN_ALLOWABLE))};",
    f"export const PAIRING_KEEP: readonly string[] = {ts(sorted(redact.PAIRING_KEEP))};",
    f"export const PAIRING_KNOWN_ALLOW: readonly string[] = {ts(sorted(redact.PAIRING_KNOWN_ALLOW))};",
    f"export const NAME_KINDS_IN_COMPANY: readonly string[] = {ts(sorted(redact._NAME_KINDS_IN_COMPANY))};",
    "",
    "/** shadow.py es offline.py: a merve hivas hatarai. */",
    f"export const MAX_REDACT_CHARS = {shadow.MAX_REDACT_CHARS};",
    f"export const MAX_QUERY_CHARS = {offline.MAX_QUERY_CHARS};",
    f"export const MAX_CANDIDATE_CHARS = {offline.MAX_CANDIDATE_CHARS};",
    f"export const JEV_MODEL = {ts(shadow.MODEL)};",
    f"export const PAIR_POLICY_KEY = {ts(offline.POLICIES['missing_invoice_pair'])};",
    "",
]
# the pairing question, read out of the real offline.build on a synthetic item
shadow.SALT_FILE = os.path.join(tempfile.mkdtemp(), "salt")
_probe = {"id": "probe", "date": "2026-01-01", "amount": "1", "currency": "HUF", "original": "",
          "partner": "Probe Kft.", "narrative": "x", "type": "x",
          "candidates": [{"number": "A1", "date": "2026-01-01", "gross": "1", "currency": "HUF",
                          "supplier": "Probe Kft."}] * 2}
_dto, _questions, _options = offline.build("missing_invoice_pair", _probe)
(_qkey, _q), = _questions.items()
assert list(_q) == ["type", "criteria", "instructions"] and _q["type"] == "choice", list(_q)
assert list(_q["criteria"]) == ["c0", "c1", "NONE"], list(_q["criteria"])
_crit = _q["criteria"]["c0"]
assert _q["criteria"]["c1"] == _crit.replace("c0", "c1") and _crit.count("c0") == 1
lines.insert(-1, f"export const PAIR_QUESTION_KEY = {ts(_qkey)};")
lines.insert(-1, f"export const PAIR_INSTRUCTIONS = {ts(_q['instructions'])};")
lines.insert(-1, "/** A jelolt kriteriuma; {i} a sorszam helye. */")
lines.insert(-1, f"export const PAIR_CRITERION = {ts(_crit.replace('c0', 'c{i}'))};")
lines.insert(-1, f"export const PAIR_NONE = {ts(_q['criteria']['NONE'])};")
# the letter question, the same way (acrobot 25784: the measured DEV/HOLDOUT request)
_ldto, _lquestions, _loptions = offline.build("letter_class", {"subject": "probe", "head": "probe"})
(_lkey, _lq), = _lquestions.items()
assert list(_lq) == ["type", "criteria", "instructions"] and _lq["type"] == "choice", list(_lq)
assert list(_lq["criteria"]) == _loptions == list(offline.LETTER_CLASSES)
lines.insert(-1, "")
lines.insert(-1, "/** offline.py `letter_class`: a level-besorolo merve kerese (DEV es HOLDOUT, r14). */")
lines.insert(-1, f"export const MAX_LETTER_CHARS = {offline.MAX_LETTER_CHARS};")
lines.insert(-1, f"export const LETTER_POLICY_KEY = {ts(offline.POLICIES['letter_class'])};")
lines.insert(-1, f"export const LETTER_QUESTION_KEY = {ts(_lkey)};")
lines.insert(-1, f"export const LETTER_INSTRUCTIONS = {ts(_lq['instructions'])};")
lines.insert(-1, f"export const LETTER_CLASSES: Readonly<Record<string, string>> = {ts(_lq['criteria'])};")
lines.insert(-1, f"export const LETTER_TERMS: readonly string[] = {ts(list(offline.LETTER_TERMS))};")
# the merge rank lives inside _merge; read it back from the function's constants
rank = [c for c in redact._merge.__code__.co_consts if isinstance(c, tuple) and "SECRET" in c]
if len(rank) != 1:
    sys.exit("could not read the merge rank from redact._merge")
lines.insert(-1, f"export const MERGE_RANK: readonly string[] = {ts(list(rank[0]))};")
open(os.path.join(PKG, "src", "redact-r11-data.ts"), "w", encoding="utf-8").write("\n".join(lines))

# ------------------------------------------------------------ vectors
os.makedirs(VEC, exist_ok=True)
for name in ("leak-suite.json", "leak-suite-pairing.json"):
    shutil.copyfile(os.path.join(JEV, name), os.path.join(VEC, name))

cases = []
for suite, path, keep in (("hu-leak", leak_gate.SUITE, ()), ("pairing", leak_gate.PAIRING_SUITE, redact.PAIRING_KEEP)):
    for c in leak_gate.load_suite(path)["cases"]:
        cases.append((suite, c["id"], c["text"], keep))


class Recorder(set):
    """COMMON as the redactor sees it, recording every membership test: the
    subset is then exactly the words these texts ask about, not a guess."""
    asked = set()

    def __contains__(self, w):
        Recorder.asked.add(w)
        return set.__contains__(self, w)


redact.COMMON = Recorder(redact.COMMON)
for _, _, text, _ in cases:
    redact.redact(text)
    redact.redact(text, keep_kinds=redact.PAIRING_KEEP)
# synthetic database rows for the known-entity builder (build_known.aliases/admit)
KNOWN_ROWS = [
    ("PERSON", "Varga Ilona"), ("PERSON", "Ilona"), ("PERSON", ""), ("EMAIL", "ilona.varga@example.com"),
    ("ORG", "Fekete Bolt Kft."), ("ORG", "Tisza 97 Munkaruházati és Munkavédelmi Kft."),
    ("ORG", "Lap Állatkert Nonprofit Zrt. (LAPZOO)"), ("ORG", "FANKSZER BANK Szolgáltató Kft."),
    ("ORG", "ACROPORA HUNGARY Kft."), ("ORG", "Kis Kft"), ("ORG", "Nagy Péter e.v."),
    ("ORG", "Kovács János"), ("ORG", "Acropora"), ("ADDRESS", "Petőfi utca 12."),
    ("ORG", "Hal-Pont Bt.,"), ("ORG", "GYORS SZALLITAS Kft."), ("PERSON", "dr. Szabó Géza"), ("ORG", "  "),
]


def known_kept(rows):
    """build_known.main without the database: the rows, their aliases, the admit
    filter, then EXTRA."""
    rows = rows + [al for kind, value in rows for al in build_known.aliases(kind, value)]
    kept = [(k, v) for k, v in rows if build_known.admit(k, v)]
    return kept + list(build_known.EXTRA)


# the letter request (acrobot 25784), on invented letters; head is built as the
# DEV/HOLDOUT set built it: "File: <name>" and the PDF's first 40 lines
LETTER_HEAD_LINES = 40
LETTER_ITEMS = [
    {"id": "l1", "subject": "Invoice INV-2026-0412 from Fekete Bolt Kft.", "fileName": "Invoice_INV-2026-0412.pdf",
     "lines": ["INVOICE", "Invoice number: INV-2026-0412", "Date: 2026-09-12", "Customer: Acropora Kft.",
               "Contact: Varga Ilona, ilona.varga@example.com, +36 20 123 4567",
               "IBAN: HU42 1170 9002 2062 4460 0000 0000", "Total: 1 234,00 EUR"]},
    {"id": "l2", "subject": "Pro forma Rechnung 4711", "fileName": "PF-4711.pdf",
     "lines": ["Pro forma", "Rechnung Nr. 4711", "Tax invoice follows after payment", "Kunde: Kovács Péter",
               "Gesamt 99,50 EUR"]},
    {"id": "l3", "subject": "Szállítólevél", "fileName": "SZL-2026-88.pdf",
     "lines": ["Szállítólevél SZL-2026/88", "Delivery note", "Átvevő: Nagy Péter", "Kelt: Budapest, 2026.09.01."]},
    {"id": "l4", "subject": "Payment reminder", "fileName": "First reminder 11069.pdf",
     "lines": ["Payment reminder", "Zahlungserinnerung", "Dear Mr Smith,", "Our records show invoice 26007910 is open.",
               "Mahnung"]},
    {"id": "l5", "subject": "Ajánlat és Árajánlat", "fileName": "",
     "lines": [f"Tétel {i}: Tunze Turbelle szivattyú, Végösszeg {i * 1000} Ft" for i in range(60)]},
    {"id": "l6", "subject": "FANK karbantartás", "fileName": "fank.pdf",
     "lines": ["Számla", "FANK karbantartás", "Összesen 12 000 Ft"]},
]


def _letter_item(item):
    head = "\n".join([f"File: {item['fileName']}"] + item["lines"][:LETTER_HEAD_LINES])
    return {"subject": item["subject"], "head": head}


def _straddling_letter():
    """A letter whose redacted text has a placeholder across the 1500-char cut."""
    for n in range(1300, 1520):
        item = {"id": "l7", "subject": "Számla", "fileName": "a.pdf",
                "lines": ["x " * (n // 2) + "Kovács Péter Zoltán úrnak"]}
        with redact.preserving(offline.LETTER_TERMS):
            out = redact.redact(offline.letter_text(_letter_item(item)))["text"]
        i = out.find("<PERSON_1>")
        if 0 <= i < offline.MAX_LETTER_CHARS < i + len("<PERSON_1>"):
            return item
    sys.exit("could not place a placeholder across the letter cut")


LETTER_ITEMS.append(_straddling_letter())
# longer than the redactor takes: blocked, never cut first and sent
LETTER_ITEMS.append({"id": "l8", "subject": "Számla", "fileName": "b.pdf",
                     "lines": ["y" * (shadow.MAX_REDACT_CHARS + 1)]})
with redact.preserving(offline.LETTER_TERMS):
    for _item in LETTER_ITEMS:
        try:
            redact.redact(offline.letter_text(_letter_item(_item)))
        except redact.RedactionError:
            pass

known_kept(KNOWN_ROWS)
lookups = Recorder.asked
common_subset = sorted(w for w in redact.COMMON if w in lookups)

# synthetic known entities: (kind, value); only invented names
KNOWN = [("PERSON", "Varga Ilona"), ("PERSON", "Ilona Varga"), ("ORG", "Fekete Bolt"),
         ("ORG", "Tisza 97 Kft."), ("ORG", "Kovács János"), ("EMAIL", "ilona.varga@example.com"),
         ("ADDRESS", "Petőfi utca 12"), ("ORG", "Lap Állatkert"), ("HANDLE", "KratoBal"), ("ORG", "FANK"),
         ("ORG", "Großhandel Weiß GmbH"),
         # r12: build_known's caps alias next to the full name (acrobot 25567)
         ("ORG", "HANNA Instruments Service Kft."), ("ORG", "HANNA Instruments Service"),
         ("ORG", "HANNA"), ("ORG", "Alfa HANNA Beta Kft.")]
KNOWN_TEXTS = [
    "issuer: Varga Ilona", "Varga Ilonának küldtük", "Fekete Bolt Kft., 5000 HUF",
    "Fekete Bolt e.v., 5000 HUF", "Fekete Bolt, 5000 HUF", "issuer: Tisza 97 Kft.",
    "partner: Kovács János", "Kovács János FoxPost Kft.", "Kovács János Kft. számla",
    "a lap-allatkert.docx fájl", "írj az ilona.varga@example.com címre", "Petőfi utca 12 alatt",
    "KratoBal/acropora-os #6", "Fekete Boltnál vettük", "Fekete Bolt egyéni vállalkozó",
    "FANK karbantartás", "a FANK Zrt. számlája",
    # a legal form AND a sole-trader marker: only the sole-trader check stops it
    "issuer: Fekete Bolt Kft., e.v., 5000 HUF",
    # casefold beyond lower(): ß -> ss on one side only
    "GROSSHANDEL WEISS GmbH számla", "Großhandel Weiß GmbH számla",
    # r12: the bare alias inside the full, legally formed name passes the pairing guard
    "issuer: HANNA Instruments Service Kft.", "HANNA szerint a lámpa jó",
    "issuer: Alfa HANNA Beta Kft.", "a HANNA Instruments Service szerint",
    "issuer: HANNA Instruments Service Kft., e.v.",
]


def outputs(text, keep):
    try:
        r = redact.redact(text, keep_kinds=keep)
    except redact.RedactionError as e:
        return {"error": str(e)}
    return {"text": r["text"], "counts": r["counts"],
            "guard": redact.runtime_guard(r),
            "guardPairing": redact.runtime_guard(r, allow_known_kinds=redact.PAIRING_KNOWN_ALLOW)}


full = [(outputs(text, ()), outputs(text, redact.PAIRING_KEEP)) for _, _, text, _ in cases]


def letter_vector(item):
    try:
        dto, questions, options = offline.build("letter_class", _letter_item(item))
    except shadow.Blocked as b:
        return {"blocked": b.outcome, "detail": b.detail}
    return {"body": json.dumps({"state": dto.fields, "model": shadow.MODEL, "questions": questions},
                               ensure_ascii=False),
            "placeholders": dto.counts, "options": options}


letter_full = [letter_vector(i) for i in LETTER_ITEMS]
redact.COMMON = set(common_subset)   # the vectors see what the test will see
sub = [(outputs(text, ()), outputs(text, redact.PAIRING_KEEP)) for _, _, text, _ in cases]
if full != sub:
    bad = [cases[i][1] for i in range(len(cases)) if full[i] != sub[i]]
    sys.exit(f"the common-words subset changes the output: {bad[:5]}")
out = {"version": redact.REDACTION_VERSION, "reference": sha(ref),
       "commonWords": common_subset, "cases": []}
for suite, cid, text, keep in cases:
    out["cases"].append({"suite": suite, "id": cid, "keep": sorted(keep),
                         "default": outputs(text, ()), "pairing": outputs(text, redact.PAIRING_KEEP)})

kpath = os.environ["JEV_KNOWN_ENTITIES"]
redact.write_known_file(KNOWN, kpath)
redact._KNOWN_CACHE.clear()
out["knownBuilder"] = {"rows": KNOWN_ROWS, "kept": known_kept(KNOWN_ROWS)}
out["known"] = {"entries": KNOWN, "cases": [
    {"text": t, "default": outputs(t, ()), "pairing": outputs(t, redact.PAIRING_KEEP),
     "spans": [list(s) for s in redact._known_spans(t, redact._load_known())]}
    for t in KNOWN_TEXTS]}
os.remove(kpath)
redact._KNOWN_CACHE.clear()

# the pairing request, through the real offline.build, on synthetic items
PAIR_ITEMS = [
    {"id": "p1", "date": "2026-08-17", "amount": "1999", "currency": "HUF", "original": "",
     "partner": "SIMPLEP*PARKL.NET", "narrative": "E-PAR-2026-36143 PARKL", "type": "KÁRTYATRANZAKCIÓ",
     "candidates": [{"number": "E-PAR-2026-36143", "date": "2026-08-01", "gross": "1999", "currency": "HUF",
                     "supplier": "Parkl Digital Technologies Kft."},
                    {"number": "SZ-2026/0790", "date": "2026-07-01", "gross": "2499", "currency": "HUF",
                     "supplier": "Szabó Géza ev."}]},
    {"id": "p2", "date": "2026-03-05", "amount": "258173", "currency": "HUF", "original": "",
     "partner": "Kovács Péter", "narrative": "U26/00918-SZ Kovács Péter tel +36 20 123 4567",
     "type": "ÁTUTALÁS",
     "candidates": [{"number": "U26/00918-SZ", "date": "2026-03-05", "gross": "258173", "currency": "HUF",
                     "supplier": "Tisza 97 Munkaruházati és Munkavédelmi Kft."}]},
    {"id": "p3", "date": "2026-05-01", "amount": "99.71", "currency": "EUR", "original": "38488 HUF",
     "partner": "TelekomSzaml*925585488", "narrative": "x" * 1700, "type": "",
     "candidates": [{"number": "5120260001254481", "date": "2026-05-02", "gross": "38488", "currency": "HUF",
                     "supplier": "Magyar Telekom Nyrt."}]},
    {"id": "p4", "date": "2026-06-01", "amount": "5000", "currency": "HUF", "original": "",
     "partner": "Fekete Bolt e.v.", "narrative": "Fekete Bolt, Varga Ilona", "type": "ÁTUTALÁS",
     "candidates": [{"number": "FB-1", "date": "2026-06-01", "gross": "5000", "currency": "HUF",
                     "supplier": "Fekete Bolt Kft."}]},
    # a known ORG with no legal form that no other rule masks: the guard stops it
    {"id": "p5", "date": "2026-06-02", "amount": "12000", "currency": "HUF", "original": "",
     "partner": "Akvárium Szerviz Kft.", "narrative": "FANK karbantartás", "type": "ÁTUTALÁS",
     "candidates": [{"number": "AK-7", "date": "2026-06-01", "gross": "12000", "currency": "HUF",
                     "supplier": "Akvárium Szerviz Kft."}]},
]


def _straddling_item():
    """A query whose redacted text has a placeholder across the 1500-char cut:
    the half placeholder must be dropped, never sent."""
    base = {"id": "p6", "date": "2026-07-01", "amount": "100", "currency": "HUF", "original": "",
            "partner": "Akvárium Szerviz Kft.", "type": "ÁTUTALÁS",
            "candidates": [{"number": "AK-8", "date": "2026-07-01", "gross": "100", "currency": "HUF",
                            "supplier": "Akvárium Szerviz Kft."}]}
    for n in range(1400, 1520):
        item = dict(base, narrative="x " * (n // 2) + "Kovács Péter Zoltán úrnak")
        out = redact.redact(offline.payment_text(item), keep_kinds=redact.PAIRING_KEEP)["text"]
        i = out.find("<PERSON_1>")
        if 0 <= i < offline.MAX_QUERY_CHARS < i + len("<PERSON_1>"):
            return item
    sys.exit("could not place a placeholder across the cut")


PAIR_ITEMS.append(_straddling_item())
# r12 / acrobot 25560: a candidate the guard stops leaves the list, the rest are renumbered
PAIR_ITEMS.append(
    {"id": "p7", "date": "2026-06-03", "amount": "1999", "currency": "HUF", "original": "",
     "partner": "Akvárium Szerviz Kft.", "narrative": "SZ-2026/0815", "type": "ÁTUTALÁS",
     "candidates": [{"number": "FANK-2026", "date": "2026-06-01", "gross": "1999", "currency": "HUF",
                     "supplier": "Szállító Kft."},
                    {"number": "SZ-2026/0815", "date": "2026-06-02", "gross": "1999", "currency": "HUF",
                     "supplier": "Szállító Kft."},
                    {"number": "HI-26/000878", "date": "2026-06-02", "gross": "1950", "currency": "HUF",
                     "supplier": "HANNA Instruments Service Kft."}]})


def pair_vector(item):
    try:
        dto, questions, options, back, dropped = offline.build_with_map("missing_invoice_pair", item)
    except shadow.Blocked as b:
        return {"blocked": b.outcome, "detail": b.detail}
    return {"body": json.dumps({"state": dto.fields, "model": shadow.MODEL, "questions": questions},
                               ensure_ascii=False),
            "placeholders": dto.counts, "options": options,
            # which input candidates went out as c0, c1, ... and which the guard dropped
            "kept": [int(v[1:]) for k, v in back.items() if k != "NONE"],
            "dropped": dropped}


out["pairing"] = {"items": PAIR_ITEMS, "unknown": [pair_vector(i) for i in PAIR_ITEMS]}
redact.write_known_file(KNOWN, kpath)
redact._KNOWN_CACHE.clear()
out["pairing"]["known"] = [pair_vector(i) for i in PAIR_ITEMS]
os.remove(kpath)
redact._KNOWN_CACHE.clear()

letter_sub = [letter_vector(i) for i in LETTER_ITEMS]
if letter_sub != letter_full:
    sys.exit("the common-words subset changes a letter request: "
             f"{[LETTER_ITEMS[i]['id'] for i in range(len(LETTER_ITEMS)) if letter_sub[i] != letter_full[i]]}")
out["letter"] = {"items": LETTER_ITEMS, "unknown": letter_sub}
redact.write_known_file(KNOWN, kpath)
redact._KNOWN_CACHE.clear()
out["letter"]["known"] = [letter_vector(i) for i in LETTER_ITEMS]
os.remove(kpath)
redact._KNOWN_CACHE.clear()

json.dump(out, open(os.path.join(VEC, "r11-expected.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"patterns {len(P)}, cases {len(out['cases'])}, known cases {len(KNOWN_TEXTS)}, "
      f"common subset {len(common_subset)} of {len(redact.COMMON)} (after intersect)")
