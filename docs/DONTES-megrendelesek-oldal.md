# A Megrendelések oldal eldöntött kérdései

Ez a lap a `MERCE-megrendelesek-oldal.md` **párja**. A mérce azt mondja meg, mit láttunk a mai
UNAS admin oldalán; ez azt, hogy ebből mi lett **döntés**, ki döntötte el, és mi döntötte el.

Balázs a tervet elfogadta, szó szerint: „a design egyebkent tetszik, elfogadtam" (Discord,
Megrendelések frontend szál, 2026-09-02 18:05).

**Minden pontnál ott áll, hogy MÉRÉS vagy BALÁZS SZAVA döntötte el.** Ami egyiken sem áll,
az acrobot döntése, tehát felülvizsgálható.

---

## 1. A lap az Acropora OS-ben él, nem a Medusa adminban

**Balázs szava, 2026-09-02 16:05:** „jo lenne kozpontositani a feluleteinket es nem 3-4 lapon
kezelni a ceget".

**Ez felülírja a mérce 5. szakaszát.** Ott az áll, hogy a Medusa admin bővítése a jobb út.
Az a javaslat egy szempontot nem ismert: a Medusa admin **külön felület, külön címen**, tehát
pont egy újabb lapot hozna létre, ahelyett hogy csökkentené a számukat.

Ma négy helyen kezeli a céget: Acropora OS (app.acropora.hu), Medusa admin
(commerce.acropora.hu:9000), UNAS admin, telefonos alkalmazás.

**Következmény a kódra:** a lap az `apps/web`-ben épül, az adat pedig a Commerce felől jön
API-n. A lista, a szűrők és a lapozás a miénk, nem örökölt.

## 2. Alapértelmezett nézet: „Nyitott", nem minden

**MÉRÉS döntötte el, nem ízlés.** 719 rendelésből 692 lezárt vagy sikertelen, 26 aktív (polip
mérése, 12 hónap, 2025-09-02-től). Egy mindent mutató lista a 26 lényeges sort 692 közé
rejtené.

## 3. A státusz a soron van, hat színnel, és mindegyikhez SAJÁT IKON

A szín a mérce 2. szakaszából jön. Az ikon **hozzáadás**: szín önmagában nem olvasható
mindenkinek.

Picasso saját visszamérése fogta meg, hogy két sor kezdetben ugyanazt az ikont kapta. Vagyis
az „ikon is legyen" szabály nem elméleti: első nekifutásra el is romlott.

## 4. Az idő MINDEN soron látszik („3 napja"), nem hover alatt

**Indok:** a mai bolt hoverre bízza, de **érintőképernyőn a hover nem létezik**. A minta itt
tudatosan el lett vetve.

A forrás megvan: a státuszváltások története külön modellben áll (PR 34), tehát ez
megjelenítés, nem új munka.

## 5. A tizenegy szűrőből négy marad, a nyelv és a pénznem KIESIK

Nem becsukva, hanem **elhagyva**. MÉRÉS: mind a 719 rendelés HUF és magyar, kivétel nélkül
(polip, pozitív kontrollal: ugyanaz az eszköz a Status mezőn 7 különböző értéket talált,
tehát nem mos össze mindent).

**A HATÁR: 12 hónap.** Korábbi rendelésekről ez a mérés nem nyilatkozik.

**A VISSZAHOZÓ FELTÉTEL, kimondva:** ha legalább egy rendelésen más pénznem vagy nyelv áll,
mind a kettő visszaépül.

## 6. Telefonon kártya, nem összenyomott táblázat

Három adat: az állapot, mennyi ideje áll úgy, és kihez tartozik.

## 7. Az elavulási küszöb: állítható érték PLUSZ külön kapcsoló

**Balázs két lépésben mondta, és a második az érvényes.**

- 17:58: „az elavulasi kuszobot epitsuk be de allithato legyen az erteke. ha 0 irunk be akkor
  ne jelezzen"
