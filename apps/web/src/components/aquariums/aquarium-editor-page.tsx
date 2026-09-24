"use client";
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@acropora/ui";
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
import { CustomerPicker, type CustomerSelection } from "./customer-picker";
import { AquariumWaterValues } from "./aquarium-water-values";
import {
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_KIND_OPTIONS,
  OWNERSHIP_LABEL,
  WATER_BODY_LABEL,
  WATER_TYPE_LABEL,
} from "./aquarium-labels";

const EMPTY_NEW_EQUIPMENT: CreateAquariumEquipmentInput = {
  kind: "VILAGITAS",
  quantity: 1,
};

/**
 * EGYETLEN KOMPONENS, LÉTREHOZÁSRA ÉS SZERKESZTÉSRE IS -- ugyanaz a minta,
 * mint a `SupplierEditorPage`-nél (`supplierId?: string`).
 *
 * A BERENDEZÉS-SOROK KÉT MÓDBAN VISELKEDNEK. Új akváriumnál (nincs
 * `aquariumId`) a sorok csak HELYI állapotban élnek, és a `create()`
 * hívással mennek fel egyszerre -- addig nincs mit törölni a szerveren.
 * Meglévő akváriumnál minden hozzáadás/törlés AZONNALI, külön API-hívás
 * (lásd `aquariums.service.ts` `addEquipment`/`removeEquipment`-jét), mert
 * a brief kifejezetten "felvétele/törlése" különálló műveletként kéri.
 */
