"use client";
import { Alert, ConfirmDialog, Icon } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type AquariumEquipment,
  type AquariumEquipmentKind,
  type AquariumMaintainer,
  type AquariumOwnershipType,
  type CreateAquariumEquipmentInput,
  type WaterBodyType,
  type WaterType,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import { aquariumsApi } from "@/lib/api/aquariums";
import { CustomerPicker, type CustomerSelection } from "../customer-picker";
import {
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_KIND_OPTIONS,
  OWNERSHIP_LABEL,
  WATER_BODY_LABEL,
  WATER_TYPE_LABEL,
} from "../aquarium-labels";
import { PilotAquariumWaterValues } from "./pilot-aquarium-water-values";
import {
  PilotAvatar,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
  PilotSegmentedControl,
  PilotSelect,
  PilotThemeRoot,
  pilotAvatarColor,
  pilotInitials,
} from "./pilot-ui";

const EMPTY_NEW_EQUIPMENT: CreateAquariumEquipmentInput = {
  kind: "VILAGITAS",
  quantity: 1,
};

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- ADATLAP/ÚJ FELVITEL.
 *
 * Balázs döntése (2026-09-24 18:14 UTC, Eldöntendő szál, message_id
 * 1552714695515840575): "és a figma lesz a default, leveheted a Mai
 * felület választót és használd a figmat." A korábbi váltó (`PilotToggle`)
 * és a régi `AquariumEditorPage` ezért TÖRÖLVE -- ez a komponens az
 * EGYETLEN, ami az `/akvariumok/uj` és az `/akvariumok/[aquariumId]`
 * útvonalon fut.
 *
 * A FIGMA TERVBEN A DETAIL EGY KÜLÖN, CSAK-OLVASÓ KÉPERNYŐ, "Szerkesztés"
 * ceruza-gombbal. EBBEN A RENDSZERBEN NINCS ILYEN MÓD -- az adatlap MINDIG
 * szerkeszthető űrlap (lásd `[aquariumId]/page.tsx`). A brief eredeti "a
 * mai működéssel" kikötése szerint ezt NEM változtattuk: csak a Figma
 * Detail képernyő KÁRTYA-ELRENDEZÉSÉT vettük át (Alapadatok / Berendezések
 * balra, Vízértékek jobbra) -- a "Szerkesztés" gomb tehát itt nincs.
 */
