/**
 * THE BUILT-IN STARTING TEXT of the rental contract: acrobot's draft (exchange/eszkozberles/berleti-szerzodes-vazlat-2026-11-06.md),
 * awaiting Balázs's legal review. It is only the starting point: once anyone saves a text under Settings > Bérleti szerződés,
 * that text is printed instead (Balázs: "a szöveg cserélhető legyen, ne beégetett").
 *
 * What the system does not know (the full tax number, the company register number, the representative, the privacy notice's
 * address) stands as `[kitöltendő: ...]`, visible on paper until someone fills it in the editor. The return sheet at the end
 * is printed blank: the desk fills it by hand at the return (S4 will print the measured values).
 */
export const DEFAULT_RENTAL_CONTRACT_TEMPLATE = `## 1. A felek

Bérbeadó: {{ceg_nev}}, székhely: {{ceg_szekhely}}, adószám: [kitöltendő: adószám], cégjegyzékszám: [kitöltendő: cégjegyzékszám], képviseli: [kitöltendő: képviselő] (a továbbiakban: Bérbeadó)

Bérlő: {{berlo_nev}}, cím: {{berlo_cim}}, telefon: {{berlo_telefon}}, e-mail: {{berlo_email}} (a továbbiakban: Bérlő)

## 2. A bérlet tárgya

Megnevezés: {{eszkoz_nev}}
Gyári szám: {{eszkoz_gyari_szam}}
Tartozékok: {{eszkoz_tartozekok}}

A Bérlő az átadáskor megvizsgálta az eszközt, és azt hiánytalan, működőképes állapotban vette át, kivéve: {{atadaskori_megjegyzes}}

## 3. A bérlet időtartama

Kezdete: {{berles_kezdete}}
Tervezett visszahozás: {{tervezett_visszahozas}}

A bérleti időt a Bérbeadó előzetes, írásbeli (e-mail is elfogadott) hozzájárulásával lehet meghosszabbítani.

## 4. Bérleti díj és kaució

Napi bérleti díj: {{napi_dij}}
Várható bérleti díj a tervezett időtartamra: {{varhato_dij}}
Kaució: {{kaucio}}, amelyet a Bérlő az átadáskor megfizetett.

A bérleti díj a megkezdett napok után jár, a tényleges visszahozás időpontja alapján. A kezdéstől számított minden megkezdett 24 óra egy napnak számít.

A Bérbeadó a kauciót a visszavételkor, az eszköz átvizsgálása után visszafizeti. A kaucióból levonhatja a meg nem fizetett bérleti díjat, a késedelmes visszahozás díját, valamint a rendeltetésszerű használatot meghaladó kopás, sérülés, hiányzó tartozék vagy szükséges tisztítás költségét. A levonás okát és összegét a visszavételi lapon rögzíti.

## 5. A Bérlő kötelezettségei

5.1. Az eszközt rendeltetésszerűen, a gyártói előírások és a Bérbeadó tájékoztatása szerint használja.
5.2. Az eszközt harmadik személynek tovább nem adhatja, albérletbe nem adhatja, nem alakíthatja át.
5.3. Az eszköz meghibásodását vagy sérülését haladéktalanul jelzi a Bérbeadónak, és a javítását maga nem kísérli meg.
5.4. A bérleti idő alatt az eszköz elvesztéséért, megsemmisüléséért és sérüléséért felel, kivéve, ha bizonyítja, hogy az a rendeltetésszerű használat mellett, neki fel nem róható okból következett be.
5.5. Az eszközt a tervezett visszahozás időpontjában, tisztán, tartozékaival együtt a Bérbeadó üzletében adja vissza.

## 6. Késedelmes visszahozás

Ha a Bérlő az eszközt a tervezett időpontig nem hozza vissza, és a bérletet nem hosszabbították meg, a késedelem minden megkezdett napjára a napi bérleti díj {{kesedelmi_szorzo}}-szorosát fizeti. Ha a késedelem a {{kesedelem_napok}} napot meghaladja, a Bérbeadó jogosult az eszköz teljes pótlási értékét ({{potlasi_ertek}}) követelni, a kaució beszámításával.

## 7. A Bérbeadó felelőssége

A Bérbeadó szavatolja, hogy az eszköz az átadáskor működőképes. Az eszköz használatából eredő, a Bérlő vagy harmadik személy vagyonában (különösen az akváriumban és annak élőlényeiben) keletkezett kárért a Bérbeadó csak akkor felel, ha a kár az eszköz átadáskor már meglévő hibájából ered, és ezt a Bérlő bizonyítja. A felelősség mértéke legfeljebb a megfizetett bérleti díj összege, kivéve a szándékos vagy súlyosan gondatlan károkozást, valamint az életet, testi épséget, egészséget megkárosító szerződésszegést.

## 8. Adatkezelés

A Bérbeadó a Bérlő itt megadott személyes adatait a szerződés teljesítése és a számviteli kötelezettségei teljesítése céljából kezeli, a [kitöltendő: az adatkezelési tájékoztató címe] címen elérhető adatkezelési tájékoztató szerint.

## 9. Egyéb rendelkezések

A szerződésben nem szabályozott kérdésekben a Polgári Törvénykönyv (2013. évi V. törvény) bérletre vonatkozó szabályai irányadók.

A szerződés két egyező példányban készült, amelyből egy a Bérlőt illeti.

Kelt: Budapest, {{kelt_datum}}


[[alairas]]

## Visszavételi lap (a visszahozáskor töltendő)

Tényleges visszahozás: ______________________________
Megkezdett napok száma: ______________________________
Fizetendő bérleti díj: ______________________________ Ft
Levonás a kaucióból: ______________________________ Ft, oka: ______________________________
Visszafizetett kaució: ______________________________ Ft


[[alairas]]
`;
