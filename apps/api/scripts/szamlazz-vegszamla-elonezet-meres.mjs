/**
 * A VALÓDI SZÁMLÁZZ.HU KEREKÍTÉSE ÉS ELŐLEG-LEVONÁSA A VÉGSZÁMLÁN, ELŐNÉZETTEL (barracuda d31a66a3 átnézés, B2; acrobot 62714).
 *
 *   node szamlazz-vegszamla-elonezet-meres.mjs <keresesi-gyoker, pl. /app> <kimeneti-mappa> [--eloleg <előlegszámla-szám>]
 *   node szamlazz-vegszamla-elonezet-meres.mjs <keresesi-gyoker> <kimeneti-mappa> --szaraz
 *
 * A `--szaraz` SZÁRAZ FUTÁS: se kulcs, se hálózat, se adatbázis. Ugyanazokat a kéréseket építi (álkulccsal, egy kitalált
 * előleggel: 27% 20 000 és 5% 3 000 Ft), lefuttatja az előnézet-őrt, és az XML-eket a kimeneti mappába menti, hogy a kérés
 * a valódi futás előtt átnézhető legyen. A Számlázz.hu-oldali összevetés ilyenkor nem fut.
 *
 * AZ ÉLES API KONTÉNERÉBEN fut, a tárolt Agent-kulccsal (ugyanaz a betöltés, mint a szamlazz-pdf-egy-szam-proba.mjs-é: a build
 * lefordított moduljai, a kulcsot a SzamlazzCredentialProvider adja, és a kulcs sehova nem íródik ki).
 *
 * MIT MÉR, EGY KITALÁLT, DE VALÓSÁGHŰ WEBSHOP-RENDELÉSEN (kitalált magánszemély vevő; vegyes ÁFA: 27% és 5%, 2 és 3 darabos
 * tétel nem kerek nettóval, hűségpont-kedvezmény, szállítás):
 *   A) SZÁMLA ELŐNÉZET: a Számlázz.hu bruttója, ÁFA-bontása (kulcsonként) a mi `szamlazzDocumentTotals`-unkkal, fillérre;
 *   B) VÉGSZÁMLA ELŐNÉZET egy VALÓDI, kiállított előlegszámlára hivatkozva (`elolegSzamlaszam`; a Számlázz.hu a levonást a
 *      hivatkozott előlegből maga számolja, ezért kitalált szám nem lehet): a fizetendő a mi `finalPayable`-ünkkel (bruttó mínusz
 *      az előleg bruttója), fillérre; kétszer, `fizetve` nélkül és `fizetve`-vel (B2 harmadik pontja: a fizetve jel a hátralékra
 *      áll-e). Az előlegszámla száma a `--eloleg`-ből jön, vagy az OS adatbázisából a legutóbb kiállított előlegszámla (csak olvas).
 *      A végszámla tételei az előleg minden ÁFA-kulcsát lefedik (különben a Számlázz.hu negatív sort tenne, N3b), ezért a kulcsonkénti
 *      tételeket a szkript szükség szerint felszorozza.
 * A Számlázz.hu oldala: a válasz `szamlanetto`/`szamlabrutto`/`kintlevoseg` mezői, ha az előnézet adja, ÉS az előnézeti PDF szövege
 * (pdf.js, a szokásos olvasóval). A PDF-et és a kinyert szöveget a kimeneti mappába menti, az összevetést a meres.txt-be.
 *
 * KIÁLLÍTÁS NÉLKÜL, ÉS EZ A KÓDBÓL KÖVETKEZIK, NEM EBBŐL A MONDATBÓL:
 *   1. A kérés ugyanazon az úton készül, mint az OS „Előnézet” gombjáé (billing-document-preview.service.ts):
 *      `toSzamlazzAgentInput(..., { previewOnly: true })`, majd `buildSzamlazzAgentInvoiceXml`, és a külső azonosító
 *      (`szamlaKulsoAzon`) kimarad, ahogy ott. A `previewOnly: true` az XML-be `<elonezetpdf>true</elonezetpdf>`-t tesz
 *      (szamlazz-agent-xml.ts), a Számlázz.hu leírása szerint ilyenkor bizonylat nem készül, csak a minta-PDF.
 *   2. ŐR A KÜLDÉS ELŐTT: ha a kész XML-ben nincs `<elonezetpdf>true</elonezetpdf>`, a hívás el sem indul (kilépés 8).
 *   3. ŐR A VÁLASZ UTÁN: ha a válaszban számlaszám áll, a Számlázz.hu KIÁLLÍTOTT (az előnézet nem az, aminek hittük): a szkript
 *      azonnal megáll, kiírja a számot, és a további hívást nem indítja el (kilépés 9). Ezt jelenteni kell, nem megkerülni.
 *   4. Más Számlázz.hu-hívás nincs: az előleg adatait a csak olvasó lekérdezés hozza (`action-szamla_agent_xml`, billing-szamlazz-
 *      query.ts), az OS adatbázisát egyetlen `findFirst` olvassa. Írás sehol.
 *
 * Kilépés: 0 minden összevetés egyezik; 1 eltérés van (a meres.txt megnevezi); 2 rossz bemenet; 3 modul nem található;
 *          4 a Számlázz.hu hibát adott (a hibakód kiírva; ha az előnézet maga nem támogatott, az itt látszik); 6 nincs előlegszámla
 *          (a B rész nem mérhető, az A lefutott); 8 az előnézet-jel hiányzott, a hívás nem indult; 9 KIÁLLÍTOTT, megálltunk.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const DRY = args.includes("--szaraz");
if (DRY) args.splice(args.indexOf("--szaraz"), 1);
const flag = args.indexOf("--eloleg");
const ADVANCE_ARG = flag >= 0 ? args[flag + 1] : undefined;
const [ROOT_ARG, OUT, ...rest] =
  flag >= 0 ? [...args.slice(0, flag), ...args.slice(flag + 2)] : args;
// createRequire takes an absolute path only: a relative root ("dist") is resolved here
const ROOT = ROOT_ARG ? resolve(ROOT_ARG) : undefined;
if (!ROOT || !OUT || rest.length || (flag >= 0 && !ADVANCE_ARG)) {
  console.error(
    "hasznalat: node szamlazz-vegszamla-elonezet-meres.mjs <keresesi-gyoker> <kimeneti-mappa> [--eloleg <elolegszamla-szam>]",
  );
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const report = [];
let differences = 0;
const say = (line) => {
  report.push(line);
  console.log(line);
};
const finish = (code) => {
  writeFileSync(join(OUT, "meres.txt"), report.join("\n") + "\n");
  process.exit(code);
};

function findAll(dir, suffix, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      findAll(full, suffix, found);
    } else if (full.endsWith(suffix)) found.push(full);
  }
  return found;
}
const MODULES = {
  provider: "/integrations/szamlazz/szamlazz-credential.provider.js",
  repository: "/integrations/szamlazz/szamlazz-connection.repository.js",
  crypto: "/integrations/szamlazz/szamlazz-credential-crypto.service.js",
  client: "/integrations/szamlazz/szamlazz-agent.client.js",
  xml: "/integrations/szamlazz/szamlazz-agent-xml.js",
  adapter: "/billing/billing-document-szamlazz.adapter.js",
  query: "/billing/billing-szamlazz-query.js",
  feedXml: "/missing-invoices/szamlazz-feed-xml.js",
  pdfText: "/documents/pdf/pdf-text-readback.js",
};
const paths = {};
for (const [name, suffix] of Object.entries(MODULES)) {
  const found = findAll(ROOT, suffix);
  if (found.length !== 1) {
    say(
      JSON.stringify({
        hiba: `${suffix} nem pontosan egyszer van meg`,
        jeloltek: found,
      }),
    );
    finish(3);
  }
  paths[name] = found[0];
}
const requireFromBuild = createRequire(paths.provider);
// the compiled modules need reflect-metadata (Nest decorators), resolved from the build itself
requireFromBuild("reflect-metadata");
const load = (name) => import(pathToFileURL(paths[name]).href);
const loadPackage = (name) =>
  import(pathToFileURL(requireFromBuild.resolve(name)).href);

const { SzamlazzCredentialProvider } = await load("provider");
const { SzamlazzConnectionRepository } = await load("repository");
const { SzamlazzCredentialCryptoService } = await load("crypto");
const { HttpSzamlazzAgentClient } = await load("client");
const { buildSzamlazzAgentInvoiceXml } = await load("xml");
const { toSzamlazzAgentInput } = await load("adapter");
const { buildSzamlazzQueryXml, parseSzamlazzQueryResponse } =
  await load("query");
const { parseXmlTree } = await load("feedXml");
const { readPdfTextLines } = await load("pdfText");
const {
  szamlazzDocumentTotals,
  szamlazzLineAmounts,
  szamlazzUnitNetFromGross,
} = await loadPackage("@acropora/types");

const PREVIEW_MARK = "<elonezetpdf>true</elonezetpdf>";
const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Budapest",
}).format(new Date());
const credential = DRY
  ? { agentKey: "szaraz-futas-nem-kulcs", revision: "szaraz" }
  : await new SzamlazzCredentialProvider(
      new SzamlazzConnectionRepository(),
      new SzamlazzCredentialCryptoService(),
    ).resolve();
const client = new HttpSzamlazzAgentClient();
say(
  `--- szamlazz-vegszamla-elonezet | ${new Date().toISOString()} | kulcs-revizio ${credential.revision} ---`,
);

/* ---------- the fictional order, built the way the webshop invoice rules build lines (gross price -> unit net -> amounts) ---------- */