export function AquariumEditorPage({ aquariumId }: { aquariumId?: string }) {
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
  /** A törlésre megerősítésre váró sor -- lásd a `removeEquipmentRow`
   * fejlécét: egyetlen gombnyomás sem törölhet kérdés nélkül. */
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

  /**
   * A VÁLASZTHATÓ KARBANTARTÓK LISTÁJA FÜGGETLEN AZ AKVÁRIUMTÓL -- ezért
   * külön effektus, nem a fenti betöltés része: új akváriumnál is
   * betöltődik (a választó akkor is megjelenhetne, ha egyszer a create-ág
   * is megkapná -- lásd a komponens fejlécét, miért nem ma).
   */
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    aquariumsApi
      .selectableMaintainers(token)
      .then((list) => {
        if (active) setSelectableMaintainers(list);
      })
      .catch(() => {
        // Csendben marad: a választó listája üresen jelenik meg, a hiba a
        // fő betöltési hibaüzenetet nem duplikálja.
      });
    return () => {
      active = false;
    };
  }, [token, canManage]);

  /**
   * AUTOMATIKUS LITER-SZÁMOLÁS, AMÍG A FELHASZNÁLÓ ÁT NEM ÍRTA KÉZZEL.
   * Lásd `apps/api/src/aquariums/aquarium-volume.ts` fejlécét -- a szerver
   * ugyanezt a logikát futtatja le mentéskor is, ez itt csak a felület
   * AZONNALI visszajelzése.
   */
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

  /**
   * A TÉNYLEGES TÖRLÉS -- CSAK A MEGERŐSÍTŐ ABLAK `onConfirm`-JÁBÓL HÍVVA.
   * Egyetlen gombnyomás sem törölhet kérdés nélkül -- lásd
   * `confirm-usage.component.test.ts` fejlécét: ez a lefedettségi teszt már
   * egyszer megfogott két, évekig kérdés nélkül törlő hívási helyet.
   */
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

  /**
   * A KARBANTARTÓ-LISTA MINDEN VÁLTOZÁSNÁL AZONNAL MENT -- nem gyűjti a
   * "Mentés" gombig, mert a szerver `PATCH .../maintainers` végpontja teljes
   * cserét vár, és egy pipálás/lepipálás azonnali visszajelzést érdemel,
   * ugyanúgy, mint a berendezés-sorok. CSAK MEGLÉVŐ akváriumnál elérhető
   * (lásd a komponens fejlécét).
   */
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
  if (loading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? name || "Akvárium szerkesztése" : "Új akvárium"}
        actions={
          <Link href={isEdit ? `/akvariumok/${aquariumId}` : "/akvariumok"}>
            <Button variant="secondary">Vissza</Button>
          </Link>
        }
      />
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="space-y-4 p-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={ownershipType === "OWN" ? "primary" : "secondary"}
              onClick={() => setOwnershipType("OWN")}
            >
              {OWNERSHIP_LABEL.OWN}
            </Button>
            <Button
              type="button"
              variant={ownershipType === "CUSTOMER" ? "primary" : "secondary"}
              onClick={() => setOwnershipType("CUSTOMER")}
            >
              {OWNERSHIP_LABEL.CUSTOMER}
            </Button>
          </div>
          {ownershipType === "CUSTOMER" ? (
            <CustomerPicker
              token={token}
              selection={customerSelection}
              onChange={setCustomerSelection}
            />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Név">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Akvárium vagy tó">
              <Select
                value={waterBodyType}
                onChange={(event) =>
                  setWaterBodyType(event.target.value as WaterBodyType)
                }
              >
                <option value="AKVARIUM">{WATER_BODY_LABEL.AKVARIUM}</option>
                <option value="TO">{WATER_BODY_LABEL.TO}</option>
              </Select>
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <FormField label="Hossz (cm)">
              <Input
                type="number"
                value={lengthCm}
                onChange={(event) => setLengthCm(event.target.value)}
              />
            </FormField>
            <FormField label="Szélesség (cm)">
              <Input
                type="number"
                value={widthCm}
                onChange={(event) => setWidthCm(event.target.value)}
              />
            </FormField>
            <FormField label="Magasság (cm)">
              <Input
                type="number"
                value={heightCm}
                onChange={(event) => setHeightCm(event.target.value)}
              />
            </FormField>
            <FormField
              label="Liter"
              description={
                volumeIsManual ? "Kézzel megadva" : "A méretekből számolva"
              }
            >
              <Input
                type="number"
                value={volumeLiters}
                onChange={(event) => {
                  setVolumeLiters(event.target.value);
                  setVolumeIsManual(true);
                }}
              />
            </FormField>
          </div>
          {volumeIsManual ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setVolumeIsManual(false)}
            >
              Visszaállítás számolt literre
            </Button>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Víztípus">
              <Select
                value={waterType}
                onChange={(event) =>
                  setWaterType(event.target.value as WaterType | "")
                }
              >
                <option value="">—</option>
                <option value="EDESVIZI">{WATER_TYPE_LABEL.EDESVIZI}</option>
                <option value="TENGERI">{WATER_TYPE_LABEL.TENGERI}</option>
              </Select>
            </FormField>
            <FormField label="Indítás dátuma">
              <Input
                type="date"
                value={startedAt}
                onChange={(event) => setStartedAt(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Megjegyzés">
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
        </Card>

        <Card className="space-y-4 p-4">
          <h2 className="text-sm font-semibold text-dusk-800">Berendezések</h2>
          {equipment.length ? (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-dusk-500">
                <tr>
                  <th>Fajta</th>
                  <th>Gyártó</th>
                  <th>Típus</th>
                  <th>Db</th>
                  <th>Csatorna</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {equipment.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="py-1">{EQUIPMENT_KIND_LABEL[row.kind]}</td>
                    <td>{row.manufacturer ?? "—"}</td>
                    <td>{row.model ?? "—"}</td>
                    <td>{row.quantity}</td>
                    <td>{row.channelCount ?? "—"}</td>
                    <td>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setPendingRemoval(row)}
                      >
                        Törlés
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-dusk-500">Nincs felvitt berendezés.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-5">
            <FormField label="Fajta">
              <Select
                value={newEquipment.kind}
                onChange={(event) =>
                  setNewEquipment((current) => ({
                    ...current,
                    kind: event.target.value as AquariumEquipmentKind,
                    channelCount: undefined,
                  }))
                }
              >
                {EQUIPMENT_KIND_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Gyártó">
              <Input
                value={newEquipment.manufacturer ?? ""}
                onChange={(event) =>
                  setNewEquipment((current) => ({
                    ...current,
                    manufacturer: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Típus">
              <Input
                value={newEquipment.model ?? ""}
                onChange={(event) =>
                  setNewEquipment((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Darabszám">
              <Input
                type="number"
                min={1}
                value={newEquipment.quantity ?? 1}
                onChange={(event) =>
                  setNewEquipment((current) => ({
                    ...current,
                    quantity: Number(event.target.value),
                  }))
                }
              />
            </FormField>
            {newEquipment.kind === "NYOMELEM_ADAGOLO" ? (
              <FormField label="Csatornaszám">
                <Input
                  type="number"
                  min={1}
                  value={newEquipment.channelCount ?? ""}
                  onChange={(event) =>
                    setNewEquipment((current) => ({
                      ...current,
                      channelCount: Number(event.target.value),
                    }))
                  }
                />
              </FormField>
            ) : null}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void addEquipmentRow()}
          >
            Berendezés hozzáadása
          </Button>
        </Card>

        {isEdit ? (
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold text-dusk-800">
              Karbantartók
            </h2>
            <p className="text-sm text-dusk-500">
              Belsős kollégák, akik karban tartják ezt az akváriumot. Több is
              választható.
            </p>
            {selectableMaintainers.length ? (
              <div className="flex flex-wrap gap-2">
                {selectableMaintainers.map((candidate) => {
                  const checked = maintainers.some(
                    (m) => m.userId === candidate.userId,
                  );
                  return (
                    <label
                      key={candidate.userId}
                      className="flex items-center gap-2 rounded border px-2 py-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={maintainersBusy}
                        onChange={() => void toggleMaintainer(candidate.userId)}
                      />
                      {candidate.displayName}
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-dusk-500">
                Nincs választható belső kolléga.
              </p>
            )}
          </Card>
        ) : null}

        <Button type="submit" disabled={busy}>
          {isEdit ? "Mentés" : "Létrehozás"}
        </Button>
      </form>

      {isEdit && aquariumId ? (
        <AquariumWaterValues
          token={token}
          aquariumId={aquariumId}
          waterType={waterType || undefined}
          canSendEmail={Boolean(customerEmail)}
        />
      ) : null}

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
    </div>
  );
}
