"use client";

import { Button, ConfirmDialog } from "@acropora/ui";
import type {
  ServiceJobAssetLink,
  ServiceJobDetail,
  WorksheetDepartmentSummary,
} from "@acropora/types";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ServicePanel,
  ServicePanelHeading,
} from "@/components/service/service-detail-chrome";
import { buildSiteOptions } from "@/lib/partners/site-tree";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { worksheetsApi } from "@/lib/api/worksheets";

import { JobAssetPicker } from "./job-asset-picker";

/**
 * A JEGY HELYSZINE ES AZ OTT ALLO ESZKOZOK, A FELVITEL UTAN.
 *
 * Balazs kerese, 2026-09-16, Discord (Acropora OS szal), szo szerint: "Meglevo
 * hibajegynel ugyanigy jo lenne ha hozza lehetne adni eszkozt. illetve a
 * helyszint is jo lenne ha leehtne modositani".
 *
 * === EGY DOBOZ A KETTORE, MERT EGY MUVELET ===
 *
 * A szerveren is egy vegpont (`POST :id/placement`) viszi oket, es az indok ott
 * all a DTO jegyzeteben. A feluleten ugyanaz latszik: ket kulon gomb azt
 * igerne, hogy kulon-kulon menthetok -- es aki eloszor a helyszint valtja, egy
 * olyan allapotot hozna letre, amit a felvitel sosem enged meg.
 *
 * === A LEESO ESZKOZOKET MEGNEVEZZUK, ES A FELHASZNALO DONT ===
 *
 * Helyszin-valtaskor a regi helyszin eszkozei nem allnak az UJ reszfajan. A
 * kerdes NEM az, hogy leszedjuk-e oket csendben: a doboz KIIRJA, melyik esne
 * le, es megerosites nelkul nem kuld. Ami a megerositesbol kijon, az utazik a
 * keresben -- a szerver tehat soha nem szed le olyat, amit a felhasznalo nem
 * latott.
 *
 * === A HELYSZIN NEM URITHETO ===
 *
 * Nincs "Nincs megadva" opcio a valasztoban, es ez elter a FELVITELTOL, ahol
 * van. Ott a helyszin meg nem letezik; itt egy urites az OSSZES eszkozt
 * leszedne a jegyrol, es erre nincs keres. Ami viszont van: a helyszin NELKULI
 * jegy -- azon ez a doboz az ELSO beallitast vegzi, es olyankor nincs leeso
 * eszkoz.
 */
export interface ServiceJobPlacementEditorProps {
  jobId: string;
  token: string;
  customerId: string | null;
  departmentId: string | null;
  departmentPath: string[] | null;
  assets: ServiceJobAssetLink[];
  canManage: boolean;
  onSaved: (detail: ServiceJobDetail) => void;
}

