"use client";

import type { AssetListItem } from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { assetsApi } from "@/lib/api/assets";

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
   * A BETOLTOTTSEG KULON ALL AZ URES LISTATOL. Harom allapot van, es harom
   * kulon mondatot erdemel: nincs helyszin / meg toltunk / nincs eszkoz. Egy
   * ures lista magyarazat nelkul ugy nez ki, mint egy betoltesi hiba.
   */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!departmentId)
    return (
      <p className="text-sm text-slate-500">
        Előbb válassz helyszínt. Az eszközök a helyszínhez és az alatta lévő
        egységekhez tartoznak.
      </p>
    );

  if (error) return <p className="text-sm text-red-600">{error}</p>;

  if (!loaded)
    return <p className="text-sm text-slate-500">Eszközök betöltése...</p>;

  if (assets.length === 0)
    return (
      <p className="text-sm text-slate-500">
        Ezen a helyszínen nincs nyilvántartott eszköz. A jegy enélkül is
        megnyitható.
      </p>
    );

  return (
    <div className="space-y-1">
      <ul className="max-h-56 space-y-1 overflow-y-auto rounded border p-2">
        {assets.map((asset) => (
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
                <span className="pl-2 text-xs text-slate-500">
                  {asset.assetNumber}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {/*
        A LEVAGAS KIMONDVA. A vegpont felso hatara szaz sor: ha egy helyszinen
        ennyi eszkoz all, a lista MAR hianyos lehet, es ezt latnia kell annak,
        aki valaszt. Egy csendben levagott lista rosszabb a hibanal: a hianyzo
        eszkoz ugy nez ki, mintha nem letezne.
      */}
      {assets.length === 100 ? (
        <p className="text-xs text-amber-700">
          Száz eszköznél megáll a lista. Ha a keresett nincs köztük, szűkíts
          lejjebb a helyszín fájában.
        </p>
      ) : null}
    </div>
  );
}
