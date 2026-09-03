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
   * ES EGY HATAR, AMI A SZAM OLVASASAHOZ KELL (barracuda merese, 2026-09-03):
   * a fenti 589 KET mezot fed (a hasonlo es a kiegeszito listajat). A kod
   * viszont OT tovabbit is cikkszam-listakent olvas (`crosssale1..3`,
   * `upsale1..2`), es abban a forras-exportban azok NEM termekhivatkozast
   * tartalmaznak, hanem kapcsolokat ("Cart": "no" es tarsai).
   *
   * HA ILYEN ERTEK BEKERUL a `rawPayload`-ba azzal a kulccsal, ez a szamlalo
   * OKET IS SZAMOLNI FOGJA -- egy "no" nevu cikkszamot sosem talalunk meg. A
   * szam akkor nem 589 korul all, hanem sokkal feljebb, es a tobblet NEM
   * adatvesztes, hanem zaj.
   *
   * EZT A KODBOL NEM LEHET ELDONTENI: attol fugg, van-e ilyen nevu oszlop a
   * betoltott munkafuzetben. Acrobot lemerte a UNAS API-exportjat (2026-09-03):
   * ott a `CrossSale` es az `UpSale` mind az 1893 soron BEAGYAZOTT OBJEKTUM,
   * kapcsolokkal (`{Cart: "no", ...}`). De az EGY MASIK ALAK: a mi betoltonk
   * XLSX-et olvas, `crosssale1..3` nevu OSZLOPOKAT keresve, es munkafuzet
   * nincs a fankban. Az egyik alakbol a masik oszlopneveire nem lehet
   * kovetkeztetni.
   *
   * EZERT NEM BECSLES ALL ITT, HANEM ELOREJELZES, es a mezonkenti bontas
   * (`relationReferencesByField`) magatol eldonti az elso futasnal.
   *
   * EZ A SZAMLALO NEM JAVITJA A PAROSITAST, es szandekosan nem: hogy a
   * feloldas kis-nagybetu fuggetlen LEGYEN-E, az adatmodell-kerdes (ket termek
   * felvehet "ABC" es "abc" cikkszamot). Ez a mezo csak annyit valtoztat, hogy
   * a vesztes NYOMOT HAGY.
   */
  unresolvedRelationReferences: number;
  /**
   * HANY HIVATKOZAS OLDODOTT FEL KIS-NAGYBETU FUGGETLEN VISSZAESESSEL.
   *
   * A UNAS forrasa ugyanarra a termekre hol a katalogusbeli, hol a teljesen
   * kisbetus cikkszam-alakkal hivatkozik. Merve (barracuda, 2026-09-03): 589
   * hivatkozas 58 egyedi cikkszamon all rossz irasmoddal, es UGYANEZEKRE a
   * cikkszamokra 1798 HELYES alaku hivatkozas is all -- vagyis nem egy
   * lekisbetusito lepesrol van szo, hanem arrol, hogy a forras vegyesen ir.
   *
   * EZ A SZAM NEM "IDEIGLENES TAPASZ". Az UNAS az a forras, amibol KIFELE
   * megyunk; egy betolto, ami ismeri a forrasrendszer irasmod-hanyagsagat es
   * szamol is rola, helyesen viselkedik. A celoldalon mar a helyes alak all.
   *
   * ES AMIERT SZAMOLJUK, NEM CSAK CSINALJUK: ma egy NEMA VESZTES all fenn (589
   * hivatkozas eldobodik, es senki nem latja). Ha a visszaeses csendben javit,
   * akkor nema vesztest cserelunk NEMA JAVITASRA -- a vevonek jobb, nekunk nem.
   * Ha ez a szam egyszer nullara esik, az azt jelenti, hogy a FORRAS javult meg,
   * es azt tudni akarjuk.
   */
  relationReferencesResolvedByCaseFallback: number;
  /**
   * HANY HIVATKOZASNAL A VISSZAESES TOBB TERMEKET TALALT, ezert NEM oldottuk fel.
   *
   * A visszaeses CSAK akkor lep, ha PONTOSAN EGY talalatot ad. Ket termek
   * ("ABC" es "abc") eseten nem tippelunk: a hivatkozas feloldatlan marad, es
   * ITT szamolodik -- kulon a nem-talalattol, mert a ket eset teendoje mas.
   *
   * MA EZ A SZAM MINDIG NULLA, ES EZT KI KELL MONDANI (acrobot kikotese,
   * 2026-09-03). Merve a 2026-09-02 22:01-es exportbol: 1893 termek, 1893
   * egyedi pontos cikkszam, 1893 egyedi KISBETUSITETT alak -- nulla utkozes. A
   * mero tud utkozest talalni (egy mesterseges swapcase par azonnal egyet ad),
   * tehat a nulla nem a kerdes tulajdonsaga.
   *
   * VAGYIS A FELTETEL MA NEM SZUR, HANEM TARTALEK egy jovobeli katalogusra. A
   * kulonbseg akkor szamit, amikor valaki azt kerdezi, mit vedett: ma semmit,
   * es ez rendben van.
   */
  relationReferencesAmbiguous: number;
  /**
   * HANY HIVATKOZAST HAGYTUNK KI DUPLIKATUMKENT.
   *
   * Egy termek listajan ugyanaz a cel ketszer is szerepelhet -- tipikusan a
   * helyes es a kisbetus alak PARBAN (merve: 269 par, es pontos irasmoddal
   * NULLA ismetlodes). Ma ez a par csendben feloldodik egyre, mert a kisbetus
   * tag fel sem oldodik; a visszaeses utan MINDKETTO feloldodik, es a masodikat
   * a `seen` halmaz viszi el.
   *
   * A SZAMLALO AZERT KELL, MERT A JAVITAS EGY NEMA VESZTEST EGY MASIK NEMA
   * KIHAGYASRA CSERELNE. A `unresolvedRelationReferences` a javitas utan
   * nullara esik -- vagyis epp akkor mutatna nullat, amikor a legtobb dolog
   * tortenik. Ez a szam mondja meg, hogy a 269 nem eltunt, hanem osszevonodott.
   */
  relationReferencesSkippedAsDuplicate: number;
  /**
   * MEZONKENTI BONTAS: melyik forras-oszlopbol hany hivatkozas NEM oldodott fel.
   *
   * MIERT NEM ELEG AZ OSSZEG (acrobot kikotese, 2026-09-03): a betolto HET
   * oszlopot olvas cikkszam-listakent (`kiegeszitotermekek`, `crosssale1..3`,
   * `hasonlotermekek`, `upsale1..2`), es barracuda merese csak KETTOT fed --
   * a hasonlo es a kiegeszito listajat. Ha a munkafuzetben a tobbi oszlop
   * KAPCSOLOKAT tartalmaz ("no", "yes"), azok sosem oldodnak fel, es az
   * osszegben megkulonboztethetetlenul allnanak a valodi vesztestol.
   *
   * A BONTASSAL AZ ELSO ELES FUTAS MAGATOL VALASZOL, magyarazat nelkul: ha a
   * feloldatlanok a `crosssale*` vagy `upsale*` oszlopokbol jonnek, akkor a
   * teendo a MEZOLISTA szukitese, nem a parositas.
   *
   * ES A VARHATO BONTAS, hogy az elso futas ELLENORIZHETO legyen, ne
   * ertelmezheto (barracuda merese, 2026-09-03):
   *
   *     589  hivatkozas oldodik fel visszaesessel
   *     320  ebbol UJ kapcsolatot hoz letre
   *     269  a par masodik tagja, a szures kihagyja (145 hasonlo + 124 kiegeszito)
   *       0  marad feloldatlan -- DE CSAK A MEZOLISTA SZUKITESEVEL EGYUTT
   *
   * A NEGYEDIK SOR FELTETELE AZOTA ELDOLT, ES NEM MAGATOL TELJESUL. Barracuda
   * megmerte a valodi munkafuzet-exportot: a `crosssale1..3` es az `upsale1..2`
   * oszlop 0/1 KAPCSOLOKAT tartalmaz, es MINDEN sorban van erteke. Amig ezek a
   * mezok a listaban vannak, a szamlalo NEM nullara esik, hanem FELFELE megy:
   * kb. 949-re (ha a nulla uresnek szamit) vagy kb. 9465-re (ha nem) -- es az
   * egesz tobblet ZAJ, nem adatvesztes.
   *
   * A szukites kulon valtozasban all. Amig az nincs bent, a fenti negyedik sor
   * NEM ervenyes, es egy nem-nulla szamlalo nem lelet, hanem a mezolista
   * kovetkezmenye.
   *
   * Csak a NEM NULLA mezok kerulnek bele: egy ures bontas azt jelenti, hogy
   * minden hivatkozas feloldodott.
   */
  relationReferencesByField: Record<string, number>;
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
