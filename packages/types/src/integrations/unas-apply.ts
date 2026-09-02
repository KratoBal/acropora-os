export interface UnasApplySummary {
  batchId: string;
  status: "APPLIED";
  categoriesCreated: number;
  categoriesUpdated: number;
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  imagesSynchronized: number;
  categoryLinksSynchronized: number;
  relationsSynchronized: number;
  channelListingsSynchronized: number;
  externalReferencesSynchronized: number;
  domainEventsCreated: number;
  unresolvedBrandAssociations: number;
  /**
   * HANY KAPCSOLODO-TERMEK HIVATKOZAS NEM OLDODOTT FEL.
   *
   * A UNAS a kapcsolodo termekeket (hasonlo, kiegeszito, cross-sale, up-sale)
   * CIKKSZAMMAL hivatkozza, es a feloldas KIS-NAGYBETU ERZEKENY. Ha egy
   * hivatkozott cikkszam mas irasmoddal all a katalogusban, a feloldas nem
   * talal -- es eddig a kod CSENDBEN tovabblepett: nem nott a letrehozott
   * kapcsolatok szama, es semmi nem jelezte, hogy elveszett valami. A
   * felhasznalo URES kapcsolodo-listat latott, nem hibat.
   *
   * Merve (barracuda, 2026-09-02, kartya b609d3e6, acrobot altal fuggetlenul
   * visszamerve): 589 hivatkozas veszett el igy, 58 EGYEDI cikkszambol -- es
   * kis-nagybetu fuggetlenul NULLA hivatkozott cikkszam hianyzik a
   * katalogusbol. Vagyis mind letezo termek volt, csak mas irasmoddal.
   *
   * A SZAM ELOSZOR 73 VOLT, ES AZ OSSZEADAS HIBAJA: a hasonlo agon 33, a
   * kiegeszito agon 40 hibas cikkszam all, de KOZULUK 15 MINDKET agon
   * szerepel. Az egyedi darabszam ezert 58. A hivatkozasok szama (589)
   * valtozatlan -- az a ket agon kulon szamolodik, es ott a duplikacio nem
   * hiba.
   *
   * ES A HIBAS ALAK MIND AZ 58 ESETBEN UGYANAZ: a katalogusbeli cikkszam
   * TELJESEN KISBETUS valtozata. Nem vegyes irasmod, nem elgepeles.
   *
   * MEGMERTEM, HOGY A MI IMPORTUNK KISBETUSIT-E, ES NEM: a XLSX-parser csak a
   * FEJLEC-kulcsokat normalizalja (`key()`), az ertekeket erintetlenul teszi a
   * `rawPayload`-ba; a `rawText` es a `splitReferences` nem nyul hozzajuk; az
   * apply-tarolo teljes fajljaban NULLA `toLowerCase` all (kontroll: a
   * parserben ketto, tehat a kereses lat). A staging sorok pedig CSAK a
   * parseren at jonnek -- az API-kliens nem ad kapcsolodo-termek mezot.
   *
   * Vagyis a kisbetus alak a FORRASBAN all igy, nem mi allitjuk elo. Ez azert
   * szamit, mert egy "szuntessuk meg a forrast" javitasnak nincs hol
   * megtortennie a mi kodunkban.
   *
   * EZ A SZAMLALO NEM JAVITJA A PAROSITAST, es szandekosan nem: hogy a
   * feloldas kis-nagybetu fuggetlen LEGYEN-E, az adatmodell-kerdes (ket termek
   * felvehet "ABC" es "abc" cikkszamot). Ez a mezo csak annyit valtoztat, hogy
   * a vesztes NYOMOT HAGY.
   */
  unresolvedRelationReferences: number;
  durationMs?: number;
  appliedAt: string;
  appliedBy: string;
}

export interface UnasApprovalResult {
  batchId: string;
  status: "APPROVED";
  approvedAt: string;
  approvedBy: string;
  reviewedRows: number;
}