/** A webshop line from its gross: `szamlazzUnitNetFromGross`, then `szamlazzLineAmounts` (webshop-order-invoice.rules.ts). */
function line(
  position,
  kind,
  parentPosition,
  description,
  quantity,
  unitGross,
  vatRate,
  unit = "db",
) {
  const gross = (quantity * unitGross).toFixed(2);
  const unitNet = szamlazzUnitNetFromGross({
    grossAmount: gross,
    quantity: String(quantity),
    vatRatePercent: vatRate,
    currency: "HUF",
  });
  if (!unitNet.ok)
    throw new Error(`egysegar: ${description}: ${unitNet.error}`);
  const amounts = szamlazzLineAmounts({
    quantity: String(quantity),
    unitNet: unitNet.unitNet,
    vatRatePercent: vatRate,
    currency: "HUF",
  });
  if (!amounts.ok)
    throw new Error(`osszegek: ${description}: ${amounts.error}`);
  return {
    position,
    kind,
    parentPosition,
    description,
    code: null,
    quantity,
    unit,
    unitNet: Number(unitNet.unitNet),
    vatRate,
    netAmount: Number(amounts.netAmount),
    vatAmount: Number(amounts.vatAmount),
    grossAmount: Number(amounts.grossAmount),
    comment: null,
  };
}