export function PilotAquariumEditorPage({
  aquariumId,
}: {
  aquariumId?: string;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const isEdit = Boolean(aquariumId);
  const [loading, setLoading] = useState(isEdit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState("");

  const [ownershipType, setOwnershipType] =
    useState<AquariumOwnershipType>("OWN");
  const [customerSelection, setCustomerSelection] = useState<CustomerSelection>(
    {},
  );
  const [name, setName] = useState("");
  const [waterBodyType, setWaterBodyType] = useState<WaterBodyType>("AKVARIUM");
  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [volumeLiters, setVolumeLiters] = useState("");
  const [volumeIsManual, setVolumeIsManual] = useState(false);
  const [waterType, setWaterType] = useState<WaterType | "">("");
  const [startedAt, setStartedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [equipment, setEquipment] = useState<AquariumEquipment[]>([]);
  const [newEquipment, setNewEquipment] =
    useState<CreateAquariumEquipmentInput>(EMPTY_NEW_EQUIPMENT);
  const [pendingRemoval, setPendingRemoval] =
    useState<AquariumEquipment | null>(null);
  const [maintainers, setMaintainers] = useState<AquariumMaintainer[]>([]);
  const [customerEmail, setCustomerEmail] = useState<string | undefined>(
    undefined,
  );
  const [selectableMaintainers, setSelectableMaintainers] = useState<
    AquariumMaintainer[]
  >([]);
  const [maintainersBusy, setMaintainersBusy] = useState(false);

  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.AQUARIUMS_MANAGE),
  );

  useEffect(() => {
    if (!aquariumId) return;
    let active = true;
    aquariumsApi
      .detail(token, aquariumId)
      .then((detail) => {
        if (!active) return;
        setOwnershipType(detail.ownershipType);
        setCustomerSelection(
          detail.customerId
            ? {
                customerId: detail.customerId,
                customerLabel: detail.customerName,
              }
            : {},
        );
        setName(detail.name);
        setWaterBodyType(detail.waterBodyType);
        setLengthCm(detail.lengthCm != null ? String(detail.lengthCm) : "");
        setWidthCm(detail.widthCm != null ? String(detail.widthCm) : "");
        setHeightCm(detail.heightCm != null ? String(detail.heightCm) : "");
        setVolumeLiters(
          detail.systemVolumeLiters != null
            ? String(detail.systemVolumeLiters)
            : "",
        );
        setVolumeIsManual(detail.systemVolumeIsManual);
        setWaterType(detail.waterType ?? "");
        setStartedAt(detail.startedAt ? detail.startedAt.slice(0, 10) : "");
        setNotes(detail.notes ?? "");
        setEquipment(detail.equipment);
        setMaintainers(detail.maintainers);
        setCustomerEmail(detail.customerEmail);
        setExpectedUpdatedAt(detail.updatedAt);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Az akvárium nem tölthető be.",
        ),
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [aquariumId, token]);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    aquariumsApi
      .selectableMaintainers(token)
      .then((list) => {
        if (active) setSelectableMaintainers(list);
      })
      .catch(() => {
        // Csendben marad, lásd a mai editor ugyanezen effektusát.
      });
    return () => {
      active = false;
    };
  }, [token, canManage]);

  useEffect(() => {
    if (volumeIsManual) return;
    if (lengthCm && widthCm && heightCm) {
      const liters =
        (Number(lengthCm) * Number(widthCm) * Number(heightCm)) / 1000;
      setVolumeLiters(
        Number.isFinite(liters) ? String(Math.round(liters * 10) / 10) : "",
      );
    }
  }, [lengthCm, widthCm, heightCm, volumeIsManual]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const basePayload = {
        ownershipType,
        customerId:
          ownershipType === "CUSTOMER"
            ? customerSelection.customerId
            : undefined,
        newCustomer:
          ownershipType === "CUSTOMER"
            ? customerSelection.newCustomer
            : undefined,
        name,
        waterBodyType,
        lengthCm: lengthCm ? Number(lengthCm) : undefined,
        widthCm: widthCm ? Number(widthCm) : undefined,
        heightCm: heightCm ? Number(heightCm) : undefined,
        systemVolumeLiters: volumeLiters ? Number(volumeLiters) : undefined,
        systemVolumeIsManual: volumeIsManual,
        waterType: waterType || undefined,
        startedAt: startedAt || undefined,
        notes: notes || undefined,
      };
      if (isEdit) {
        const updated = await aquariumsApi.update(token, aquariumId!, {
          ...basePayload,
          expectedUpdatedAt,
        });
        router.push(`/akvariumok/${updated.id}`);
      } else {
        const created = await aquariumsApi.create(token, {
          ...basePayload,
          equipment: equipment.map(
            ({
              kind,
              manufacturer,
              model,
              quantity,
              channelCount,
              notes: eqNotes,
            }) => ({
              kind,
              manufacturer,
              model,
              quantity,
              channelCount,
              notes: eqNotes,
            }),
          ),
        });
        router.push(`/akvariumok/${created.id}`);
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Az akvárium nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addEquipmentRow() {
    if (!aquariumId) {
      setEquipment((current) => [
        ...current,
        {
          id: `helyi-${current.length}-${Date.now()}`,
          ...newEquipment,
          quantity: newEquipment.quantity ?? 1,
        },
      ]);
      setNewEquipment(EMPTY_NEW_EQUIPMENT);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await aquariumsApi.addEquipment(
        token,
        aquariumId,
        newEquipment,
      );
      setEquipment(updated.equipment);
      setNewEquipment(EMPTY_NEW_EQUIPMENT);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "A berendezés nem vihető fel.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeEquipmentRow(equipmentId: string) {
    if (!aquariumId) {
      setEquipment((current) =>
        current.filter((row) => row.id !== equipmentId),
      );
      setPendingRemoval(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await aquariumsApi.removeEquipment(
        token,
        aquariumId,
        equipmentId,
      );
      setEquipment(updated.equipment);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "A berendezés nem törölhető.",
      );
    } finally {
      setBusy(false);
      setPendingRemoval(null);
    }
  }

  async function toggleMaintainer(userId: string) {
    if (!aquariumId) return;
    const next = maintainers.some((m) => m.userId === userId)
      ? maintainers.filter((m) => m.userId !== userId)
      : [...maintainers, { userId, displayName: "" }];
    setMaintainersBusy(true);
    setError(null);
    try {
      const updated = await aquariumsApi.setMaintainers(
        token,
        aquariumId,
        next.map((m) => m.userId),
      );
      setMaintainers(updated.maintainers);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "A karbantartó-lista nem menthető.",
      );
    } finally {
      setMaintainersBusy(false);
    }
  }

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az akváriumok kezeléséhez"
        description="aquariums.manage jogosultság szükséges."
      />
    );
  if (loading)
    return (
      <PilotThemeRoot className="h-96 animate-pulse rounded-xl bg-pilot-grey-100" />
    );

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <Link
          href={isEdit ? `/akvariumok/${aquariumId}` : "/akvariumok"}
          className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400 transition-colors hover:text-pilot-grey-700"
        >
          <Icon name="chevron-left" size={12} /> Akváriumok
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-pilot-grey-900">
              {isEdit ? name || "Akvárium szerkesztése" : "Új akvárium"}
            </h1>
            {isEdit ? (
              <div className="mt-2 flex items-center gap-2">
                <PilotBadge variant="grey">
                  {OWNERSHIP_LABEL[ownershipType]}
                </PilotBadge>
                <PilotBadge variant="grey">
                  {WATER_BODY_LABEL[waterBodyType]}
                </PilotBadge>
                {waterType ? (
                  <PilotBadge variant="teal">
                    {WATER_TYPE_LABEL[waterType]}
                  </PilotBadge>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="px-8 pt-4">
          <Alert variant="danger" title="Hiba" description={error} />
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex-1 px-8 py-6">
        <div
          className={
            isEdit
              ? "grid items-start gap-6 lg:grid-cols-[1fr_340px]"
              : "flex max-w-2xl flex-col gap-6"
          }
        >
          <div className="flex flex-col gap-5">
            <PilotCard>
              <PilotCardHeader title="Alapadatok" />
              <div className="flex flex-col gap-4 p-5">
                <div className="flex gap-2">
                  <PilotButton
                    type="button"
                    variant={ownershipType === "OWN" ? "primary" : "secondary"}
                    onClick={() => setOwnershipType("OWN")}
                  >
                    {OWNERSHIP_LABEL.OWN}
                  </PilotButton>
                  <PilotButton
                    type="button"
                    variant={
                      ownershipType === "CUSTOMER" ? "primary" : "secondary"
                    }
                    onClick={() => setOwnershipType("CUSTOMER")}
                  >
                    {OWNERSHIP_LABEL.CUSTOMER}
                  </PilotButton>
                </div>
                {ownershipType === "CUSTOMER" ? (
                  <CustomerPicker
                    token={token}
                    selection={customerSelection}
                    onChange={setCustomerSelection}
                  />
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <PilotFormField label="Név">
                    <PilotInput value={name} onChange={setName} />
                  </PilotFormField>
                  <PilotFormField label="Akvárium vagy tó">
                    <PilotSegmentedControl
                      options={["Akvárium", "Tó"]}
                      value={WATER_BODY_LABEL[waterBodyType]}
                      onChange={(value) =>
                        setWaterBodyType(value === "Tó" ? "TO" : "AKVARIUM")
                      }
                    />
                  </PilotFormField>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <PilotFormField label="Hossz (cm)">
                    <PilotInput
                      type="number"
                      value={lengthCm}
                      onChange={setLengthCm}
                    />
                  </PilotFormField>
                  <PilotFormField label="Szélesség (cm)">
                    <PilotInput
                      type="number"
                      value={widthCm}
                      onChange={setWidthCm}
                    />
                  </PilotFormField>
                  <PilotFormField label="Magasság (cm)">
                    <PilotInput
                      type="number"
                      value={heightCm}
                      onChange={setHeightCm}
                    />
                  </PilotFormField>
                  <PilotFormField
                    label="Térfogat"
                    help={
                      volumeIsManual
                        ? "Kézzel megadva"
                        : "A méretekből számolva"
                    }
                  >
                    <PilotInput
                      type="number"
                      value={volumeLiters}
                      onChange={(value) => {
                        setVolumeLiters(value);
                        setVolumeIsManual(true);
                      }}
                    />
                  </PilotFormField>
                </div>
                {volumeIsManual ? (
                  <PilotButton
                    type="button"
                    variant="secondary"
                    onClick={() => setVolumeIsManual(false)}
                  >
                    Visszaállítás számolt literre
                  </PilotButton>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <PilotFormField label="Víztípus">
                    <PilotSelect
                      value={waterType || undefined}
                      onChange={(value) =>
                        setWaterType(value as WaterType | "")
                      }
                    >
                      <option value="">—</option>
                      <option value="EDESVIZI">
                        {WATER_TYPE_LABEL.EDESVIZI}
                      </option>
                      <option value="TENGERI">
                        {WATER_TYPE_LABEL.TENGERI}
                      </option>
                    </PilotSelect>
                  </PilotFormField>
                  <PilotFormField label="Indítás dátuma">
                    <PilotInput
                      type="date"
                      value={startedAt}
                      onChange={setStartedAt}
                    />
                  </PilotFormField>
                </div>
                {isEdit ? (
                  <PilotMaintainersEditor
                    selected={maintainers}
                    selectable={selectableMaintainers}
                    busy={maintainersBusy}
                    onToggle={(userId) => void toggleMaintainer(userId)}
                  />
                ) : null}
                <PilotFormField label="Megjegyzés">
                  <PilotInput value={notes} onChange={setNotes} />
                </PilotFormField>
              </div>
            </PilotCard>

            <PilotCard>
              <PilotCardHeader title="Berendezések" />
              <div className="divide-y divide-pilot-grey-100 px-5 py-2">
                {equipment.length ? (
                  equipment.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[130px_1fr_auto] items-center gap-4 py-2.5"
                    >
                      <span className="text-xs font-medium text-pilot-grey-400">
                        {EQUIPMENT_KIND_LABEL[row.kind]}
                      </span>
                      <span className="text-sm text-pilot-grey-700">
                        {row.manufacturer ?? "—"}
                        {row.model ? ` · ${row.model}` : ""}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-pilot-grey-400">
                          {row.quantity} db
                          {row.channelCount
                            ? ` · ${row.channelCount} csat.`
                            : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPendingRemoval(row)}
                          className="cursor-pointer text-pilot-grey-300 transition-colors hover:text-red-500"
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-3 text-sm text-pilot-grey-500">
                    Nincs felvitt berendezés.
                  </p>
                )}
              </div>
              <div className="grid gap-3 px-5 pb-4 sm:grid-cols-5">
                <PilotFormField label="Fajta">
                  <PilotSelect
                    value={newEquipment.kind}
                    onChange={(value) =>
                      setNewEquipment((current) => ({
                        ...current,
                        kind: value as AquariumEquipmentKind,
                        channelCount: undefined,
                      }))
                    }
                  >
                    {EQUIPMENT_KIND_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </PilotSelect>
                </PilotFormField>
                <PilotFormField label="Gyártó">
                  <PilotInput
                    value={newEquipment.manufacturer ?? ""}
                    onChange={(value) =>
                      setNewEquipment((current) => ({
                        ...current,
                        manufacturer: value,
                      }))
                    }
                  />
                </PilotFormField>
                <PilotFormField label="Típus">
                  <PilotInput
                    value={newEquipment.model ?? ""}
                    onChange={(value) =>
                      setNewEquipment((current) => ({
                        ...current,
                        model: value,
                      }))
                    }
                  />
                </PilotFormField>
                <PilotFormField label="Darabszám">
                  <PilotInput
                    type="number"
                    value={String(newEquipment.quantity ?? 1)}
                    onChange={(value) =>
                      setNewEquipment((current) => ({
                        ...current,
                        quantity: Number(value),
                      }))
                    }
                  />
                </PilotFormField>
                {newEquipment.kind === "NYOMELEM_ADAGOLO" ? (
                  <PilotFormField label="Csatornaszám">
                    <PilotInput
                      type="number"
                      value={String(newEquipment.channelCount ?? "")}
                      onChange={(value) =>
                        setNewEquipment((current) => ({
                          ...current,
                          channelCount: Number(value),
                        }))
                      }
                    />
                  </PilotFormField>
                ) : null}
              </div>
              <div className="px-5 pb-5">
                <PilotButton
                  type="button"
                  variant="secondary"
                  onClick={() => void addEquipmentRow()}
                >
                  <Icon name="plus" size={13} />
                  Berendezés hozzáadása
                </PilotButton>
              </div>
            </PilotCard>

            <div className="flex items-center justify-end gap-3 pb-8">
              <PilotButton type="submit" variant="primary" disabled={busy}>
                {isEdit ? "Mentés" : "Létrehozás"}
              </PilotButton>
            </div>
          </div>

          {isEdit && aquariumId ? (
            <PilotAquariumWaterValues
              token={token}
              aquariumId={aquariumId}
              waterType={waterType || undefined}
              canSendEmail={Boolean(customerEmail)}
            />
          ) : null}
        </div>
      </form>

      <ConfirmDialog
        open={pendingRemoval != null}
        title={
          pendingRemoval
            ? `Törlöd ezt a berendezést: ${EQUIPMENT_KIND_LABEL[pendingRemoval.kind]}?`
            : ""
        }
        consequence="A berendezés lekerül az akvárium listájáról."
        recovery="Visszaállításhoz újra fel kell venni, ugyanazokkal az adatokkal."
        confirmLabel="Törlés"
        busy={busy}
        onConfirm={() => {
          if (pendingRemoval) void removeEquipmentRow(pendingRemoval.id);
        }}
        onCancel={() => setPendingRemoval(null)}
      />
    </PilotThemeRoot>
  );
}

/**
 * A FIGMA `KarbantartokEditor` PILL-VÁLASZTÓJA. A mentési logika a fenti
 * `toggleMaintainer`-ben áll -- ez a komponens csak a megjelenítést adja.
 */
function PilotMaintainersEditor({
  selected,
  selectable,
  busy,
  onToggle,
}: {
  selected: AquariumMaintainer[];
  selectable: AquariumMaintainer[];
  busy: boolean;
  onToggle: (userId: string) => void;
}) {
  return (
    <div className="col-span-2">
      <p className="mb-2 text-xs text-pilot-grey-400">Karbantartók</p>
      {selectable.length === 0 ? (
        <p className="text-sm text-pilot-grey-500">
          Nincs választható belső kolléga.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {selectable.map((candidate) => {
              const isOn = selected.some((m) => m.userId === candidate.userId);
              return (
                <button
                  key={candidate.userId}
                  type="button"
                  disabled={busy}
                  onClick={() => onToggle(candidate.userId)}
                  className={`flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1 transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                    isOn
                      ? "bg-pilot-aqua-50 text-pilot-aqua-700 ring-pilot-aqua-500"
                      : "bg-white text-pilot-grey-600 ring-pilot-grey-200 hover:bg-pilot-grey-50"
                  }`}
                >
                  <PilotAvatar
                    initials={pilotInitials(candidate.displayName)}
                    color={pilotAvatarColor(candidate.userId)}
                    size="sm"
                  />
                  {candidate.displayName}
                </button>
              );
            })}
          </div>
          {selected.length > 0 ? (
            <div className="mt-3 flex -space-x-1.5">
              {selected.map((m) => (
                <PilotAvatar
                  key={m.userId}
                  initials={pilotInitials(m.displayName || "?")}
                  color={pilotAvatarColor(m.userId)}
                  size="md"
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
