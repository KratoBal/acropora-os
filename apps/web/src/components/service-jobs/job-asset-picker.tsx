"use client";

import type { AssetDetail, AssetListItem } from "@acropora/types";
import {
  ASSET_LABEL_CODE_SHAPE_MESSAGE,
  normalizeAssetLabelCode,
} from "@acropora/types";
import { Button, Input } from "@acropora/ui";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { assetsApi } from "@/lib/api/assets";
import { ApiError } from "@/lib/api/client";

/**
 * A HELYSZINEN ALLO ESZKOZOK, TOBBSZOROS VALASZTASSAL.
 *
 * Balazs kerese (2026-09-14): "Ez alatt a partner helyszinehez kapcsolod eszkozok
 * kozul lehessen kivalasztani, akar tobbet is."
 *
 * === MIERT A HELYSZIN A SZURO, ES NEM A PARTNER ===
 *
 * Mert ezt kerte, es mert a lista maskepp hasznalhatatlan: egy nagy partnernek
 * szaz eszkoze is lehet, es a bejelento egy KONKRET medencerol beszel. A
 * vegpont `departmentId` szuroje ráadásul a RESZFARA szol, nem csak a
 * megnevezett csomopontra -- tehat a "Biodom" alatti medencek eszkozei is
 * bejonnek, ami pontosan a helyes olvasat.
 *
 * === HELYSZIN NELKUL NEM LISTAZUNK, ES EZT KI IS MONDJUK ===
 *
 * Nem technikai korlat: a partner ÖSSZES eszkoze egy kivalaszthatatlan lista
 * lenne. A mondat megnevezi a teendot (valassz helyszint), ahelyett hogy egy
 * ures valaszto allna ott magyarazat nelkul -- pontosan az a hiba, amit a
 * telefonos urlapon ma mertunk.
 *
 * === A VALASZTAS A HIVONAL AL, NEM ITT ===
 *
 * A komponens nem tarolja a kivalasztott halmazt: felfele adja. Igy az urlap
 * egyetlen helyen tudja, mit kuld el, es a helyszin valtozasakor is o dont
 * arrol, mi legyen a korabbi valasztassal.
 *
 * === A MATRICAKOD BEIRASA A LISTA FOLOTT (Balazs kerese, 2026-09-16) ===
 *
 * Szo szerint: "a lista felett jo lenne ha a qr kod szamanak beirasara is
 * lehetoseg. termeszetesen valahogy ugy, hogy tobb eszkozt is be lehessen vonni
 * mint a checkboxos megoldasnal."
 *
 * A BEIRT KOD HOZZAAD, NEM CSEREL: egymas utan tobb kod is beirhato, es a
 * jelolonegyzetes valasztas mellette ervenyben marad. Szaz eszkoznel a lista
 * mar nem hasznalhato -- a kod viszont ott all a gepen, a szerelo kezeben.
 */