/** The order; `scale` multiplies the quantity of the main line of a rate, so the final invoice covers the advance on it. */
function orderLines(scale = { 27: 1, 5: 1 }, extraRates = {}) {
  const lines = [
    line(
      1,
      "ITEM",
      null,
      "Acropora millepora frag (mérési minta)",
      2 * scale[27],
      12990,
      "27",
    ),
    line(2, "DISCOUNT", 1, "Hűségpont beváltás", 1, -1500, "27"),
    line(
      3,
      "ITEM",
      null,
      "Tengeri akvarisztika kézikönyv (mérési minta)",
      1 * scale[5],
      4590,
      "5",
    ),
    line(4, "ITEM", null, "Tengeri só 20 kg (mérési minta)", 3, 8490, "27"),
    line(5, "ITEM", null, "GLS házhozszállítás", 1, 3500, "27", "alkalom"),
  ];
  let position = 6;
  for (const [rate, gross] of Object.entries(extraRates))
    lines.push(
      line(
        position++,
        "ITEM",
        null,
        `Mérési tétel ${rate}% (az előleg kulcsának fedezete)`,
        1,
        gross,
        rate,
      ),
    );
  return lines;
}

const BUYER = {
  name: "Minta Mérés Péter",
  country: null,
  zip: "1111",
  city: "Budapest",
  address: "Mérés utca 1.",
  email: null,
  taxNumber: null,
  euTaxNumber: null,
  vatSubject: null,
  taxSubject: { type: "PERSON", partnerMirror: false },
};

function document(documentType, lines, extra = {}) {
  return {
    id: "meres-b2",
    documentType,
    invoiceFormat: "ELECTRONIC",
    fulfillmentDate: today,
    dueDate: today,
    paymentMethod: "Átutalás",
    currency: "HUF",
    language: "hu",
    note: "MÉRÉS, ELŐNÉZET (B2): nem kiállított bizonylat.",
    reference: null,
    proformaNumber: null,
    advanceNumber: null,
    buyer: BUYER,
    lines,
    ...extra,
  };
}

/** Our side: the totals, and the totals per VAT rate (as the billing detail reads them). */
function ourTotals(lines) {
  const amounts = lines.map((l) => ({
    netAmount: l.netAmount.toFixed(2),
    vatAmount: l.vatAmount.toFixed(2),
    grossAmount: l.grossAmount.toFixed(2),
  }));
  const all = szamlazzDocumentTotals(amounts, "HUF");
  const perRate = {};
  for (const rate of [...new Set(lines.map((l) => l.vatRate))])
    perRate[rate] = szamlazzDocumentTotals(
      amounts.filter((_, i) => lines[i].vatRate === rate),
      "HUF",
    );
  return { all, perRate };
}