- 18:05, ugyanarról: „akkor ki lehessen kapcsolni ugy, hogy az ertek ami az idore vonatkozik
  benne marad (termeszetesen atirhatoan)"

**A különbség nem stílus:** a nulla beírása a SZÁMOT írná felül, tehát egy kikapcsolás
elvesztené a beállított küszöböt. Külön kapcsoló mellett a szám megmarad, és
visszakapcsoláskor nem kell újra kitalálni.

**acrobot döntése ebből:** a nulla mint külön jelentésű érték kiesik. Két mechanizmus egy
viselkedésre két helyen romlik el.

## 8. A státusz forrása a RÉSZLETES magyar mező, nem a gépi kód

**MÉRÉS, és ez a mérés fő lelete:** a gépi `StatusType` NÉGY értéket különböztet meg, a magyar
`Status` HETET. Az `open_normal` kód EGYBEN fedi le a négy köztes állapotot: Feldolgozásra vár
13, Kiszállítás 6, Átvehető 4, Készletezés alatt 3, összesen 26 rendelés.

**Aki a kódra épít** (mert az stabilabbnak és nyelvfüggetlennek látszik), az négy állapotot
csendben eggyé mos, **és a hiba nem hibaüzenettel jelentkezik**, hanem azzal, hogy minden
köztes rendelés ugyanoda kerül.

A hét státusz, sorrendben: Feldolgozásra vár, Visszaigazolva, Készletezés alatt, Kiszállítás,
Átvehető, Megrendelés lezárva, Sikertelenül lezárt rendelés.

## 9. A név melletti jelek MÁS rendelésekből jönnek

A négy jel jelentése (Balázs, 2026-09-02 16:05): csillag = új vásárló; lefelé fordított
hüvelyk = van másik sikertelenül lezárt rendelése, a szám mondja hány; plusz jel = van másik
nyitott rendelése; áthúzott ember = regisztráció nélkül vásárolt.

**A technikai következmény:** a lista lekérdezése nem elég egy rendelés-táblából. A vásárlóhoz
tartozó összesítés (hány nyitott, hány sikertelen, első vásárlás-e) a lista mellé kell
számolni, és ez teljesítmény-kérdés is.

## 10. A publikálható Medusa-kulcs kikötései

A lap a Commerce felől olvas, tehát kulcsot fog használni. Balázs 2026-09-02 16:40-kor
kimondta, hogy az Acropora OS **kezelni is fog** (rendelés, vásárló, termék), tehát a kulcs
írásra is alkalmas lesz: egy kiszivárgott kulcs nem olvasást enged, hanem a bolt irányítását.

- a kulcs kizárólag **szerver oldalon** olvasódjon
- a változó neve **ne** viseljen olyan előtagot, amit a keretrendszer a kliens csomagba fordít
- a bizonyítás **méréssel** menjen: nulla találat a kliens csomagban, **ismert pozitív
  kontrollal együtt** (keress rá valamire, amiről tudod, hogy ott van)
- a kulcs **soha** ne szerepeljen válasz-törzsben

**Miért kell ezt előre kiírni:** egy ilyen kulcs nem attól kerül a böngészőbe, hogy valaki
hibázik, hanem attól, hogy a keretrendszer alapértelmezése átviszi, és az csendben történik.

---

## Ami NINCS eldöntve, és a lap építése közben elő fog jönni

1. **A tizenkilenc régi köztes rendelés.** 26 köztes rendelésből 19 több mint 30 napos, a
   legrégebbi egy „Kiszállítás" státuszú 2025.11.19 óta. Ezek valószínűleg soha nem zárulnak
   le rendes úton. Kérdés Balázsnak, nem fejlesztői döntés.
2. **A „Visszaigazolva" célállapota a migrációban.** Ez a státusz nem jön át az új boltba, de
   egy rendelés ma abban áll. Egy darabnál nem sürget, de a kérdés alakja fontosabb a számnál.
