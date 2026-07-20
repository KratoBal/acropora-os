# Architektúra v0.1

## Szerepek

- **Acropora ERP:** elsődleges készlet- és mozgásnyilvántartás.
- **UNAS:** webshop, online rendelésfelvétel és publikált eladható készlet.
- **Számlázz.hu:** számla jogi és technikai forrása.

## Adatgazdák

| Adat                                   | Elsődleges rendszer                         |
| -------------------------------------- | ------------------------------------------- |
| Fizikai készlet és készletmozgások     | Acropora ERP                                |
| Beszerzési ár, beszállító, polchely    | Acropora ERP                                |
| Terméktörzs, eladási ár és webshopadat | UNAS, Acropora OS-ben read-only tükör       |
| Webshopos rendelés                     | UNAS, ERP-ben tükrözve                      |
| Számla és számlaszám                   | Számlázz.hu, ERP-ben és UNAS-ban visszaírva |

A terméktulajdonlás és a helyi extension határa az
[ADR-013](../adr/0013-unas-product-master-and-local-extension.md), az M2.1
szinkronszerződés a
[UNAS Product Synchronization](./M2.1-UNAS-PRODUCT-SYNCHRONIZATION.md)
dokumentumban található.

## Fő folyamatok

### Bevételezés

1. Piszkozat létrehozása.
2. Tételek felvétele kézzel, vonalkóddal vagy CSV-ből.
3. Ellenőrzés és véglegesítés.
4. Tranzakción belül készletmozgások létrehozása.
5. UNAS `in` készletfrissítési feladatok sorba állítása.
6. Tételenkénti visszaigazolás és hibajelzés.

### Webshopos rendelés

1. Webhook vagy időszakos lekérdezés észleli a rendelést.
2. A rendelés egyedi UNAS kulccsal bekerül az ERP-be.
3. A helyi készletmodell egyezteti az UNAS által már végrehajtott levonást.
4. Törlés/visszanyitás esetén ellentétes mozgás történik.

### Automatikus számlázás

1. Az UNAS rendelés `Invoice.Status = 1` állapotba kerül.
2. Az ERP egyedi idempotencia-kulccsal zárolja a számlázást.
3. Létrehozza és elküldi a kötött sorrendű Számlázz.hu XML-t.
4. Eltárolja a számlaszámot.
5. Az UNAS rendelésben `Invoice.Status = 2`, `Invoice.Number` és `Invoice.Url` mezőket frissíti.
6. Ha az UNAS-visszaírás hibázik, csak a visszaírás ismétlődik; új számla nem készül.

## Konzisztencia

Külső API-hívás nem része az adatbázis-tranzakciónak. A rendszer ezért outbox/queue mintát használ:

- az üzleti tranzakció és a `SyncJob` ugyanabban az adatbázis-tranzakcióban jön létre;
- a worker később végrehajtja a külső hívást;
- minden művelet egyedi idempotencia-kulccsal rendelkezik;
- tartós adat- vagy validációs hibát nem próbálunk végtelen ciklusban újra.
