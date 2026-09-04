/**
 * AMIKOR TAROLT NYERS UNAS VALASZBOL OLVASOL BEAGYAZOTT LISTAT -- EZ KELL.
 *
 * EZ A KIVALTO JEL, es szandekosan ez all a leiras elejen, nem az, hogy a
 * fuggveny mit csinal. Nalunk merve egy jol megirt eljaras azt vedi meg, aki
 * mar tudja, hogy keresnie kell, tehat pont azt nem, aki bele fog futni. Ha
 * tehat a `UnasProductSnapshot.rawPayload` (vagy barmi mas, amit a
 * `nodePayload` allitott elo) egy BLOKKJABOL akarsz ELEMEKET kiolvasni --
 * `Statuses.Status`, `PackageComponents.Component`, `Images.Image` es tarsai --,
 * akkor ide jutottal, es NEM irhatsz `Array.isArray`-t sajat kezzel.
 *
 * A MECHANIZMUS. A nyers valaszt eloallito `nodePayload` CSAK AKKOR csinal
 * tombot, ha UGYANAZ az elemnev tobbszor szerepel. Egyetlen gyerek eseten
 * OBJEKTUM lesz belole, nem egyelemu tomb. Egy csak tombre iro olvaso ilyenkor
 * CSENDBEN nullat vagy ureset ad: nem all meg, nem szol, a jelentes zold. A
 * hiba tehat nem a mai adaton latszik, hanem azon, amelyiken egy termeknek
 * eppen EGY kepe, EGY statusza vagy EGY komponense van.
 *
 * UGYANEZ A SZABALY KET HELYEN AL, ES A MASIKAT NEM LEHET IDE HOZNI. Az SQL
 * fele a `20260731110000_add_unas_package_products_and_stock_snapshot`
 * migracioban van, `jsonb_typeof` szerinti `array` / `object` / `ELSE '[]'`
 * agakkal. Ez a fuggveny SZANDEKOSAN pontosan azt a harom agat kepezi le, hogy
 * a ketto osszevetheto maradjon. Ha itt valtozik a szabaly, ott is valtoznia
 * kell.
 *
 * AMIRE NEM VALO: LEVELERTEKEK LISTAJA. Ha egy blokk gyerekei nem elemek,
 * hanem puszta szovegek (`<Tags><Tag>a</Tag><Tag>b</Tag></Tags>`), akkor egy
 * elem eseten SZOVEG all ott, es ez a fuggveny ures listat ad ra. Ez nem
 * feledekenyseg: ugyanabbol a szovegbol nem lehet megkulonboztetni az URES
 * blokkot (`<Images></Images>` szinten `""`) az egyetlen levelertektol. Ha ilyen
 * mezot olvasol, az kulon dontes, es kulon fuggveny.
 *
 * NEGY HELY, AMI RANEZESRE EBBE A CSAPDABA ESIK, ES MEGSEM. Ezeket egyszer mar
 * vegigmertuk; ide azert kerulnek, hogy a kovetkezo atnezes ne mérje ujra:
 *
 *   1. A UNAS KLIENS OSSZES XML-OLVASOJA (`unas-api.client.ts`). A `child` es a
 *      `children` az `XmlNode.children` VALODI tombjet szuri, tehat darabszamtol
 *      fuggetlenul mindig listat ad. Az `Images.Image` is ezen az uton jon, es
 *      egy egyetlen `<Image>` elemet tartalmazo fixtura mar ma is all a
 *      tesztekben. A kliens NEM a tarolt nyers valaszbol dolgozik.
 *   2. A `UnasProductSnapshot.parameters` OSZLOP. A kliens `parameterRows`
 *      fuggvenye tolti, szinten `children(...)`-en at, tehat valodi tomb kerul
 *      bele. Az olvasoja (`parameterWords`) raadasul rekurzivan jar be, vagyis
 *      alakfuggetlen.
 *   3. A `parseUnasPackageComponents` ES A `parseStoredUnasVariantValues`. Ezek
 *      a MI SAJAT, mar normalizalt `[{...}]` oszlopainkat olvassak, nem a
 *      szolgaltatoi valaszt. A `packageComponents` oszlopot epp a fenti migracio
 *      tolti fel, mar listakent.
 *   4. Az `unas-apply.repository.ts` `rawText` OLVASOJA. Az XLSX-bol epitett
 *      `rawPayload`-ot eri el, ami LAPOS, es a kulcsai kisbetusek (`sefurl`,
 *      `termeklink`). Az a szerkezet nem a `nodePayload` muve, tehat a csapda
 *      ott elo sem all.
 */
export function unasRawList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

/**
 * UGYANAZ, DE MAR CSAK AZ OBJEKTUM-ELEMEKKEL.
 *
 * A hivok tobbsege mezoket olvas az elemekbol, tehat a normalizalas utan
 * amugy is szurne. Kulon all, hogy a szures DONTES legyen, ne mellekhatas: aki
 * a nyers elemeket akarja latni, az `unasRawList`-et hivja.
 */
export function unasRawRows(value: unknown): Record<string, unknown>[] {
  return unasRawList(value).filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && !Array.isArray(item),
  );
}
