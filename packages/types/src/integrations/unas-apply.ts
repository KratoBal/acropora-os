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
  /**
   * IRTUNK-E EGYALTALAN KAPCSOLATOT EBBEN A FUTASBAN.
   *
   * A `relationsSynchronized` nullaja KET allapotbol jon: vagy nem volt mit
   * irni, vagy a hivo NEM KERTE a kapcsolat-irast. A ketto teendoje mas, es a
   * szam onmagaban nem valasztja szet oket -- ezert all itt ez a mezo.
   */
  relationWriteRequested: boolean;
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
  // A TELJES VESZTES KET SZAM OSSZEGE: ez es az `unresolvedRelationReferences`.
  // Az utkozo hivatkozas NEM kerul a feloldatlanok koze es a mezo-bontasba sem,
  // mert ott mas a teendo: nem a mezolistat kell szukiteni, hanem a
  // katalogusban all ket osszeteveszthető cikkszam.
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
   * HANY HIVATKOZAST HAGYTUNK KI, MERT A TERMEK ONMAGARA MUTAT.
   *
   * A HARMADIK KIHAGYASI OK, ES EDDIG EZ VOLT AZ EGYETLEN, AMIT SEMMI NEM
   * SZAMOLT. A betolto harom okbol dob el egy MAR FELOLDOTT hivatkozast:
   *
   *     onhivatkozas  ->  ez a szamlalo
   *     duplikatum    ->  `relationReferencesSkippedAsDuplicate`
   *     utkozes       ->  `relationReferencesAmbiguous`
   *
   * ES AMIERT EPP MOST KELL: a kis-nagybetu fuggetlen visszaeses (#404)
   * MEGNOVELI a szamat. Merve a 2026-09-02 22:01-es exporton (`termekek.xml`,
   * 1893 adatsor), a betolto sajat szabalyaival, ketszer futtatva -- egyszer a
   * visszaesessel, egyszer nelkule:
   *
   *     ma:     2 onhivatkozas (ezek pontos irasmoddal is illeszkednek)
   *     utana: 32 onhivatkozas (a tobbi 30 CSAK a visszaeses utan valik azza)
   *
   * VAGYIS A VISSZAESES-SZAMLALO TOBBET IGER, MINT AMENNYIT SZALLIT: az 589
   * feloldott hivatkozasbol 290 lesz uj kapcsolat, 269 a par masodik tagja, es
   * 30 sajat magara mutat. E nelkul a szamlalo nelkul a harmincat semmi nem
   * mondja meg, es a kulonbseg ugy nezne ki, mint egy megmagyarazatlan hiany.
   *
   * A TEENDOJE MAS, MINT A MASIK KETTONEK, es ezert all kulon szamlalon: egy
   * onhivatkozas nem adatvesztes es nem is katalogus-hiba, hanem a FORRAS
   * szerkesztesi szokasa. Ha ez a szam elszalad, az a forrasrol mond valamit,
   * nem a parositasunkrol.
   */
  relationReferencesSkippedAsSelfReference: number;
  /**
   * MEZONKENTI BONTAS: melyik forras-oszlopbol hany hivatkozas NEM oldodott fel.
   *
   * MIERT NEM ELEG AZ OSSZEG (acrobot kikotese, 2026-09-03): amikor ez a mezo
   * keszult, a betolto HET oszlopot olvasott cikkszam-listakent, es ebbol csak
   * ketto tartalmazott valodi hivatkozast. A #405 ota a lista KET oszlop
   * (`kiegeszitotermekek`, `hasonlotermekek`), tehat a tobblet-zaj kerdese
   * eldolt -- a bontas viszont marad, mert az mondana meg, ha egy KESOBB
   * felvett oszlop megint nem cikkszamokat tartalmazna.
   *
   * A BONTASSAL AZ ELSO ELES FUTAS MAGATOL VALASZOL, magyarazat nelkul: ha
   * megis erkezik feloldatlan, a bontas megnevezi, MELYIK oszlopbol -- es abbol
   * latszik, hogy a mezolistat kell-e szukiteni vagy a parositast nezni.
   *
   * ES A VARHATO BONTAS, hogy az elso futas ELLENORIZHETO legyen, ne
   * ertelmezheto (barracuda merese, 2026-09-03):
   *
   *     589  hivatkozas oldodik fel visszaesessel, es HAROM fele valik:
   *     290    uj kapcsolatot hoz letre  (31680 -> 31970 kapcsolat a ket oszlopbol)
   *     269    a par masodik tagja, a szures kihagyja (145 hasonlo + 124 kiegeszito)
   *      30    a termek ONMAGARA mutat
   *       0  marad feloldatlan
   *
   * A KORABBI ALAK ITT 320-AT MONDOTT, ES AZ HAMIS VOLT: 589 minusz 269, vagyis
   * kimaradt a harmadik kihagyasi ok, az onhivatkozas. 589 = 290 + 269 + 30.
   *
   * ES EGY SZAM, AMI HELYESNEK LATSZIK, ES MEGSEM EZ: 448. Ennyi hivatkozast old
   * fel a visszaeses UGY, hogy kapcsolat lesz belole -- de ebbol 158 olyan
   * kapcsolat, amit MA IS letrehoz egy pontos irasmodu hivatkozas. A visszaeses
   * ott nem letrehoz, hanem ELVESZI A HELYET a dedup `seen` halmazaban, es a
   * pontos parja atkerul a duplikatum-szamlalora (ezert megy az 0-rol 269-re).
   * 448 - 158 = 290. A 448 tehat ATTRIBUCIO (melyik uton keletkezett), nem
   * EREDMENY (mennyivel tobb kapcsolat all) -- es EGYETLEN szamlalon sem fog
   * megjelenni. Merve ket teljes futas halmaz-kulonbsegevel: 290 uj kapcsolat,
   * nulla eltuno.
   * Merve ugyanazon az exporton, a betolto szabalyaival, ketszer futtatva (a
   * visszaesessel es nelkule); ugyanaz a futas adja ki az 589-et, a 269-et es a
   * 145/124 bontast is, tehat a 290 nem egy masik modszerbol jon.
   *
   * A NEGYEDIK SOR FELTETELE AZOTA ELDOLT: a #405 kivette a `crosssale1..3` es
   * `upsale1..2` oszlopokat, mert azok 0/1 KAPCSOLOKAT tartalmaznak minden
   * soron. Amig azok bent voltak, a szamlalo nem nullara esett volna, hanem
   * felfele ment volna kb. 9465-ig -- es az egesz tobblet ZAJ lett volna, nem
   * adatvesztes.
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