/* ---------- the preview call, with both guards ---------- */

async function preview(name, doc) {
  const { externalId: _unused, ...agentInput } = toSzamlazzAgentInput(doc, {
    agentKey: credential.agentKey,
    previewOnly: true,
    today,
  });
  const xml = buildSzamlazzAgentInvoiceXml(agentInput);
  if (!xml.includes(PREVIEW_MARK)) {
    say(
      `MEGALLOK (${name}): a kesz keresben nincs ${PREVIEW_MARK}; a hivas NEM indult el.`,
    );
    finish(8);
  }
  if (DRY) {
    writeFileSync(join(OUT, `${name}.xml`), xml);
    say(
      `== ${name} (szaraz): az elonezet-jel a keresben megvan, a keres ${xml.length} bajt, mentve: ${name}.xml`,
    );
    return { response: { successful: true }, text: [] };
  }
  const response = await client.generateInvoice(xml);
  if (response.invoiceNumber) {
    say(
      `!!! MEGALLOK (${name}): a Szamlazz.hu SZAMLASZAMOT adott (${response.invoiceNumber}): ez KIALLITAS, nem elonezet. Tovabbi hivas nincs. Jelentsd, ne kerulj.`,
    );
    finish(9);
  }
  if (!response.successful) {
    say(
      `SZAMLAZZ.HU HIBA (${name}): hibakod ${response.errorCode ?? "?"}: ${response.errorMessage ?? ""}`,
    );
    finish(4);
  }
  const pdf = response.pdf ?? null;
  let text = [];
  if (pdf) {
    writeFileSync(join(OUT, `${name}.pdf`), pdf);
    text = (await readPdfTextLines(pdf, { untrusted: true, maxPages: 10 })).map(
      (l) => l.text,
    );
    writeFileSync(join(OUT, `${name}.txt`), text.join("\n") + "\n");
  }
  say(
    `== ${name}: sikeres, szamlaszam nincs (elonezet); valasz-mezok: szamlanetto=${response.netTotal ?? "-"}, szamlabrutto=${response.grossTotal ?? "-"}, kintlevoseg=${response.outstanding ?? "-"}; PDF ${pdf ? `${pdf.length} bajt, ${text.length} sor` : "NINCS"}`,
  );
  return { response, text };
}

/**
 * Does a PDF text line carry this amount, in any of the PDF's number forms ("35 040", "35.040,00", "-23 000", "35040")?
 * Not by splitting the line into numbers: with space-grouped thousands, two neighbouring columns ("4 371 219") read as one.
 */
function hasAmount(text, amount) {
  const value = Number(amount);
  const digits = String(Math.abs(Math.round(value)));
  const groups = [];
  for (let end = digits.length; end > 0; end -= 3)
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  const sign = value < 0 ? "-\\s?" : "";
  return new RegExp(
    `(?<![\\d,])${sign}${groups.join("[ .\\u00a0\\u202f]?")}(?:,0{1,2})?(?![\\d,])`,
  ).test(text);
}

/** The lines of the PDF text that carry a keyword. */
const linesWith = (text, pattern) => text.filter((t) => pattern.test(t));

/**
 * One comparison. A value the PDF should carry and does not is counted (`required`); a field of the response that the preview
 * may simply not return (szamlanetto, szamlabrutto, kintlevoseg: the docs do not say for a preview) is only named.
 */
function compare(label, ours, theirs, required = true) {
  if (DRY) return say(`   (szaraz) ${label}: mienk ${ours}`);
  if (theirs === null || theirs === undefined) {
    say(
      `   ${required ? "NINCS  " : "-      "} ${label}: mienk ${ours}, Szamlazz.hu: ${required ? "NEM OLVASHATO (lasd a PDF szoveget)" : "a valasz nem adja"}`,
    );
    if (required) differences += 1;
    return;
  }
  const same = Math.abs(Number(ours) - Number(theirs)) < 0.005;
  if (!same) differences += 1;
  say(
    `   ${same ? "EGYEZIK" : "ELTER  "} ${label}: mienk ${ours}, Szamlazz.hu ${theirs}`,
  );
}

