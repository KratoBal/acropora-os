"use client";

import {
  PilotButton,
  PilotFormField,
  PilotInput,
  PilotSelect,
} from "@acropora/ui";
import type {
  AssetListItem,
  WorksheetDepartmentSummary,
  WorksheetSelectablePartner,
} from "@acropora/types";
import { useEffect, useMemo, useState } from "react";

import { PartnerPicker } from "@/components/service-jobs/partner-picker";
import { assetsApi } from "@/lib/api/assets";
import { worksheetsApi } from "@/lib/api/worksheets";
import { buildSiteOptions } from "@/lib/partners/site-tree";

import {
  addAssets,
  addSummary,
  assetLabel,
  ASSETS_MAX,
  removeAsset,
  type ListedAsset,
} from "./template-asset-list";

/** A helyszín eszközlistájának lapmérete: a végpont felső határa (`@Max(100)`). */
const LOCATION_PAGE = 100;

/**
 * A SABLON ESZKÖZLISTÁJÁNAK SZERKESZTŐJE (task t-20261117-sablon-eszkozlista, kártya 42bc1c67, PR b; Balázs, 2026-11-17: „a weben: helyszín
 * kiválasztása, ott az eszközök kijelölése, hozzáadás a sablonhoz”).
 *
 * KÉT ÚT A LISTÁHOZ: (1) partner, helyszín, a helyszín eszközei jelölőnégyzettel, „Kijelöltek hozzáadása”; (2) a gyors keresés szám vagy név
 * szerint, egy eszközre. A kettő HOZZÁAD, nem cserél: a lista fent áll, minden eszköze külön eltávolítható. A döntéseket (ismétlés, a 200-as
 * határ, a hozzáadás mondata) a `template-asset-list.ts` hozza, ez a komponens csak rajzol és tölt.
 *
 * A HELYSZÍN ESZKÖZEI A RÉSZFÁBÓL JÖNNEK (a `departmentId` szűrő a helyszín alatti egységeket is adja), és csak az üzemben lévők
 * (`IN_PLACE`): a kivezetett eszköznek nincs mit rögzíteni. Ha a lap eléri a százat, kimondjuk, hogy van több (egy csendben levágott lista
 * a legrosszabb hiba: a hiányzó eszköz úgy néz ki, mintha nem létezne).
 */
