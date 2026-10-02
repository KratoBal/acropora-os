# Sutyerák webes pilot: gateway és panel

A 3. pont a már meglévő `ASSISTANT_READONLY` sessionre épül. A gateway külön szolgáltatás; ez a változás nem módosítja, nem telepíti és nem választ pilot-dolgozót.

## Bekapcsolás

Az API környezetében `SUTYERAK_ENABLED=true` (vagy `1`) és a vesszővel elválasztott `SUTYERAK_PILOT_USER_IDS` együtt szükséges. Alapértelmezésben kikapcsolt. A `SUTYERAK_GATEWAY_URL` és `SUTYERAK_GATEWAY_SECRET` kizárólag szerveroldali érték, `NEXT_PUBLIC_` előtag nélkül. A titkot titokkezelőből kell átadni; nem része a repónak.

`GET /assistant/config` a bejelentkezett saját USER-sessionnel adja meg a láthatóságot, nem cache-elhető. `POST /assistant/ask` minden kérésnél újból ellenőrzi a belső dolgozót, a USER-sessiont, a flaget és a pilotlistát. Partner és assistant-session 403-at kap. A normál cookie/CSRF és jogosultsági ellenőrzés változatlan.

## Token és korlátok

Az API userenként a legutóbb kiadott assistant-token nyers értékét saját memóriájában tartja. Ugyanazt használja, amíg a rögzített adatbázisos session él és több mint egy perc van hátra. A visszavont tokent sem használja újra. A párhuzamos kiadások egy processzen belül közös ígéretet várnak. A read-only session fix tízperces lejárata és userenkénti három aktív session-korlátja a meglévő session repository feladata.

API-újraindításkor a nyers token cache elvész; több replika külön cache-t tart. A meglévő három élő session-korlát továbbra is közös és kötelező: a rendszer nem töröl korábbi tokent a limit megkerülésére. Pilotnál egy API-processz ad teljes cache-újrahasználatot; több replika előtt külön tervezést igényel a titkos tokenek közös tárolása.

A 6 kérdés/60 másodperc és 60 kérdés/3600 másodperc gördülő korlátot az adatbázis `AuditLog` `assistant.ask` sorai mérik. A user sorának tranzakciós zárolása a replikák közt is sorosítja a számlálást és a bejegyzést. A gateway-hibás és idegen threades próbálkozás is fogyaszt keretet, a jogosultság miatt tiltott kérés nem. A bejegyzés nem tárol kérdésszöveget vagy tokent. A 429 magyarul jelzi a korlátot.

## Válasz és panel

A gateway `/ask` kérésében az API teszi hozzá a szerveroldali read-only tokent és a bejelentkezett dolgozó azonosítóját/nevét. A kliens csak kérdést (legfeljebb 4000 karakter), opcionális threadet és oldalkontextust küldhet; extra azonosság vagy token mező 400.

A gateway NDJSON bytefolyama változatlanul, összegyűjtés nélkül jut vissza. A külön Next útvonal megkerüli az általános proxy 50 másodperces timeoutját; a gateway-limit 120, a webproxy-limit 130 másodperc. A kapcsolat megszakítása leállítja az olvasást. Hiányzó konfiguráció, offline gateway, 5xx, hibás content-type vagy üres stream magyar `error` eseményt ad; a gateway nyers hibaüzenete nem jut a klienshez. Idegen threadnél 403 marad, a panel törli a threadet és egyszer újrapróbálja. A 400/409 megmarad. A rendes USER-session cookie-frissítése továbbjut; assistant-token vagy gateway-secret nem kerül a böngésző válaszába.

A panel a kész választ egyszerű szöveges Markdownnal rajzolja (félkövér, lista, táblázat), HTML és külső képek futtatása nélkül. A beszélgetés és a thread userenként a tab `sessionStorage`-jában, a figura helyzete userenként `localStorage`-ban marad. Az új beszélgetés a futó választ megszakítja. Egér és érintés pointer-eseményekkel mozgatja a figurát; húzás után nem nyílik panel. Ablakméret-változáskor a figura és a panel a nézetben marad.

A munkalap, hibajegy, eszköz, akvárium és számla adatlapjai a ténylegesen betöltött azonosítót és számot regisztrálják. A kontextus az aktuális pathname, query és hash nélkül; előző oldalhoz tartozó entity nem továbbítható.

A négy kép átmeneti, a Downloads mappában rendelkezésre álló javított PNG-ből származik. A briefben hivatkozott `exchange/sutyerak/v2` nem volt elérhető. A teljes készlet az `assets.ts` és a `public/sutyerak/v2` alatt cserélhető.

## Ellenőrzés

A HTTP-tesztek valódi helyi Nest API-t, a meglévő auth/read-only guardokat és kitalált gatewayt használnak. A böngészős komponens- és streamtesztek külön ellenőrzik a húzást, thread-helyreállítást, resetet, kontextust, Markdownot és pufferelés nélküli továbbítást. Az adatbázisos integrációs teszt 12 párhuzamos próbából pontosan 6-ot enged át, több repository-példány használatával, kizárólag `_test`/`_ci` adatbázison.

A `scripts/calibrate-assistant-widget.mjs` hét szándékos rontást tesztel: partnerkapu, assistant POST-zár, flag/pilotkapu, token-újrahasználat, offline error, húzás/kattintás és token-kiszivárgás. Mindegyiknél a megfelelő tesztnek pirosnak, visszaállítás után a csomagnak zöldnek kell lennie. Az API `test-dist` fájljaiban dolgozik; a húzási próba ideiglenes forrásmódosítását is `finally` állítja vissza. Ne fusson más fordítással vagy teszttel párhuzamosan.
