"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  FormField,
  Input,
  ServiceDataGrid,
  ServiceDataItem,
  ServiceDetailHeader,
  ServiceDetailSplit,
  ServicePanel,
  ServicePanelHeading,
} from "@acropora/ui";
import {
  aquariumMeasurementParametersFor,
  type AquariumMeasurementOccasion,
  type AssetListResponse,
} from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { WATER_TYPE_LABEL } from "@/lib/aquarium-labels";
import { Message } from "./ticket-list";

/**
 * AZ AKVÁRIUM ADATLAPJA A PARTNER PORTÁLON.
 *
 * Ugyanaz a keret, mint az `AssetDetail`-nél: `ServiceDetailHeader`/
 * `ServiceDetailSplit`/`ServicePanel`/`ServiceDataItem` -- az "app.acropora.hu
 * elrendezésével" mandátum (Balázs, 2026-09-21) ide is vonatkozik, és a
 * meglévő három adatlap (jegy, munkalap, eszköz) ugyanezt a családot
 * használja. Az akvárium BELSŐ, Figma-átültetett adatlapja pilot-stílusú
 * (`pilot-aquarium-editor-page.tsx`), DE ez a lap a PORTÁL saját, meglévő
 * tartalom-nyelvét követi, nem a belső pilot-stílust -- a portál sidebarja
 * (`portal-shell.tsx`) már pilot-tokent visel, a tartalom viszont eddig
 * mindenhol a régi családban maradt, és egy vegyes lap (pilot sidebar +
 * pilot tartalom EGY helyen, régi tartalom mindenhol máshol) rosszabb
 * lenne, mint egy következetes régi tartalom-nyelv, amíg a portál teljes
 * tartalma át nem kerül.
 *
 * === A HATÓKÖRT A SZERVER SZABJA, IDEGEN AKVÁRIUMRA 404 JÖN ===
 *
 * Ugyanaz a minta, mint az `AssetDetail`-nél: a kliens nem szűr, a
 * `partnerApi.aquarium(id)` egyenesen a szerver válaszát adja vissza.
 *
 * === "ESZKÖZÖK A MEDENCÉBEN": CSAK OLVASÁS, A HOZZÁRENDELÉS NEM EBBEN A
 *     KÖRBEN ===
 *
 * Balázs döntése (2026-09-25): "a portálon az akváriumhoz rendelt Assetek
 * látszanak és rendelhetők hozzá, a helyszín eszközei közül." A LÁTÁS
 * ehhez a körhöz kész (`assets({aquariumId})`, a szerver már ismeri ezt a
 * szűrőt). A HOZZÁRENDELÉS (`PATCH /service/assets/:id` `aquariumId`
 * mezővel) VISZONT ÜTKÖZIK egy KORÁBBI, kifejezett Balázs-döntéssel: az
 * `AssetDetail` fejléce szerint a portál SZÁNDÉKOSAN nem ad szerkesztést
 * az eszközökön, még úgy is, hogy a `PARTNER_SERVICE` szerep MA MEGKAPJA a
 * `SERVICE_MANAGE` jogot (lásd ott, "EZ NEM JOGOSULTSÁG-FÜGGŐ
 * MEGJELENÍTÉS, LEZÁRT DÖNTÉS"). Az akvárium-döntés újabb és
 * konkrétabb, DE mielőtt egy ÍRÁSI utat nyitnék az Asset-en a portálról,
 * ez a kettő ütközés megér egy külön visszakérdezést -- ezért ez a kör
 * CSAK a listát adja, a hozzárendelő felület egy KÖVETKEZŐ, jóváhagyott
 * kör.
 *
 * === "ÚJ MÉRÉS": NYITOTT, A SZERVER SAJÁT HATÓKÖRÉVEL ===
 *
 * A `POST /aquariums/:id/measurements` a #1116 óta elérhető
 * `PARTNER_SERVICE`-nek, a hívó SAJÁT (látható) akváriumaira szűkítve --
 * lásd `aquarium-measurements.service.ts` `create()`-jét. A paraméter-
 * katalógus a víztípus szerint szűrt, valódi lista
 * (`aquariumMeasurementParametersFor`), nem a Figma terv fix nyolcas
 * listája -- ugyanaz a szabály, mint a belső "Vízértékek" kártyánál.
 */
