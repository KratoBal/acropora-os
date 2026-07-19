# UNAS brand review és import-jóváhagyás

Hiányzó jelöltnél a felület a [Brand master-data kezelésbe](./BRAND-MANAGEMENT.md) vezet előtöltött névvel és visszatérési URL-lel. A létrehozás nem jelent automatikus elfogadást.

Az admin felület útvonala: `/admin/imports/unas/{batchId}/review`. Használatához és minden kapcsolódó API-művelethez `products.manage` jogosultság szükséges.

## Review folyamat

1. A dry-run riportból nyisd meg a **Brandek ellenőrzése** műveletet.
2. Szűrj státusz, review-ok vagy confidence sáv szerint. A keresés SKU-ra, terméknévre és a mentett jelöltekre működik. A lapozás és a szűrők az URL-ben maradnak.
3. Az **ACCEPT** kizárólag a resolver által már eltárolt jelöltet fogadja el; szabad szöveges márka nem adható meg. A **NO_BRAND** tudatosan márka nélkül hagyja a terméket.
4. Jóváhagyás előtt a döntés módosítható vagy visszaállítható. Az `updatedAt` concurrency token megakadályozza más felhasználó frissebb döntésének csendes felülírását.
5. A csoportos művelet csak az aktuális oldalon explicit kijelölt, legfeljebb 100 sort érinti, tranzakciósan. Nincs „minden oldalt elfogad” művelet.

## Approval és Apply

A backend csak akkor jelöli jóváhagyhatónak a batch-et, ha nincs validációs hiba, elavult analysis version vagy függő review. A jóváhagyáshoz az `APPROVE` kifejezést kell beírni. Ez nem futtat Apply-t, viszont a review-kat csak olvashatóvá teszi.

Az Apply kizárólag `APPROVED` batchen indítható az `APPLY <batch-id első 8 karaktere>` kifejezéssel. A gomb folyamat közben tiltott. Az apply idempotens: már alkalmazott batchnél a mentett riport tér vissza. Mivel a művelet szinkron, hálózati timeout esetén előbb újra kell tölteni a batch állapotát; nem szabad vakon új műveletet indítani.

Az alkalmazott riport tartalmazza a létrehozott és módosított entitások számait, a feloldatlan brandkapcsolatokat és megerősíti, hogy `StockMovement` nem változott. A riport másolható és JSON-ként letölthető.

## Operációs runbook a fejlesztési batchhez

A jelenlegi fejlesztési batch: `cmrrx41c2000079wo92lr9clz`. Ez csak operációs hivatkozás, az alkalmazáskód nem tartalmazza.

1. Nyisd meg közvetlenül a review útvonalon, ellenőrizd az analysis versiont és a validációs összegzést.
2. Emberi ellenőrzéssel dönts a 881 review sorról; automatizált tömeges elfogadás tilos.
3. Ellenőrizd a 100%-os készültséget és a jóváhagyhatósági jelzést.
4. Külön változáskezelési döntés után hagyd jóvá, majd külön megerősítéssel alkalmazd.
5. Timeoutnál előbb nyisd újra a riportot. Export és személyes adat nem kerülhet Gitbe.

Automatizált tesztek csak szintetikus fixture-öket használhatnak; a valódi batch review-it, státuszát vagy termékadatait nem módosíthatják.
