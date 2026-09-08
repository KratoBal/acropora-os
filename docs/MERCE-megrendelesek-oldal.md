# Mérce: a Megrendelések oldal, a mai UNAS admin alapján

Balázs küldte a mintát, 2026-09-02 15:54, Discord (Acropora Commerce Webshop Megrendelések
frontend szál, `1544707009545240657`), a mondata: „Ez eleg hasznalhato, valami ilyesminek
kellene lenni a mienknek is".

Ez a lap **képernyőképről olvasott leltár**, nem terv. A célja, hogy a következő fejlesztői
prompt mérésből induljon, ne emlékezetből, és hogy Balázs egy helyen tudja megmondani, mi
hiányzik belőle.

## 1. Amit a képen látni, tételesen

**A lap címe:** „Megrendelések követése".

**Felső műveletek:** Nyomtat, Szállítólevél, Összevonás, plusz Új rendelés.

**Keresés és szűrés, egy sávban:**

- szabad szavas kereső
- dátum szerinti szűrés (a mezőben: „Beérkezés dátuma"), **-tól -ig** párral
- három gomb: Szűrés, Alapállapot, Szűrés törlése
- **tizenegy legördülő szűrő:** minden leadott rendelés, minden státusz típus, minden
  státusz, minden vásárló, csoporttól függetlenül mindenki, minden fizetés típus, minden
  típus, minden fizetés mód, minden szállítási mód, minden számlázási státusz, minden nyelv,
  minden pénznem

**Lapozás:** számozott oldalak (a képen 15), előre és hátra nyíllal.

**Oszlopok:** jelölőnégyzet, sorszám, **Azonosító**, **Dátum**, **Összeg**, **Név**,
**Rendelés státusza**, **Info**. Az öt középső mind rendezhető (a fejlécben rendező jel áll).

**Az azonosító alakja:** `47679-479906`.

## 2. AMI A LEGFONTOSABB, ÉS AMIT EGY OSZLOP-LISTA NEM AD VISSZA: A SOR SZÍNE

**A státuszt a sor háttérszíne hordozza**, nem csak a szöveg. A képen:

| szín | státusz |
|---|---|
| rózsaszín / piros | Feldolgozásra vár |
| narancs | Kiszállítás |
| kék-lila | Megrendelés lezárva |
| zöld | Visszaigazolva |
| halvány rózsaszín | Sikertelenül lezárt rendelés |

Ettől a lap **olvasás nélkül is használható**: a kezelő végigfut a szemével, és látja, hol
van teendő. Egy fekete-fehér lista ugyanazokkal az oszlopokkal **nem ugyanaz a termék**.

## 3. Az Info oszlop: állapotok ikonként, egy sorban

A soronkénti ikonok (számla, csomag, teherautó, emberek, olló, zöld pipa, piros ikszek),
plusz a **szolgáltató logója** (FOXPOST, GLS) és a **fizetési szolgáltatóé** (SimplePay).

**Egy mért részlet, ami többet mond, mint amennyinek látszik:** az óra ikonon egérrel
megállva ez jelenik meg: *„Státusz módosítás dátuma: 2026.08.28 10:31"*. Vagyis a lap nem
csak a mai állapotot mutatja, hanem azt is, **mikor** váltott — anélkül, hogy meg kellene
nyitni a rendelést.

### A név melletti jelek: MEGVANNAK, és többet mondanak, mint amire számítottam

Balázs küldte, 2026-09-02 16:05, kérdés nélkül:

| jel | jelentés |
|---|---|
| csillag | **új vásárló** |
| lefelé fordított hüvelyk | van másik **sikertelenül lezárt** rendelése; a szám azt mondja, hány |
| plusz jel | van másik **nyitott** rendelése |
| áthúzott ember | **regisztráció nélkül** vásárolt |

**AMI EBBEN A LÉNYEG, ÉS AMIT A KÉPRŐL NEM LEHETETT VOLNA KITALÁLNI:** ezek a jelek **nem a
rendelésről szólnak, hanem a VÁSÁRLÓRÓL** — a másik rendeléseiről, az előéletéről, a
regisztráltságáról.

Ettől a sor nem egy rendelés adatlapja, hanem **döntési felület**: a kezelő ránézésre látja,
hogy kivel van dolga, mielőtt bármit megnyitna. Egy új vásárló, akinek három sikertelenül
lezárt rendelése van, más elbánást kíván, mint egy visszatérő.

**Ez a szín-szabály párja:** a **szín** a rendelés állapotát adja, a **jelek** a vásárló
kockázatát. Kettő együtt teszi a listát olvasás nélkül használhatóvá.

**És egy technikai következmény, amit a promptba ki kell írni:** ezek az adatok **más
rendelésekből** származnak, tehát a lista lekérdezése nem elég egy rendelés-táblából. A
vásárlóhoz tartozó összesítés (hány nyitott, hány sikertelen, első vásárlás-e) a lista
mellé kell.

## 4. Amink ma van, mérve

**Megvan (PR 34, `feat/order-business-status`, a gépi ellenőrzése MA PIROS):** a hat üzleti
státusz, a köztük megengedett átmenetek, hogy ki léptethet (kezelő, futár, rendszer), és a
váltások **története** külön modellben.

A történet azért számít itt: a képen látott „státusz módosítás dátuma" pontosan ez az adat.
Vagyis a lap egyik mért tulajdonságához **már megvan a forrás**.

**Nincs meg:** maga a Megrendelések oldal. A Commerce mind a 132 fájlja backend és
infrastruktúra volt a mai mérés szerint.

## 5. Egy döntés, ami a lap előtt jön, és nem az enyém

A Medusának **van saját admin felülete**, és a repó **már bővíti is** (`src/admin/widgets/`
alatt egy termék-widget áll). Két út van tehát:

- **a Medusa admin bővítése** — a lista, a szűrők és a lapozás nagy része készen van, mi a
  saját oszlopainkat és a színezést tesszük hozzá
- **saját Megrendelések oldal** — teljes szabadság, és minden sor a miénk, a lapozástól a
  szűrőkig

**Az olvasatom, amíg mást nem mond:** a Medusa admin bővítése. Az ok nem a kevesebb munka,
hanem hogy a rendelés-adat ott **már a helyén van**, és a mi hozzáadott értékünk a színezés,
az Info oszlop és a státuszváltás egy kattintással — nem a lapozó megírása.

## 6. Amit ebből a következő prompt kap

- a fenti oszlop-lista, a rendezhetőséggel együtt
- a **szín-státusz megfeleltetés**, mert e nélkül a lap más termék
- a státuszváltás **kattintásszáma** mint mérce: a mai UNAS oldalon a kezelő a listáról lát
  mindent; ha nálunk minden váltáshoz meg kell nyitni a rendelést, az visszalépés
- a „mikor váltott" adat, ami a mi történet-modellünkben már megvan