export function JobAssetPicker({
  departmentId,
  selected,
  onChange,
}: {
  /** A kivalasztott helyszin. Ures szoveg: meg nincs. */
  departmentId: string;
  /** A mar kivalasztott eszkozok azonositoi. */
  selected: readonly string[];
  onChange: (assetIds: string[]) => void;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  /**
   * A KODROL HOZZAADOTT SOROK, AMIK A BETOLTOTT LAPON NINCSENEK RAJTA.
   *
   * MIERT KELL KULON LISTA, ES MIERT EZ A LENYEG. A lap SZAZ sornal megall, es
   * a kod-mezo EPP AZERT letezik, mert egy helyszinen ennel tobb eszkoz is
   * allhat. Ha a kodrol talalt eszkozt csak a KIVALASZTOTTAK koze tennenk, a
   * jelolonegyzetes lista nem mutatna meg -- a felhasznalo egy nema, lathatatlan
   * valasztast vinne a jegyre, es semmi nem mondana meg neki, mit ad be.
   *
   * A BETOLTOTT LAPTOL KULON ALL, mert a "szaz sornal megall a lista"
   * figyelmeztetes a LAP hosszarol szol. Egy kozos listaban a kodrol hozzaadott
   * sor elmozditana azt a szamot, es a figyelmeztetes mast allitana, mint amit
   * mer.
   */
  const [extra, setExtra] = useState<AssetListItem[]>([]);
  /**
   * A BETOLTOTTSEG KULON ALL AZ URES LISTATOL. Harom allapot van, es harom
   * kulon mondatot erdemel: nincs helyszin / meg toltunk / nincs eszkoz. Egy
   * ures lista magyarazat nelkul ugy nez ki, mint egy betoltesi hiba.
   */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeState, setCodeState] = useState<{
    kind: "ok" | "gond";
    text: string;
  } | null>(null);

  const load = useCallback(
    async (unit: string, signal?: AbortSignal) => {
      if (!unit) {
        setAssets([]);
        setLoaded(false);
        return;
      }
      setLoaded(false);
      setError(null);
      try {
        /**
         * A LAPMERET KIMONDVA, ES A FELSO HATARON ALL.
         *
         * A vegpont alapbol 25 sort ad, es egy CSENDBEN levagott lista itt a
         * legrosszabb fajta hiba: a hianyzo eszkoz ugy nez ki, mintha nem
         * letezne, es a bejelento mast valasztana helyette. A szaz a vegpont
         * felso hatara (`@Max(100)`); ha egy helyszinen ennel tobb eszkoz all,
         * azt a lista aljan KIMONDJUK, nem elhallgatjuk.
         */
        const query = new URLSearchParams({
          departmentId: unit,
          pageSize: "100",
          /**
           * AZ ALLAPOT KIMONDVA, ES EZ EGY MERT HIBA JAVITASA.
           *
           * A parameter NELKUL a vegpont `ACTIVE`-ra szur (a `AssetListQueryDto`
           * alapertelmezese), tehat ez a valaszto CSAK a mukodo eszkozoket
           * kinalta -- a javitas alatt allot es a nem uzemelot NEM. Balazs mérte
           * vissza 2026-09-16-an, szo szerint: "egy olyan eszkozt akarok
           * csatolni ami javitas alatt van az nem jelenik meg".
           *
           * AMIERT EZ A LEGROSSZABB FAJTA HIBA VOLT ITT: a hianyzo eszkoz
           * pontosan ugy nezett ki, mintha nem letezne. Se ures lista, se
           * hibauzenet -- a bejelento mast valasztott volna helyette.
           *
           * ES AMIERT `IN_PLACE`, NEM `ALL`: a KIVEZETETT eszkoz mar fizikailag
           * sincs a helyszinen, tehat uj hibajegyet nem kaphat. Minden mas igen:
           * a javitas alatt allo (masodik hiba ugyanazon a gepen) es a nem
           * uzemelo is (Balazs szavaival: "az lehet hideg vagy meleg tartalek").
           */
          status: "IN_PLACE",
        });
        const response = await assetsApi.list(token, query, signal);
        setAssets(response.items);
        setLoaded(true);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError("A helyszín eszközei nem tölthetők be.");
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    // A HELYSZIN VALTOZASA ELVISZI A KODROL HOZZAADOTT SOROKAT ES AZ UZENETET
    // IS: mindketto az ELOZO helyszinrol szolt. Egy ottmaradt "bekerult" mondat
    // egy masik helyszin listaja folott allitas lenne, nem nyugta.
    setExtra([]);
    setCodeState(null);
    void load(departmentId, controller.signal);
    return () => controller.abort();
  }, [departmentId, load]);

  const toggle = (assetId: string) => {
    onChange(
      selected.includes(assetId)
        ? selected.filter((id) => id !== assetId)
        : [...selected, assetId],
    );
  };

  const addByCode = useCallback(async () => {
    /**
     * AZ ALAKOT MAR ITT ELDONTJUK, HALOZAT NELKUL, es ugyanazzal a
     * fuggvennyel, amit a szerver hasznal (`normalizeAssetLabelCode`). Nem
     * masodik peldany: a csomag azert kozos, hogy a ket oldal ne tudjon
     * elcsuszni egymastol.
     */
    const stored = normalizeAssetLabelCode(code);
    if (stored === null) {
      setCodeState({ kind: "gond", text: ASSET_LABEL_CODE_SHAPE_MESSAGE });
      return;
    }
    setCodeBusy(true);
    setCodeState(null);
    try {
      /**
       * ELSO KERDES: EZ A MATRICA EZEN A HELYSZINEN ALL-E.
       *
       * A LISTAT kerdezzuk, nem a `scan-label` vegpontot, es ez merven dolt el
       * (2026-09-16): a `scan-label` a kod -> eszkoz lekepezest oldja fel, a
       * RESZFA-TAGSAGOT nem -- a valaszaban allo `unit.path` NEVEKET hordoz,
       * nem azonositokat. A lista viszont ugyanazt a reszfa-szabalyt hasznalja,
       * amit a mentes ellenoriz, tehat ami itt atmegy, azt a szerver is
       * elfogadja.
       *
       * A LAPMERET TIZ, mert a vegpont also hatara annyi (`@Min(10)`). A
       * `labelCode` szuro egyedi kodra szol, tehat legfeljebb egy sor jon.
       */
      const itt = await assetsApi.list(
        token,
        new URLSearchParams({
          departmentId,
          labelCode: stored,
          status: "IN_PLACE",
          pageSize: "10",
        }),
      );
      const row = itt.items[0];
      if (row) {
        setExtra((prev) =>
          prev.some((item) => item.id === row.id) ? prev : [row, ...prev],
        );
        if (!selected.includes(row.id)) onChange([...selected, row.id]);
        setCodeState({
          kind: "ok",
          text: `${stored}: ${row.name} bekerült a kiválasztottak közé.`,
        });
        setCode("");
        return;
      }
      /**
       * MASODIK KERDES: HA NEM ITT ALL, MIERT NEM.
       *
       * Egy "nem talaltam" mondat itt HAZUGSAG lenne: az eszkoz letezhet, es
       * latjuk is -- csak mashol all, vagy ki van vezetve. A ket eset MAS
       * teendot ker attol, aki belefut, tehat kulon mondatot is kap.
       */
      /*
        A VALASZ 2026-09-22 OTA UNIO: a SZABAD kod (kiadott, de eszkozhoz nem
        rendelt) kulon tagot kap. EZ A KEPERNYO A HIBAJEGYHEZ VALASZT ESZKOZT,
        tehat egy szabad matricaval nincs mit kezdenie -- de a KEZELONEK VAN:
        ez az egyetlen hely, ahol MEGTUDHATJA, hogy a kod letezik, csak meg
        nincs eszkozhoz ragasztva.

        Enelkul a ket eset ugyanazt a mondatot kapna („nem talaltam"), es a
        kezelo a MATRICAT hinne rossznak, holott az ep -- csak meg nincs
        felhasznalva.
      */
      const eredmeny = await assetsApi.scanLabel(token, stored);
      setCodeState(
        eredmeny.kind === "FREE"
          ? {
              kind: "gond",
              text: `${stored}: ez a matrica még szabad, nincs eszközhöz rendelve. Előbb vidd fel az eszközt ezzel a kóddal.`,
            }
          : { kind: "gond", text: miertNem(stored, eredmeny.asset) },
      );
    } catch (cause) {
      setCodeState({ kind: "gond", text: kodHiba(stored, cause) });
    } finally {
      setCodeBusy(false);
    }
  }, [code, departmentId, onChange, selected, token]);

  if (!departmentId)
    return (
      <p className="text-sm text-dusk-500">
        Előbb válassz helyszínt. Az eszközök a helyszínhez és az alatta lévő
        egységekhez tartoznak.
      </p>
    );

  // A KODROL HOZZAADOTT SOROK ELOL ALLNAK: azok a legfrissebbek, es azokat
  // kereste valaki kifejezetten. A `filter` a ketszeres megjelenest zarja ki,
  // ha egy kesobbi betoltes mar hozza a sort.
  const lathato = [
    ...extra.filter((item) => !assets.some((asset) => asset.id === item.id)),
    ...assets,
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="w-40">
          <Input
            aria-label="Matricakód"
            placeholder="V2196"
            value={code}
            disabled={codeBusy}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              /**
               * AZ ENTER HOZZAAD, ES NEM KULD BE AZ URLAPOT.
               *
               * A `preventDefault` akkor is kell, ha ma egyik hivo lap sem
               * `<form>` elem: aki a kodot begepeli, Entert fog utni, es egy
               * kesobbi urlapba helyezve ez CSENDBEN a felvitelt inditana el --
               * fel jeggyel, egyetlen beirt kod utan.
               */
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (!codeBusy) void addByCode();
            }}
          />
        </div>
        <Button size="sm" disabled={codeBusy} onClick={() => void addByCode()}>
          Hozzáadás
        </Button>
      </div>
      {codeState ? (
        <p
          className={
            codeState.kind === "ok"
              ? "text-xs text-emerald-700"
              : "text-xs text-amber-700"
          }
        >
          {codeState.text}
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !loaded ? (
        <p className="text-sm text-dusk-500">Eszközök betöltése...</p>
      ) : lathato.length === 0 ? (
        <p className="text-sm text-dusk-500">
          Ezen a helyszínen nincs nyilvántartott eszköz. A jegy enélkül is
          megnyitható.
        </p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded border p-2">
          {lathato.map((asset) => (
            <li key={asset.id}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(asset.id)}
                  onChange={() => toggle(asset.id)}
                />
                <span>
                  {asset.name}
                  {/*
                    A LELTARI SZAM A NEV MELLE. Ket azonos nevu szivattyu egy
                    helyszinen teljesen normalis, es a nev onmagaban akkor sem
                    megkulonbozteto, ha ma veletlenul az.
                  */}
                  <span className="pl-2 text-xs text-dusk-500">
                    {asset.assetNumber}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {/*
        A LEVAGAS KIMONDVA. A vegpont felso hatara szaz sor: ha egy helyszinen
        ennyi eszkoz all, a lista MAR hianyos lehet, es ezt latnia kell annak,
        aki valaszt. Egy csendben levagott lista rosszabb a hibanal: a hianyzo
        eszkoz ugy nez ki, mintha nem letezne. A matricakod EPP erre valasz: a
        kodrol hozzaadott eszkoz akkor is bekerul, ha a lapon nincs rajta.
      */}
      {assets.length === 100 ? (
        <p className="text-xs text-amber-700">
          Száz eszköznél megáll a lista. Ha a keresett nincs köztük, írd be a
          matricakódját, vagy szűkíts lejjebb a helyszín fájában.
        </p>
      ) : null}
    </div>
  );
}

/**
 * MIERT NEM ADHATO HOZZA EGY OLYAN ESZKOZ, AMIT A KODROL MEGTALALTUNK.
 *
 * KET OK VAN, es kulon mondatot kapnak, mert MAS a teendo: a kivezetett eszkoz
 * mar sehol nem all, a masik helyszinen allora pedig ott kell jegyet nyitni.
 */
function miertNem(code: string, asset: AssetDetail): string {
  if (asset.status === "RETIRED")
    return `${code}: ${asset.name} ki van vezetve, ezért nem választható.`;
  return `${code}: ${asset.name} MÁS helyszínen áll (${holAll(asset)}), ezért ehhez a jegyhez nem adható hozzá.`;
}

/**
 * HOL ALL AZ ESZKOZ, KIIRVA.
 *
 * A TELJES UT MEGY KI, NEM AZ EGYSEG NEVE: a kod es a nev csak TESTVEREK kozott
 * egyedi, tehat ket tavoli ag alatt ugyanaz a "Biodom" megengedett. A puszta
 * nev ilyenkor azt a kepet adna, hogy a szerelo jo helyen jar.
 */
function holAll(asset: AssetDetail): string {
  const hely = asset.unit?.path.length
    ? asset.unit.path.join(" / ")
    : asset.unit?.name;
  return [asset.owner.displayName, hely].filter(Boolean).join(" / ");
}

/**
 * A KODRA ADOTT HIBAVALASZ, MONDATTA FORDITVA.
 *
 * A NEM LETEZO ES A NEM LATHATO KOD EGY MONDATOT KAP, mert a szerver sem
 * kulonbozteti meg oket (`detailByLabelCode`): ha a ket valasz eltérne, a
 * valaszokbol felterkepezheto lenne, mely kodok vannak kiadva es kihez
 * tartoznak. Az olvasonak amugy is ugyanaz a teendoje: nezze meg a matricat.
 */
function kodHiba(code: string, cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 404)
    return `${code}: ehhez a kódhoz nem tartozik elérhető eszköz. Ellenőrizd a matricát.`;
  if (cause instanceof ApiError) return cause.message;
  return "A matricakód ellenőrzése nem sikerült.";
}
