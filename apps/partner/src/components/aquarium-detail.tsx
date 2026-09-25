"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  FormField,
  Input,
  Select,
  ServiceDataGrid,
  ServiceDataItem,
  ServiceDetailHeader,
  ServiceDetailSplit,
  ServicePanel,
  ServicePanelHeading,
} from "@acropora/ui";
import {
  aquariumMeasurementParametersFor,
  hasPermission,
  PERMISSIONS,
  type AquariumMeasurementOccasion,
  type AssetListResponse,
} from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { WATER_TYPE_LABEL } from "@/lib/aquarium-labels";
import { useAuth } from "./auth";
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
 * === "ESZKÖZÖK A MEDENCÉBEN": HOZZÁRENDELÉS KÜLÖN JOGGAL (emlék 1843,
 *     2026-09-25 14:24 UTC) ===
 *
 * Balázs első döntése (2026-09-25 korábban): "a portálon az akváriumhoz
 * rendelt Assetek látszanak és rendelhetők hozzá, a helyszín eszközei
 * közül." A LÁTÁS attól a körtől kész volt. A HOZZÁRENDELÉS
 * (`PATCH /service/assets/:id` `aquariumId` mezővel) VISZONT ÜTKÖZÖTT egy
 * KORÁBBI döntéssel: az `AssetDetail` fejléce szerint a portál
 * szándékosan nem ad szerkesztést az eszközökön, még úgy is, hogy a
 * `PARTNER_SERVICE` szerep megkapja a `SERVICE_MANAGE` jogot. Ezt az
 * ütközést Balázs 14:24-kor feloldotta: az akvárium-hozzárendelés/levétel
 * KÜLÖN jogosultsághoz kötött (`SERVICE_ASSET_AQUARIUM_ASSIGN`), és ez a
 * jog SZÁNDÉKOSAN NEM azonos a `SERVICE_MANAGE`-dzsel -- az eszköz többi
 * mezője a portálon TOVÁBBRA IS csak olvasható, csak ez az egy kapcsolat
 * nyílt meg, egy DEDIKÁLT, szűk végponton (`PATCH :id/aquarium`,
 * `AssignAssetAquariumDto`, csak `aquariumId` + `expectedUpdatedAt`).
 *
 * A JOGOT MA MINDEN `PARTNER_SERVICE` FIÓK MEGKAPJA (javaslat, lásd
 * `auth.ts` `SERVICE_ASSET_AQUARIUM_ASSIGN`/`PARTNER_SERVICE` fejlécét a
 * bizonytalanságról) -- ezért a lenti `canAssign` egyszerű jog-ellenőrzés,
 * nem `user.navigation`-alapú kapu: ez NEM egy egész menüpont/útvonal
 * láthatóságáról dönt (ahol egy régi élő API mellett egy törött útvonal
 * lenne a kockázat), hanem egy MEGLÉVŐ, már elérhető lapon egy gomb
 * megjelenítéséről -- ha a hívó mégis rákattintana egy régi API mellett,
 * a szerver egyszerűen 403-at ad, biztonságos, várt bukás, ugyanúgy, ahogy
 * minden más lapbeli jog-ellenőrzés ebben az alkalmazásban.
 *
 * A HOZZÁRENDELHETŐ JELÖLTEK az akvárium SAJÁT helyszínének (`departmentId`)
 * MÉG NEM CSATOLT eszközei -- `assets({departmentId})`, kiszűrve azokat,
 * amiknek már van `aquarium` mezőjük. Ha az akváriumnak nincs helyszíne
 * (`departmentId` hiányzik), nincs jelölt-forrás, a felület ezt kimondja.
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
  const { user } = useAuth();
  const canAssign = Boolean(
    user && hasPermission(user, PERMISSIONS.SERVICE_ASSET_AQUARIUM_ASSIGN),
  );

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

  const [candidates, setCandidates] = useState<AssetListResponse["items"]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

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

  const departmentId = aquarium?.departmentId;

  const loadCandidates = useCallback(async () => {
    if (!canAssign || !departmentId) {
      setCandidates([]);
      return;
    }
    try {
      const result = await partnerApi.assets({
        departmentId,
        status: "ALL",
        pageSize: 100,
      });
      // CSAK A MÉG SEHOVA NEM CSATOLT ESZKÖZÖK -- egy már más akváriumhoz
      // kötött eszköz nem jelenik meg jelöltként; a levétel a MÁSIK
      // akvárium adatlapjáról megy, nem innen "lopjuk el".
      setCandidates(result.items.filter((item) => !item.aquarium));
    } catch {
      // A JELÖLT-LISTA HIBÁJA NEM TÖRLI AZ OLDALT -- a "Eszközök a
      // medencében" kártya a MÁR csatolt eszközöket enélkül is mutatja, a
      // hozzárendelő rész marad üres választóval.
      setCandidates([]);
    }
  }, [canAssign, departmentId]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  async function removeAsset(asset: AssetListResponse["items"][number]) {
    setAssignBusy(true);
    setAssignError(null);
    try {
      await partnerApi.assignAssetAquarium(asset.id, {
        aquariumId: null,
        expectedUpdatedAt: asset.updatedAt,
      });
      await load();
      await loadCandidates();
    } catch (cause) {
      setAssignError(
        cause instanceof Error
          ? cause.message
          : "Az eszköz nem vehető le az akváriumról.",
      );
    } finally {
      setAssignBusy(false);
    }
  }

  async function assignSelected() {
    const candidate = candidates.find(
      (item) => item.id === selectedCandidateId,
    );
    if (!candidate) return;
    setAssignBusy(true);
    setAssignError(null);
    try {
      await partnerApi.assignAssetAquarium(candidate.id, {
        aquariumId: id,
        expectedUpdatedAt: candidate.updatedAt,
      });
      setSelectedCandidateId("");
      await load();
      await loadCandidates();
    } catch (cause) {
      setAssignError(
        cause instanceof Error
          ? cause.message
          : "Az eszköz nem rendelhető hozzá.",
      );
    } finally {
      setAssignBusy(false);
    }
  }

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

  if (error)
    return (
      <section className="flex flex-col gap-4">
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </section>
    );
  if (!aquarium)
    return <p className="text-[13px] text-muted">Akvárium betöltése…</p>;

  const latest = occasions[0];

  return (
    <section className="flex flex-col gap-4">
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
            {assignError ? (
              <Alert
                className="mb-3"
                variant="danger"
                title="Hiba történt"
                description={assignError}
              />
            ) : null}
            {assets.length === 0 ? (
              <p className="text-[13px] text-muted">
                Nincs ehhez az akváriumhoz csatolt eszköz.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {assets.map((asset) => (
                  <li
                    key={asset.id}
                    className="flex items-center justify-between gap-2 border-b border-dusk-100 pb-2 last:border-0 last:pb-0"
                  >
                    <Link
                      href={`/eszkozok/${asset.id}`}
                      className="text-[13px] font-medium text-ink no-underline hover:underline"
                    >
                      {asset.name}
                    </Link>
                    {canAssign ? (
                      <button
                        type="button"
                        disabled={assignBusy}
                        onClick={() => void removeAsset(asset)}
                        className="shrink-0 text-xs text-rose-600 hover:underline disabled:opacity-50"
                      >
                        Eltávolítás
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {/*
              A HOZZÁRENDELŐ RÉSZ CSAK A JOGOSULT HÍVÓNAK LÁTSZIK -- lásd a
              fájl fejlécét: ez lapbeli gomb-láthatóság, nem útvonal-kapu,
              tehát a kliens-oldali `canAssign` biztonságos (a szerver 403-at
              ad, ha mégis rákattintana valaki, akinek régi API mellett a
              joga nincs meg).
            */}
            {canAssign ? (
              <div className="mt-3 border-t border-dusk-100 pt-3">
                {!departmentId ? (
                  <p className="text-[13px] text-muted">
                    Az akváriumnak nincs megadva helyszíne, ezért nem lehet
                    eszközt hozzárendelni.
                  </p>
                ) : candidates.length === 0 ? (
                  <p className="text-[13px] text-muted">
                    A helyszínen nincs hozzárendelhető (még sehova nem csatolt)
                    eszköz.
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedCandidateId}
                      onChange={(event) =>
                        setSelectedCandidateId(event.target.value)
                      }
                      aria-label="Hozzárendelhető eszköz"
                      disabled={assignBusy}
                    >
                      <option value="">Válasszon eszközt</option>
                      {candidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="secondary"
                      disabled={!selectedCandidateId || assignBusy}
                      onClick={() => void assignSelected()}
                    >
                      Hozzárendelés
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
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