export function ServiceJobPlacementEditor({
  jobId,
  token,
  customerId,
  departmentId,
  departmentPath,
  assets,
  canManage,
  onSaved,
}: ServiceJobPlacementEditorProps) {
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  const [unit, setUnit] = useState(departmentId ?? "");
  const [assetIds, setAssetIds] = useState<string[]>(
    assets.map((asset) => asset.assetId),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  /**
   * A KEPERNYO A SZERVER VALASZAT KOVETI, nem a sajat elozo allapotat. Ha
   * kozben valaki MAS irta at a jegyet, a mentes utani valasz azt hozza -- es a
   * kepernyon nem maradhat ott egy olyan kijeloles, ami sehol nem letezik.
   */
  useEffect(() => {
    setUnit(departmentId ?? "");
  }, [departmentId]);
  useEffect(() => {
    setAssetIds(assets.map((asset) => asset.assetId));
  }, [assets]);

  /**
   * CSAK AZ AKTIV SOROK, ugyanugy, mint a felvitelen es a munkalapon:
   * archivalt egysegre ne lehessen jegyet atsorolni. A harom helyen ugyanaz a
   * szures all, tehat a felajanlott halmaz sem tud elcsuszni egymastol.
   */
  const loadDepartments = useCallback(
    async (owner: string, signal?: AbortSignal) => {
      if (!owner) {
        setDepartments([]);
        setDepartmentsLoaded(false);
        return;
      }
      try {
        const response = await worksheetsApi.departments(token, owner, signal);
        setDepartments(response.items.filter((item) => item.isActive));
        setDepartmentsLoaded(true);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError("A partner helyszínei nem tölthetők be.");
      }
    },
    [token],
  );

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    void loadDepartments(customerId ?? "", controller.signal);
    return () => controller.abort();
  }, [canManage, customerId, loadDepartments]);

  /**
   * A VALASZTO A TELJES UTAT MUTATJA, NEM CSAK A LEVEL NEVET. A kod es a nev
   * csak TESTVEREK kozott egyedi (ADR-010), tehat ket kulonbozo ag alatt
   * ugyanaz a "Biodom" megengedett.
   */
  const options = useMemo(() => buildSiteOptions(departments), [departments]);

  /**
   * MELYIK MAI ESZKOZ ESNE LE AZ UJ HELYSZINNEL.
   *
   * A VALASZTOBOL VEZETJUK LE, NEM TALALGATASBOL: a `JobAssetPicker` a
   * valasztott helyszin RESZFAJAT listazza, es amit a felhasznalo ott
   * kivalasztva hagy, az bizonyitottan ott all. Ami a mai halmazbol kimaradt,
   * az esne le.
   *
   * URES HELYSZINNEL (meg nincs valasztva) NEM allitunk semmit: ott nincs mihez
   * kepest leesni.
   */
  const dropping = useMemo(
    () =>
      unit === "" ? [] : assets.filter((a) => !assetIds.includes(a.assetId)),
    [assets, assetIds, unit],
  );

  const changed =
    unit !== (departmentId ?? "") ||
    assetIds.length !== assets.length ||
    assets.some((asset) => !assetIds.includes(asset.assetId));

  const save = async () => {
    setSaving(true);
    setError(null);
    setConfirming(false);
    try {
      /**
       * A VALASZ A TELJES RESZLETLAP, TEHAT NEM TOLTUNK UJRA -- ugyanaz az
       * indok, amit a delegalas-doboz mar kimond: egy kulon lekerdezes
       * folosleges kor lenne, es a ket valasz kozott a jegy mar mozdulhatott.
       */
      onSaved(
        await serviceJobsApi.setPlacement(token, jobId, {
          departmentId: unit,
          assetIds,
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A helyszín és az eszközök mentése nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ServicePanel className="space-y-3">
      <ServicePanelHeading title="Helyszín és eszközök" />
      {/*
        A MAI ALLAPOT AKKOR IS LATSZIK, HA A HIVO NEM SZERKESZTHET. Eddig a
        jegy eszkozei CSAK a naploban jelentek meg, esemenykent -- egy lista,
        amit a kezelo nem tud egyben atnezni. A ket jog ugyanaz, amit a szerver
        kulonboztet: `service.view` olvas, `service.manage` ir.
      */}
      <div className="text-sm">
        <p>
          <span className="text-dusk-500">Helyszín: </span>
          {departmentPath?.length
            ? departmentPath.join(" / ")
            : "Nincs megadva"}
        </p>
        {assets.length ? (
          <ul className="mt-1">
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
          <p className="mt-1 text-dusk-500">
            Ehhez a jegyhez nincs eszköz rendelve.
          </p>
        )}
      </div>

      {canManage ? (
        <>
          {customerId === null ? (
            /* KULON MONDAT, MERT MAS A TEENDO: nem "ismeretlen egyseg", hanem
               ertelmetlen keres -- helyszine csak partnernek van. A szerver
               ugyanezt utasitja el, csak egy korrel kesobb. */
            <p className="text-sm text-dusk-500">
              Ehhez a hibajegyhez még nincs partner, ezért helyszínt sem lehet
              megadni.
            </p>
          ) : !departmentsLoaded ? (
            <p className="text-sm text-dusk-500">Helyszínek betöltése...</p>
          ) : options.length === 0 ? (
            <p className="text-sm text-dusk-500">
              Ehhez a partnerhez nincs felvéve helyszín.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <label
                  className="block text-sm font-semibold"
                  htmlFor="jegy-helyszin-modositas"
                >
                  Helyszín
                </label>
                <select
                  id="jegy-helyszin-modositas"
                  className="w-full rounded border px-2 py-1 text-sm"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                >
                  {/*
                    AZ URES OPCIO CSAK AKKOR ALL ITT, HA A JEGYNEK MA SINCS
                    HELYSZINE -- kulonben a valaszto felkinalna az URITEST, amit
                    a szerver nem fogad el. Egy opcio, ami mindig 400-at ad,
                    rosszabb a hianyanal: a felhasznalo azt hiszi, elromlott.
                  */}
                  {departmentId === null ? (
                    <option value="">Válassz helyszínt</option>
                  ) : null}
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-sm font-semibold">Érintett eszközök</span>
                {/*
                  UGYANAZ A VALASZTO, AMIT A FELVITEL HASZNAL, es nem masolat:
                  a `JobAssetPicker` harom bemenetet vesz (helyszin,
                  kivalasztottak, visszahivas), es semmi felvitel-specifikus
                  nincs benne. A matricakod-mezo is vele jon.
                */}
                <JobAssetPicker
                  departmentId={unit}
                  selected={assetIds}
                  onChange={setAssetIds}
                />
              </div>
              {error ? (
                <p className="text-xs font-medium text-rose-600">{error}</p>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={!changed || saving || unit === ""}
                onClick={() => {
                  /*
                    A KERDES CSAK AKKOR JON, HA VAN MIT ELVESZITENI. Egy
                    megerosito ablak, ami minden mentesnel felugrik, harom nap
                    alatt lathatatlanna valik -- es akkor azt sem olvassa el
                    senki, amikor tenylegesen leesik valami.
                  */
                  if (dropping.length > 0) setConfirming(true);
                  else void save();
                }}
              >
                {saving ? "Mentés..." : "Helyszín és eszközök mentése"}
              </Button>
            </>
          )}
        </>
      ) : null}

      {/*
        A KERDES HAROM RESZE, ES A HARMADIK ITT NEM UDVARIASSAG: a levetel
        VISSZAFORDITHATO -- az eszkoz megmarad, csak nem all ezen a jegyen, es
        ugyanitt visszatehető. Egy kerdes, ami nem mondja meg, van-e visszaut,
        ugyanugy megijeszt egy artalmatlan lepesnel, mint egy veglegesnel.
      */}
      <ConfirmDialog
        open={confirming}
        title="Leveszed ezeket az eszközöket a hibajegyről?"
        consequence={`Az új helyszínen nem áll: ${dropping
          .map((asset) => `${asset.assetName} (${asset.assetNumber})`)
          .join(", ")}. A mentés után nem lesz rajta a jegyen.`}
        recovery="Visszatehető: az eszköz megmarad a nyilvántartásban, és a régi helyszínt visszaválasztva ugyanitt újra felvehető."
        confirmLabel="Mentés"
        busy={saving}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    </ServicePanel>
  );
}