/** The PDF's VAT-rate summary: a line naming the rate (27%, 5%) that carries our net, VAT and gross amounts. */
function rateRowMatches(text, rate, totals) {
  const want = [
    Number(totals.netAmount),
    Number(totals.vatAmount),
    Number(totals.grossAmount),
  ];
  const rows = linesWith(text, new RegExp(`(^|\\D)${rate}\\s?%`));
  const hit = rows.find((t) => want.every((w) => hasAmount(t, w)));
  return { hit: hit ?? null, candidates: rows };
}

/** The document's gross on the PDF: a total line ("Összesen", "Végösszeg", "Bruttó", "Fizetendő") carrying our amount. */
function grossOnPdf(text, gross) {
  const rows = linesWith(
    text,
    /(összesen|osszesen|végösszeg|vegosszeg|brutt|fizetend)/i,
  );
  return rows.some((t) => hasAmount(t, gross)) ? Number(gross) : null;
}

/* ---------- A: an invoice preview: the rounding and the VAT breakdown ---------- */

const linesA = orderLines();
const oursA = ourTotals(linesA);
const a = await preview("A-szamla", document("INVOICE", linesA));
compare(
  "A brutto (PDF osszesito sor)",
  oursA.all.grossAmount,
  grossOnPdf(a.text, oursA.all.grossAmount),
);
compare(
  "A brutto (valasz)",
  oursA.all.grossAmount,
  a.response.grossTotal,
  false,
);
compare("A netto (valasz)", oursA.all.netAmount, a.response.netTotal, false);
for (const [rate, totals] of Object.entries(oursA.perRate)) {
  const { hit, candidates } = rateRowMatches(a.text, rate, totals);
  if (!hit && !DRY) differences += 1;
  say(
    `   ${DRY ? "(szaraz)" : hit ? "EGYEZIK" : "NINCS  "} A ${rate}% sor (netto ${totals.netAmount}, AFA ${totals.vatAmount}, brutto ${totals.grossAmount})${hit ? `: "${hit}"` : `; a PDF ${rate}%-os sorai: ${JSON.stringify(candidates)}`}`,
  );
}

/* ---------- B: the final invoice against a real advance invoice ---------- */

let advanceNumber = DRY ? "SZARAZ-ELOLEG-1" : (ADVANCE_ARG ?? null);
let osAdvanceGross = DRY ? 23000 : null;
if (!DRY)
  try {
    const { prisma } = await loadPackage("@acropora/database");
    const row = await prisma.invoice.findFirst({
      where: {
        direction: "OUTBOUND",
        documentType: "ADVANCE_INVOICE",
        status: "ISSUED",
        ...(advanceNumber
          ? { invoiceNumber: advanceNumber }
          : { invoiceNumber: { not: null } }),
      },
      orderBy: { createdAt: "desc" },
      select: { invoiceNumber: true, grossAmount: true, currency: true },
    });
    await prisma.$disconnect();
    if (row) {
      advanceNumber = row.invoiceNumber;
      osAdvanceGross =
        row.grossAmount === null ? null : Number(row.grossAmount);
      say(
        `elolegszamla az OS-ben: ${row.invoiceNumber}, brutto ${row.grossAmount ?? "-"} ${row.currency}`,
      );
    } else
      say(
        `elolegszamla az OS-ben: ${ADVANCE_ARG ? `${ADVANCE_ARG} nincs kiallitottkent` : "nincs kiallitott"}`,
      );
  } catch (error) {
    say(
      `az OS adatbazisa nem olvashato innen (${error instanceof Error ? error.message.split("\n")[0] : error}); csak a --eloleg szama hasznalhato`,
    );
  }
if (!advanceNumber) {
  say(
    "NINCS ELOLEGSZAMLA: a B resz (levonas, fizetendo, fizetve) elonezettel nem merheto. Az A resz fent all.",
  );
  finish(6);
}

const queried = DRY
  ? "<szamla><alap><szamlaszam>SZARAZ-ELOLEG-1</szamlaszam><tipus>ES</tipus></alap><osszegek>" +
    "<afakulcsossz><afakulcs>27</afakulcs><brutto>20000</brutto></afakulcsossz>" +
    "<afakulcsossz><afakulcs>0.05</afakulcs><brutto>3000</brutto></afakulcsossz>" +
    "<totalossz><netto>18605</netto><brutto>23000</brutto></totalossz></osszegek></szamla>"
  : await client.queryDocument(
      buildSzamlazzQueryXml({
        agentKey: credential.agentKey,
        key: { by: "invoiceNumber", value: advanceNumber },
      }),
    );