export function AquariumDetail({ id }: { id: string }) {
  const [aquarium, setAquarium] = useState<Awaited<
    ReturnType<typeof partnerApi.aquarium>
  > | null>(null);
  const [occasions, setOccasions] = useState<AquariumMeasurementOccasion[]>([]);
  const [assets, setAssets] = useState<AssetListResponse["items"]>([]);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const detail = await partnerApi.aquarium(id);
      setAquarium(detail);
      const [measurements, assetList] = await Promise.all([
        partnerApi.aquariumMeasurements(id),
        partnerApi.assets({ aquariumId: id, status: "ALL", pageSize: 100 }),
      ]);
      setOccasions(measurements.occasions);
      setAssets(assetList.items);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az akvárium nem tölthető be.",
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const parameters = aquariumMeasurementParametersFor(
    aquarium?.waterType ?? undefined,
  );

  async function submitMeasurement() {
    const entries = Object.entries(values).filter(
      ([, raw]) => raw.trim() !== "",
    );
    if (entries.length === 0) {
      setSaveError("Adjon meg legalább egy paramétert.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await partnerApi.createAquariumMeasurement(id, {
        values: entries.map(([parameterCode, raw]) => ({
          parameterCode,
          value: Number(raw.replace(",", ".")),
        })),
      });
      setValues({});
      setFormOpen(false);
      await load();
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "A mérés nem menthető.",
      );
    } finally {
      setSaving(false);
    }
  }

  // A `content` osztaly indoka mindharom visszateresen: lasd
  // `settings.tsx` azonos megjegyzeset.
  if (error)
    return (
      <section className="content flex flex-col gap-4">
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </section>
    );
  if (!aquarium)
    return (
      <p className="content text-[13px] text-muted">Akvárium betöltése…</p>
    );

  const latest = occasions[0];

  return (
    <section className="content flex flex-col gap-4">
      <VisszaLink />
      <ServiceDetailHeader
        eyebrow="AKVÁRIUM"
        title={aquarium.name}
        sub={aquarium.aquariumNumber}
      />

      <ServiceDetailSplit
        main={
          <>
            <ServicePanel>
              <ServiceDataGrid>
                <ServiceDataItem label="Helyszín">
                  {aquarium.departmentName ?? "Nincs megadva"}
                </ServiceDataItem>
                <ServiceDataItem label="Víztérfogat">
                  {aquarium.systemVolumeLiters !== undefined
                    ? `${aquarium.systemVolumeLiters.toLocaleString("hu-HU")} l`
                    : "Nincs megadva"}
                </ServiceDataItem>
                <ServiceDataItem label="Víztípus">
                  {aquarium.waterType
                    ? WATER_TYPE_LABEL[aquarium.waterType]
                    : "Nincs megadva"}
                </ServiceDataItem>
              </ServiceDataGrid>
            </ServicePanel>

            <ServicePanel>
              <ServicePanelHeading
                title="Vízértékek"
                action={
                  <Button
                    variant="secondary"
                    onClick={() => setFormOpen((open) => !open)}
                  >
                    {formOpen ? "Mégse" : "+ Új mérés"}
                  </Button>
                }
              />

              {formOpen ? (
                <div className="mb-4 flex flex-col gap-3 border-b border-dusk-200 pb-4">
                  <p className="text-[13px] text-muted">
                    Csak a kitöltött sorokat menti a rendszer.
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {parameters.map((param) => (
                      <FormField key={param.code} label={param.label}>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={values[param.code] ?? ""}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [param.code]: event.target.value,
                            }))
                          }
                        />
                      </FormField>
                    ))}
                  </div>
                  {saveError ? (
                    <p className="text-[13px] text-red-600">{saveError}</p>
                  ) : null}
                  <div>
                    <Button
                      disabled={saving}
                      onClick={() => void submitMeasurement()}
                    >
                      Mérés mentése
                    </Button>
                  </div>
                </div>
              ) : null}

              {occasions.length === 0 ? (
                <p className="text-[13px] text-muted">
                  Ehhez az akváriumhoz még nem rögzítettünk mérést.
                </p>
              ) : (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(latest?.values ?? []).map((value) => {
                      const param = parameters.find(
                        (p) => p.code === value.parameterCode,
                      );
                      return (
                        <div
                          key={value.parameterCode}
                          className="rounded-lg bg-dusk-50 p-2.5"
                        >
                          <p className="mb-0.5 text-[10px] text-muted">
                            {param?.label ?? value.parameterCode}
                          </p>
                          <p className="font-mono text-sm font-semibold text-ink">
                            {value.value}
                            {param?.unit ? (
                              <span className="ml-0.5 text-[10px] font-normal text-muted">
                                {param.unit}
                              </span>
                            ) : null}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] border-collapse text-left">
                      <thead>
                        <tr>
                          {["Mérés ideje", "Rögzítette"].map((head) => (
                            <th
                              key={head}
                              className="border-b border-dusk-200 pb-1.5 text-[11px] font-semibold text-muted"
                            >
                              {head}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {occasions.map((occasion) => (
                          <tr key={occasion.id}>
                            <td className="border-b border-dusk-100 py-1.5 text-[13px] text-ink">
                              {new Date(occasion.measuredAt).toLocaleString(
                                "hu-HU",
                              )}
                            </td>
                            <td className="border-b border-dusk-100 py-1.5 text-[13px] text-muted">
                              {occasion.measuredByName ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </ServicePanel>
          </>
        }
        side={
          <ServicePanel>
            <ServicePanelHeading title="Eszközök a medencében" />
            {assets.length === 0 ? (
              <p className="text-[13px] text-muted">
                Nincs ehhez az akváriumhoz csatolt eszköz.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {assets.map((asset) => (
                  <li
                    key={asset.id}
                    className="border-b border-dusk-100 pb-2 last:border-0 last:pb-0"
                  >
                    <Link
                      href={`/eszkozok/${asset.id}`}
                      className="text-[13px] font-medium text-ink no-underline hover:underline"
                    >
                      {asset.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ServicePanel>
        }
      />
    </section>
  );
}

function VisszaLink() {
  return (
    <Link
      className="text-[13px] text-muted no-underline hover:text-ink"
      href="/akvariumok"
    >
      ← Akváriumok
    </Link>
  );
}
