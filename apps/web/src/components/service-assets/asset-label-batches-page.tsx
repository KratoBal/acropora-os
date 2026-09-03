"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
} from "@acropora/ui";
import {
  ASSET_LABEL_BATCH_MAX,
  ASSET_LABEL_BATCH_MIN,
  hasPermission,
  PERMISSIONS,
  type AssetLabelBatchSummary,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { assetLabelsApi } from "@/lib/api/assets";
import {
  batchCsv,
  batchFileName,
  batchSummaryLine,
  batchTimestampLabel,
} from "./asset-label-batches";

/**
 * MATRICA-KÖTEGEK: GENERÁLÁS, LISTA, LETÖLTÉS.
 *
 * A MENÜPONT 2026-09-02 ÓTA BE VOLT KÖTVE, AZ OLDAL VISZONT NEM LÉTEZETT --
 * Balázs élesben 404-et kapott rá (2026-09-03 09:39). A szerveroldal és a
 * képernyő tiszta része (időpont, fájlnév, CSV, összegző mondat) készen állt;
 * ez a komponens köti össze őket.
 *
 * A LETÖLTÉS KÜLÖN HÍVÁS, nem a lista része: a lista ötven kötegről szól,
 * egyenként akár ötszáz kóddal, és az akkor is átmenne a hálón, ha senki nem
 * tölt le semmit.
 */
/**
 * MENNYIT KERUNK A SZABAD KESZLETBOL.
 *
 * A VEGPONT LIMITALT (alap 100, felso hatar 500), tehat a valasz HOSSZA nem a
 * teljes szabad keszlet. A szam ITT all, egy helyen, es a lap KI IS IRJA -- egy
 * "N szabad kod" felirat a limit emlitese nelkul azt allitana, hogy ennyi VAN,
 * holott csak ennyit kertunk.
 */
const FREE_LIMIT = 100;

export function AssetLabelBatchesPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const role = session?.user.role;
  const canManage = role
    ? hasPermission(role, PERMISSIONS.SETTINGS_MANAGE)
    : false;

  const [batches, setBatches] = useState<AssetLabelBatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [count, setCount] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    imported: string[];
    alreadyExisted: string[];
  } | null>(null);
  const [freeCodes, setFreeCodes] = useState<
    { id: string; code: string }[] | null
  >(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canManage) return;
      setLoading(true);
      try {
        const [rows, free] = await Promise.all([
          assetLabelsApi.batches(token, signal),
          assetLabelsApi.free(token, FREE_LIMIT, signal),
        ]);
        setBatches(rows);
        setFreeCodes(free);
        setListError(null);
      } catch (cause) {
        /**
         * A HIBA NEM ÜRES LISTA. Egy sikertelen lekérdezés üres tömbre esve
         * úgy nézne ki, mintha még egy köteg sem készült volna -- és a kezelő
         * nyugodtan generálna egy újat, holott a régiek megvannak.
         */
        setListError(
          cause instanceof Error
            ? cause.message
            : "A korábbi kötegek listája most nem tölthető be.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canManage, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const issue = async () => {
    const darab = Number.parseInt(count, 10);
    setIssueError(null);
    if (
      !Number.isInteger(darab) ||
      darab < ASSET_LABEL_BATCH_MIN ||
      darab > ASSET_LABEL_BATCH_MAX
    ) {
      setIssueError(
        `A darabszám ${ASSET_LABEL_BATCH_MIN} és ${ASSET_LABEL_BATCH_MAX} között lehet.`,
      );
      return;
    }
    setIssuing(true);
    try {
      await assetLabelsApi.issue(token, darab);
      setCount("");
      // NINCS KÜLÖN VISSZAIGAZOLÁS: az új köteg megjelenik a listában, és a
      // lista maga a visszajelzés. Egy felugró ablak ugyanazt mondaná el
      // kétszer.
      await load();
    } catch (cause) {
      setIssueError(
        cause instanceof Error
          ? cause.message
          : "A kódok generálása nem sikerült. Próbáld újra, a korábbi kötegek nem sérültek.",
      );
    } finally {
      setIssuing(false);
    }
  };

  /**
   * A BEIRT SZOVEGBOL KODOK: sorok es vesszok menten, ures darabok nelkul.
   *
   * A SZAMOT ITT NEM ELLENORIZZUK, mert a szerver dolga: a DTO egy es otszaz
   * kozott enged. Egy masodik hatar itt csak addig egyezne a szerverevel, amig
   * valaki az egyiket at nem irja.
   */
  const parseCodes = (text: string) =>
    text
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

  const importCodes = async () => {
    const codes = parseCodes(importText);
    setImportError(null);
    setImportResult(null);
    if (codes.length === 0) {
      setImportError("Adj meg legalább egy matricakódot.");
      return;
    }
    setImporting(true);
    try {
      const result = await assetLabelsApi.importCodes(token, codes);
      setImportResult({
        imported: result.imported,
        alreadyExisted: result.alreadyExisted,
      });
      setImportText("");
      await load();
    } catch (cause) {
      setImportError(
        cause instanceof Error
          ? cause.message
          : "A kódok betöltése nem sikerült.",
      );
    } finally {
      setImporting(false);
    }
  };

  const download = async (batch: AssetLabelBatchSummary) => {
    setDownloading(batch.id);
    setListError(null);
    try {
      const { codes } = await assetLabelsApi.codes(token, batch.id);
      const blob = new Blob([batchCsv(codes)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = batchFileName(batch.id, batch.createdAt);
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setListError(
        cause instanceof Error
          ? cause.message
          : "A köteg letöltése nem sikerült.",
      );
    } finally {
      setDownloading(null);
    }
  };

  if (!canManage) {
    return (
      <EmptyState
        title="Nincs jogosultságod"
        description="A matricakódok kiadása beállítás-kezelői jog."
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Eszköz-matricák"
        description="Kódok generálása kötegben, a korábbi kötegek listája, nyomtatható CSV letöltése."
      />

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">Kötegek generálása</h2>
        {issueError ? (
          <Alert
            variant="danger"
            title="Nem sikerült"
            description={issueError}
          />
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-sm font-semibold" htmlFor="matrica-darab">
              Darabszám
            </label>
            <Input
              id="matrica-darab"
              aria-label="Darabszám"
              value={count}
              disabled={issuing}
              onChange={(event) => setCount(event.target.value)}
              placeholder="pl. 50"
            />
          </div>
          <Button
            variant="primary"
            disabled={issuing}
            onClick={() => void issue()}
          >
            {issuing ? "Generálás folyamatban…" : "Kötegek generálása"}
          </Button>
        </div>
        {/*
          A FORMÁTUM-ÍGÉRET KÜLÖN SOR, NEM A GOMB SZÖVEGÉBEN: a gomb a
          cselekvést nevezi meg, ez pedig azt, mit kap a felhasználó.
        */}
        <p className="text-xs text-slate-500">
          A fájl ugyanabban a formátumban készül, mint a legutóbbi köteg.
        </p>
      </Card>

      {/*
        MAR KINYOMTATOTT KODOK BETOLTESE -- KULON DOBOZ, NEM A GENERALAS MELLE.
        A ketto ELLENTETES IRANY: a generalas UJ kodokat allit elo, ez pedig
        MEGLEVOKET vesz nyilvantartasba. Egy dobozban a ket gomb kozott egy
        elgepeles otven felesleges matricat nyomtatna.
      */}
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">
          Már kinyomtatott kódok betöltése
        </h2>
        <p className="text-xs text-slate-500">
          Soronként vagy vesszővel elválasztva. Megismételhető: a már felvett
          kódok nem duplikálódnak, és a válasz megmondja, melyek voltak azok.
        </p>
        {importError ? (
          <Alert
            variant="danger"
            title="Nem sikerült"
            description={importError}
          />
        ) : null}
        <Textarea
          aria-label="Betöltendő kódok"
          rows={3}
          value={importText}
          disabled={importing}
          onChange={(event) => setImportText(event.target.value)}
          placeholder="V2196, A0001"
        />
        <Button
          variant="secondary"
          disabled={importing}
          onClick={() => void importCodes()}
        >
          {importing ? "Betöltés…" : "Kódok betöltése"}
        </Button>
        {importResult ? (
          /*
            A KET LISTA KULON ALL, MERT A TEENDO MAS: az UJAK sikerek, a MAR
            LETEZOK viszont arra utalnak, hogy ezt a listat egyszer mar
            betoltottek -- es ha valaki ezt nem latja, ujra kinyomtathatja oket.
          */
          <div className="space-y-1 text-sm">
            <p>
              Betöltve: <strong>{importResult.imported.length}</strong> új kód
              {importResult.imported.length
                ? ` (${importResult.imported.join(", ")})`
                : ""}
            </p>
            {importResult.alreadyExisted.length ? (
              <p className="text-amber-700">
                Már a készletben volt: {importResult.alreadyExisted.join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Korábbi kötegek</h2>
          {/*
            A SZABAD DARABSZÁM ÉLŐ SZÁM, ÉS EZT KI KELL MONDANI. A lista
            megnyitásakor számolódik abból, hány kód van már eszközhöz rendelve
            -- tehát SOHA nem nő, csak csökkenhet két megnyitás között. Egy
            statikusnak látszó mező mellett a kezelő elakadtnak hinné.
          */}
          <Badge variant="neutral">
            a szabad darabszám élő: soha nem nő, csak csökkenhet
          </Badge>
        </div>

        {listError ? (
          <Alert
            variant="danger"
            title="A lista nem tölthető be"
            description={`${listError} A generálás ettől függetlenül működik.`}
          />
        ) : null}

        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : batches.length ? (
          <ul className="space-y-2" aria-label="Korábbi kötegek">
            {batches.map((batch, index) => {
              const elozo = batches[index + 1];
              /**
               * AZONOS PERC: EGY VÉLETLEN DUPLA KATTINTÁS NYOMA.
               *
               * A lista időben csökkenő, tehát a KÖVETKEZŐ elem a korábbi. Ha
               * a két időbélyeg percre azonos, az a papíron már két kinyomtatott
               * ív -- a sor ezért mondja ki, mihez képest gyanús.
               */
              const azonosPerc =
                elozo !== undefined &&
                batchTimestampLabel(batch.createdAt) ===
                  batchTimestampLabel(elozo.createdAt);
              return (
                <li
                  key={batch.id}
                  className="flex flex-wrap items-center gap-2 border-b pb-2 text-sm last:border-0"
                >
                  <span className="font-medium">
                    {batchTimestampLabel(batch.createdAt)}
                  </span>
                  <span className="text-slate-600">
                    {batchSummaryLine(batch)}
                  </span>
                  {azonosPerc ? (
                    <span className="text-xs text-amber-700">
                      ugyanabban a percben, mint az előző köteg
                    </span>
                  ) : null}
                  <Button
                    variant="secondary"
                    disabled={downloading !== null}
                    onClick={() => void download(batch)}
                  >
                    {downloading === batch.id ? "Letöltés…" : "CSV letöltése"}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : listError ? null : (
          /*
            AZ URES ALLAPOT CSAK AKKOR ALL, HA A LEKERDEZES SIKERULT.
            Hiba utan a `batches` ures marad, es enelkul a lap EGYSZERRE
            mutatna a hibat es azt, hogy "meg nem generaltal koteget" -- a
            masodik pedig hazugsag: nem tudjuk, mi van a szerveren. A
            komponens-teszt EPP EZT fogta meg elsore.
          */
          <EmptyState
            title="Még nem generáltál köteget"
            description="Add meg a darabszámot fent, és nyomd meg a „Kötegek generálása” gombot."
          />
        )}
      </Card>

      {/*
        A SZABAD KESZLET KOTEGTOL FUGGETLENUL.
        A kotegenkenti "szabad" szam azt mondja meg, EBBOL a kotegbol mennyi
        maradt; ez azt, hogy OSSZESEN mennyi all rendelkezesre. A ketto kulon
        kerdes, es a masodikra eddig nem volt valasz a lapon.
      */}
      <Card className="space-y-2 p-4">
        <h2 className="text-sm font-semibold">Szabad kódok a készletben</h2>
        {freeCodes === null ? (
          <Skeleton className="h-10 w-full" />
        ) : freeCodes.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nincs szabad kód: minden kiadott matrica eszközhöz van rendelve.
          </p>
        ) : (
          <>
            {/*
              A DARABSZAM MELLE ODAKERUL A LIMIT, MERT A VALASZ KORLATOZOTT.
              Egy puszta "N szabad kod" azt allitana, hogy ennyi VAN -- holott
              csak ennyit kertunk. A kulonbseg pontosan a limitnel latszik.
            */}
            <p className="text-sm">
              {freeCodes.length < FREE_LIMIT
                ? `${freeCodes.length} szabad kód.`
                : `Legalább ${FREE_LIMIT} szabad kód (ennyit kértünk le, lehet több is).`}
            </p>
            <p className="text-xs text-slate-500">
              A legrégebben kiadottak elöl:{" "}
              {freeCodes
                .slice(0, 12)
                .map((label) => label.code)
                .join(", ")}
              {freeCodes.length > 12 ? " …" : ""}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