const advance = parseSzamlazzQueryResponse(queried);
if (advance.outcome !== "FOUND") {
  say(
    `az elolegszamla (${advanceNumber}) a Szamlazz.hu-n: ${advance.outcome} ${advance.errorMessage ?? ""}`,
  );
  finish(4);
}
// the advance's parts per VAT rate (`osszegek/afakulcsossz`), for the coverage
const advanceParts = {};
for (const node of parseXmlTree(queried).children.find(
  (c) => c.name === "osszegek",
)?.children ?? []) {
  if (node.name !== "afakulcsossz") continue;
  const get = (n) =>
    node.children.find((c) => c.name === n)?.text.trim() ?? null;
  // the rate may come as "27" or as a fraction ("0.27"): either way the whole percent
  const raw = Number(
    (get("afakulcs") ?? "").replace(",", ".").replace("%", ""),
  );
  if (!Number.isFinite(raw) || raw <= 0) continue;
  advanceParts[String(Math.round(raw < 1 ? raw * 100 : raw))] = Number(
    get("brutto"),
  );
}
say(
  `elolegszamla a Szamlazz.hu-n: ${advance.invoiceNumber} (tipus ${advance.kindCode}), brutto ${advance.grossTotal}, kulcsonkent ${JSON.stringify(advanceParts)}`,
);
if (advance.kindCode !== "ES")
  say(`   FIGYELEM: a tipus nem ES (elolegszamla), hanem ${advance.kindCode}`);
if (osAdvanceGross !== null)
  compare(
    "az eloleg brutto, OS kontra Szamlazz.hu",
    osAdvanceGross,
    advance.grossTotal,
  );
// production's finalPayable deducts the OS row's gross; without it (an advance not in the OS) the Számlázz.hu gross stands in
const advanceGross = osAdvanceGross ?? Number(advance.grossTotal);

// cover every rate of the advance, with a margin: scale the main line of 27% and 5%, add a line for any other rate
const scale = { 27: 1, 5: 1 };
const extraRates = {};
for (const [rate, part] of Object.entries(advanceParts)) {
  const have = ourTotals(orderLines(scale, extraRates)).perRate[rate];
  if (have && Number(have.grossAmount) > part) continue;
  if (rate === "27") scale[27] = Math.ceil((part + 5000) / (2 * 12990));
  else if (rate === "5") scale[5] = Math.ceil((part + 5000) / 4590);
  else extraRates[rate] = Math.ceil(part + 5000);
}
const linesB = orderLines(scale, extraRates);
const oursB = ourTotals(linesB);
const payable = Number(oursB.all.grossAmount) - advanceGross;
say(
  `B vegszamla: tetelek ${linesB.length}, a mi bruttonk ${oursB.all.grossAmount}, finalPayable ${payable.toFixed(2)} (brutto - eloleg ${advanceGross})`,
);

for (const paid of [false, true]) {
  const name = paid ? "B-vegszamla-fizetve" : "B-vegszamla";
  const b = await preview(
    name,
    document("FINAL_INVOICE", linesB, { advanceNumber, proformaPaid: paid }),
  );
  compare(
    `${name} brutto (valasz)`,
    oursB.all.grossAmount,
    b.response.grossTotal,
    false,
  );
  say(
    `   ${name} kintlevoseg (valasz): ${b.response.outstanding ?? "a valasz nem adja"} (mienk: fizetendo ${payable.toFixed(2)}${paid ? ", fizetve jelolve" : ""})`,
  );
  const payRows = linesWith(b.text, /fizetend/i);
  compare(
    `${name} fizetendo (PDF)`,
    payable,
    payRows.some((t) => hasAmount(t, payable)) ? payable : null,
  );
  say(`   a PDF "Fizetendo" sorai: ${JSON.stringify(payRows)}`);
  say(
    `   a PDF eloleg-sorai: ${JSON.stringify(linesWith(b.text, /el[őo]leg/i))}`,
  );
  if (paid)
    say(
      `   a PDF fizetve-sorai: ${JSON.stringify(linesWith(b.text, /kiegyenl|p[ée]nz[üu]gyi rendez/i))}`,
    );
}

if (DRY) {
  say(
    "SZARAZ FUTAS KESZ: a keresek a kimeneti mappaban; a Szamlazz.hu-oldali osszevetes nem futott.",
  );
  finish(0);
}
say(
  differences
    ? `EREDMENY: ${differences} elteres vagy nem olvashato ertek (a PDF szovege a kimeneti mappaban)`
    : "EREDMENY: minden osszevetes egyezik, filler-re",
);
finish(differences ? 1 : 0);
