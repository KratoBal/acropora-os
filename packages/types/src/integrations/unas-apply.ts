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
   * visszamerve): 589 hivatkozas veszett el igy, 73 cikkszambol -- es
   * kis-nagybetu fuggetlenul NULLA hivatkozott cikkszam hianyzik a
   * katalogusbol. Vagyis mind letezo termek volt, csak mas irasmoddal.
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
