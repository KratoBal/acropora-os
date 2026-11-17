/**
 * AZ ÁR-MEGÁLLÁS FAJTÁINAK MAGYAR FELIRATA ÉS TEENDŐJE (task t-20261117-arstop-web).
 *
 * A kulcsok a szerver fajtanevei (`priceFailureKind` az `medusa-price-sync.ts`-ben); a szerver mondja meg, melyik fajta vár EMBERRE
 * (`needsPerson`), a felület csak a szöveget adja hozzá. Az ISMERETLEN fajta nyersen jelenik meg (egy új fajta nem tűnhet el, és nem
 * kap kitalált magyar szöveget): a teszt minden ismert fajtára megköveteli a feliratot.
 */
export const PRICE_STOP_KIND_LABELS: Readonly<Record<string, string>> = {
  // emberi adat-állapotok: a termék ára nem megy ki, amíg valaki nem rendezi
  "own-price-missing": "Nincs saját eladási ár megadva",
  "price-not-whole-forint": "Az ár nem egész forint",
  "mirror-price-missing": "A UNAS-tükörben nincs a termékhez ár",
  "mirror-row-missing": "A UNAS-tükörben nincs a termékről sor",
  "authority-unknown": "Nincs eldöntve, melyik rendszer a termék gazdája",
  "price-negative": "Negatív ár",
  "ambiguous-price": "A boltban egy változathoz több ár áll",
  "foreign-currency-price-present": "A boltban idegen pénznemű ár is áll",
  "ambiguous-variant": "Nem egyértelmű, melyik bolti változat a miénk",
  // futási hibák: a vetítés magától újrapróbálja
  "medusa-read-failed": "A bolt olvasása nem sikerült",
  "medusa-write-failed": "A bolt írása nem sikerült",
  "write-not-visible": "A kiírt ár nem látszik a boltban",
  "prices-not-returned": "A bolt nem adta vissza az árakat",
  "variant-lookup-truncated": "A bolti változatlista csonka",
  "tax-inclusive-not-set": "A bolt régiójában nincs bruttó árképzés beállítva",
  "no-product-link": "A terméknek nincs bolti párja",
  "variant-not-found": "A bolti termékből hiányzik a változat",
  "variant-identity-chain-broken": "A változat azonosítási lánca megszakadt",
  "run-threw": "Az ár-futás hibával állt le",
  "run-failed": "Az ár-futás elbukott (például a bolt hitelesítése)",
  truncated: "A tárolt ok csonka, a fajtája nem olvasható",
  other: "Ismeretlen alakú üzenet",
};

/**
 * MIT KELL TENNI, egy mondatban: CSAK az emberi adat-állapotokra, és csak azt, ami a vetítő kódjából biztosan következik. Ahol a teendő
 * nem egyértelmű (a boltban álló több ár, a változat-azonosítás), a felirat nem állít javítást.
 */
export const PRICE_STOP_KIND_HINTS: Readonly<Record<string, string>> = {
  "own-price-missing":
    "Add meg a változat saját bruttó eladási árát (a változat az ok szövegében, a cikkszámánál áll).",
  "price-not-whole-forint":
    "Az ár tört forint vagy ábrázolhatatlanul nagy: a forrásánál (saját ár vagy UNAS) egész forintra kell javítani.",
  "mirror-price-missing":
    "A termék UNAS-beli bruttó ára hiányzik: a UNAS-ban kell megadni, a következő import áthozza.",
  "mirror-row-missing": "A UNAS importnak kell lefutnia erre a termékre.",
  "authority-unknown": "Dönteni kell, melyik rendszer a termék gazdája.",
  "price-negative": "Az ár nem lehet negatív.",
};

export function priceStopKindLabel(kind: string): string {
  return PRICE_STOP_KIND_LABELS[kind] ?? kind;
}

export function priceStopKindHint(kind: string): string | null {
  return PRICE_STOP_KIND_HINTS[kind] ?? null;
}
