"use client";

import { Button } from "@acropora/ui";
import type { WorksheetAssetLink, WorksheetDetail } from "@acropora/types";
import { useEffect, useState } from "react";

import { JobAssetPicker } from "@/components/service-jobs/job-asset-picker";
import { worksheetsApi } from "@/lib/api/worksheets";
import { PilotCard, PilotCardHeader } from "@/components/pilot/pilot-ui";

/**
 * AZ ESZKOZOK, AMIKROL A LAP SZOL.
 *
 * Balazs kerese, 2026-09-16, Discord (Acropora OS szal), szo szerint:
 * "munkalapnal is jo lenne ha lehetne a helyszinhez rogzitett eszkozoket
 * csatolni".
 *
 * === AMI ITT ELOSZOR LATSZIK: MAGA A LISTA ===
 *
 * A `WorksheetAsset` sorokat 2026-09-15 ota IRJUK, es merve (2026-09-16) SEMMI
 * nem olvasta vissza: se a reszletlap valasza, se a felulet. Aki felvitelkor
 * eszkozt csatolt egy laphoz, azt SEHOL nem latta viszont -- meg a sajat
 * lapjan sem. Ez a doboz eloszor a LISTAT hozza vissza, es csak utana a
 * szerkesztest.
 *
 * === A VALASZTO A HIBAJEGYE, ES EZ NEM KOLCSONZES ===
 *
 * A `JobAssetPicker` harom bemenetet vesz (helyszin, kivalasztottak,
 * visszahivas), es semmi jegy-specifikus nincs benne: a helyszin RESZFAJAT
 * listazza, ugyanazt, amit a szerver ellenoriz. A munkalap FELVITELE mar ma is
 * ezt hasznalja.
 *
 * === A LAP ALLAPOTA NEM SZAMIT, ES EZ A MODELLBOL KOVETKEZIK ===
 *
 * A kapcsolotabla a MUNKALAPHOZ kotodik, nem a VERZIOHOZ -- ugyanaz a fajta
 * adat, mint a felelosok, akiket a lap allapotatol fuggetlenul lehet javitani,
 * es akik a verzio-eltéresben sem jelennek meg. Ezert nincs itt allapot-kapu,
 * es ezert nem az amend jogkor alatt all.
 *
 * === NINCS MEGEROSITO KERDES, ES EZ SEM FELEDEKENYSEG ===
 *
 * Itt a felhasznalo EGYESEVEL veszi le a jelolonegyzetet: a szandek latszik, es
 * a lepes visszafordithato (ugyanitt visszateheto). Egy ablak, ami minden
 * mentesnel felugrik, harom nap alatt lathatatlanna valik. A hibajegynel MAS a
 * helyzet: ott a helyszin valtasa NEM KERT mellekhataskent szedne le eszkozoket,
 * es azt ki kell mondani.
 */
export interface WorksheetAssetEditorProps {
  worksheetId: string;
  token: string;
  /** A lap helyszine. A valaszto ennek a RESZFAJAT listazza. */
  departmentId: string;
  assets: WorksheetAssetLink[];
  canManage: boolean;
  onSaved: (detail: WorksheetDetail) => void;
}

export function WorksheetAssetEditor({
  worksheetId,
  token,
  departmentId,
  assets,
  canManage,
  onSaved,
}: WorksheetAssetEditorProps) {
  const [selected, setSelected] = useState<string[]>(
    assets.map((asset) => asset.assetId),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A KIJELOLES A SZERVER VALASZAT KOVETI, nem a sajat elozo allapotat. Ha
   * kozben valaki MAS irta at a listat, a mentes utani valasz azt hozza -- es a
   * kepernyon nem maradhat ott egy olyan kijeloles, ami sehol nem letezik.
   */
  useEffect(() => {
    setSelected(assets.map((asset) => asset.assetId));
  }, [assets]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      /**
       * A VALASZ A TELJES RESZLETLAP, TEHAT NEM TOLTUNK UJRA -- ugyanaz az
       * indok, amit a felelos-doboz mar kimond: egy kulon lekerdezes folosleges
       * kor lenne, es a ket valasz kozott a lap mar mozdulhatott.
       */
      onSaved(
        await worksheetsApi.setAssets(token, worksheetId, {
          assetIds: selected,
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az eszközök mentése nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  const current = assets.map((asset) => asset.assetId);
  const changed =
    selected.length !== current.length ||
    selected.some((assetId) => !current.includes(assetId));

  return (
    <PilotCard>
      <PilotCardHeader title="Érintett eszközök" />
      <div className="space-y-3 p-5">
        {assets.length ? (
          <ul className="text-sm">
            {assets.map((asset) => (
              <li key={asset.id}>
                {asset.assetName}
                <span className="pl-2 text-xs text-dusk-500">
                  {asset.assetNumber}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          /* A HIANY IS ALLITAS: egy ures doboz betoltesi hibanak latszik, es a
           kezelo megvarja. Ez a mondat kimondja, hogy nincs mire varni. */
          <p className="text-sm text-dusk-500">
            Ehhez a munkalaphoz nincs eszköz csatolva.
          </p>
        )}

        {canManage ? (
          <>
            <JobAssetPicker
              departmentId={departmentId}
              selected={selected}
              onChange={setSelected}
            />
            {error ? (
              <p className="text-xs font-medium text-rose-600">{error}</p>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={!changed || saving}
              onClick={() => void save()}
            >
              {saving ? "Mentés..." : "Eszközök mentése"}
            </Button>
          </>
        ) : null}
      </div>
    </PilotCard>
  );
}