export function TemplateAssetListEditor({
  token,
  assets,
  onChange,
  readOnly,
}: {
  token: string;
  assets: readonly ListedAsset[];
  onChange: (next: ListedAsset[]) => void;
  readOnly: boolean;
}) {
  const [customer, setCustomer] = useState<WorksheetSelectablePartner | null>(
    null,
  );
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  const [departmentId, setDepartmentId] = useState("");
  const [locationAssets, setLocationAssets] = useState<AssetListItem[]>([]);
  const [locationLoaded, setLocationLoaded] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<AssetListItem[]>([]);

  const listedIds = useMemo(
    () => new Set(assets.map((item) => item.id)),
    [assets],
  );

  // a partner helyszínei
  useEffect(() => {
    setDepartmentId("");
    setLocationAssets([]);
    setChecked([]);
    if (!customer) {
      setDepartments([]);
      return;
    }
    const controller = new AbortController();
    worksheetsApi
      .departments(token, customer.customerId, controller.signal)
      .then((response) =>
        setDepartments(response.items.filter((unit) => unit.isActive)),
      )
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setProblem("A partner helyszínei nem tölthetők be.");
      });
    return () => controller.abort();
  }, [customer, token]);

  // a helyszín eszközei
  useEffect(() => {
    setChecked([]);
    setLocationAssets([]);
    setLocationLoaded(false);
    if (!departmentId) return;
    const controller = new AbortController();
    assetsApi
      .list(
        token,
        new URLSearchParams({
          departmentId,
          pageSize: String(LOCATION_PAGE),
          status: "IN_PLACE",
        }),
        controller.signal,
      )
      .then((response) => {
        setLocationAssets(response.items);
        setLocationLoaded(true);
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setProblem("A helyszín eszközei nem tölthetők be.");
      });
    return () => controller.abort();
  }, [departmentId, token]);

  // a gyors keresés: szám vagy név szerint, egy eszközre
  useEffect(() => {
    const needle = search.trim();
    if (needle.length < 2) {
      setFound([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      assetsApi
        .list(
          token,
          // csak az üzemben lévő eszközt kínáljuk (az archivált eszközt a szerver mentéskor elutasítaná: felesleges kör)
          new URLSearchParams({
            search: needle,
            pageSize: "20",
            status: "IN_PLACE",
          }),
          controller.signal,
        )
        .then((response) => setFound(response.items))
        .catch(() => setFound([]));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, token]);

  const siteOptions = useMemo(
    () => buildSiteOptions(departments),
    [departments],
  );

  const commit = (incoming: ListedAsset[]) => {
    const result = addAssets(assets, incoming);
    onChange(result.list);
    setNotice(addSummary(result));
    setProblem("");
  };

  const selectable = locationAssets.filter((asset) => !listedIds.has(asset.id));

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium text-pilot-grey-800">
          A sablon eszközei ({assets.length})
        </p>
        {assets.length === 0 ? (
          <p className="text-sm text-pilot-grey-700">
            Még nincs eszköz a listában. Válassz helyszínt lent, és add hozzá az
            eszközeit.
          </p>
        ) : (
          <ul className="max-w-xl divide-y divide-pilot-grey-200 rounded-md ring-1 ring-pilot-grey-200">
            {assets.map((asset) => (
              <li
                key={asset.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-pilot-grey-800"
              >
                <span>{asset.label}</span>
                {readOnly ? null : (
                  <button
                    type="button"
                    className="text-xs text-pilot-grey-500 underline hover:text-pilot-aqua-700"
                    aria-label={`Eltávolítás a listából: ${asset.label}`}
                    onClick={() => {
                      onChange(removeAsset(assets, asset.id));
                      setNotice("");
                    }}
                  >
                    Eltávolítás
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {notice ? (
          <p className="text-xs text-pilot-grey-700" role="status">
            {notice}
          </p>
        ) : null}
        {problem ? (
          <p className="text-xs text-red-600" role="alert">
            {problem}
          </p>
        ) : null}
      </div>

      {readOnly ? null : (
        <>
          <div className="max-w-xl space-y-3 rounded-md p-4 ring-1 ring-pilot-grey-200">
            <p className="text-sm font-medium text-pilot-grey-800">
              Hozzáadás helyszínről
            </p>
            <PilotFormField label="Partner" className="max-w-sm">
              <PartnerPicker
                variant="pilot"
                id="sablon-eszkozlista-partner"
                onPick={setCustomer}
              />
            </PilotFormField>
            {customer ? (
              <PilotFormField label="Helyszín" className="max-w-sm">
                <PilotSelect
                  aria-label="Helyszín"
                  chevron
                  value={departmentId}
                  onChange={setDepartmentId}
                >
                  <option value="">Válassz helyszínt…</option>
                  {siteOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </PilotSelect>
              </PilotFormField>
            ) : (
              <p className="text-xs text-pilot-grey-700">
                Előbb válassz partnert: a helyszínek a partner saját fájából
                jönnek.
              </p>
            )}
            {departmentId ? (
              !locationLoaded ? (
                <p className="text-sm text-pilot-grey-700">
                  Eszközök betöltése…
                </p>
              ) : locationAssets.length === 0 ? (
                <p className="text-sm text-pilot-grey-700">
                  Ezen a helyszínen nincs üzemben lévő eszköz.
                </p>
              ) : (
                <div className="space-y-2">
                  <ul className="max-h-56 space-y-1 overflow-y-auto rounded border border-pilot-grey-200 p-2">
                    {locationAssets.map((asset) => {
                      const listed = listedIds.has(asset.id);
                      return (
                        <li key={asset.id}>
                          <label className="flex items-center gap-2 text-sm text-pilot-grey-800">
                            <input
                              type="checkbox"
                              checked={listed || checked.includes(asset.id)}
                              disabled={listed}
                              onChange={() =>
                                setChecked((prev) =>
                                  prev.includes(asset.id)
                                    ? prev.filter((id) => id !== asset.id)
                                    : [...prev, asset.id],
                                )
                              }
                            />
                            <span>{assetLabel(asset)}</span>
                            {listed ? (
                              <span className="text-xs text-pilot-grey-500">
                                (már a listában)
                              </span>
                            ) : null}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {locationAssets.length >= LOCATION_PAGE ? (
                    <p className="text-xs text-amber-700">
                      A lista az első {LOCATION_PAGE} eszközt mutatja; a
                      helyszínen több lehet. Válaszd a helyszín egy alegységét,
                      vagy keress szám szerint lent.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <PilotButton
                      variant="secondary"
                      size="regular"
                      disabled={selectable.length === 0}
                      onClick={() => setChecked(selectable.map((a) => a.id))}
                    >
                      Összes kijelölése
                    </PilotButton>
                    <PilotButton
                      size="regular"
                      disabled={checked.length === 0}
                      onClick={() => {
                        commit(
                          locationAssets
                            .filter((asset) => checked.includes(asset.id))
                            .map((asset) => ({
                              id: asset.id,
                              label: assetLabel(asset),
                            })),
                        );
                        setChecked([]);
                      }}
                    >
                      Kijelöltek hozzáadása ({checked.length})
                    </PilotButton>
                  </div>
                </div>
              )
            ) : null}
          </div>

          <div className="max-w-md space-y-2">
            <PilotInput
              aria-label="Eszköz keresése"
              placeholder="Keresés számra vagy névre (legalább 2 karakter)…"
              value={search}
              onChange={setSearch}
            />
            {found.length ? (
              <ul className="divide-y divide-pilot-grey-200 rounded-md ring-1 ring-pilot-grey-200">
                {found.map((asset) => (
                  <li key={asset.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm text-pilot-grey-800 hover:bg-pilot-grey-50"
                      onClick={() => {
                        commit([{ id: asset.id, label: assetLabel(asset) }]);
                        setSearch("");
                        setFound([]);
                      }}
                    >
                      {assetLabel(asset)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      )}
      <p className="text-xs text-pilot-grey-500">
        Egy sablonban legfeljebb {ASSETS_MAX} eszköz lehet.
      </p>
    </div>
  );
}
