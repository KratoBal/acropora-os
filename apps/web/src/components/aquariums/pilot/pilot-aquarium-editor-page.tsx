"use client";
import { PilotBackLink } from "@/components/pilot/pilot-back-link";
import { useAssistantEntity } from "@/components/assistant/page-context";
import {
  Alert,
  ConfirmDialog,
  Icon,
  PageHeader,
  PAGE_GUTTER_X,
} from "@acropora/ui";
import {
  AQUARIUM_MEASUREMENT_TARGET_RANGE,
  hasPermission,
  PERMISSIONS,
  type AquariumDetail,
  type AquariumEquipment,
  type AquariumEquipmentKind,
  type AquariumMaintainer,
  type AquariumOwnershipType,
  type CreateAquariumEquipmentInput,
  type UpdateAquariumInput,
  type WaterBodyType,
  type WaterType,
  type WorksheetDepartmentSummary,
  servedNavigationFeatures,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { UnsavedChangesGuard } from "@/components/common/unsaved-changes-guard";
import { ApiError } from "@/lib/api/client";
import { aquariumsApi } from "@/lib/api/aquariums";
import { worksheetsApi } from "@/lib/api/worksheets";
import { buildSiteOptions } from "@/lib/partners/site-tree";
import { CustomerPicker, type CustomerSelection } from "../customer-picker";
import {
  EQUIPMENT_KIND_LABEL,
  EQUIPMENT_KIND_OPTIONS,
  OWNERSHIP_LABEL,
  WATER_BODY_LABEL,
  WATER_TYPE_LABEL,
} from "../aquarium-labels";
import { ReefClubCodePanel } from "../reefclub-code-panel";
import {
  equipmentChanges,
  equipmentInput,
  isLocalEquipment,
  LOCAL_EQUIPMENT_PREFIX,
  pendingParts,
  sameMaintainers,
} from "./aquarium-pending-changes";
import {
  PilotAquariumReadView,
  PilotAquariumTargetRangesRead,
} from "./pilot-aquarium-read-view";
import { PilotAquariumWaterValues } from "./pilot-aquarium-water-values";
import {
  draftFromDefaults,
  draftFromTargets,
  hasInvalidRow,
  PilotAquariumTargetRanges,
  targetsPayload,
  type TargetRangeDraft,
} from "./pilot-aquarium-target-ranges";
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
} from "@/components/pilot/pilot-ui";

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
 * ceruza-gombbal, és 2026-11-26 óta (Picasso 3.22) itt is így van: a meglévő
 * akvárium OLVASVA nyílik (`PilotAquariumReadView`: az adatok, a berendezések,
 * a karbantartók, a vízértékek és csak a beállított céltartományok), az űrlap
 * a fejléc "Szerkesztés" gombjára. A "Mégse" elveti a lapon álló módosítást,
 * egy sikeres Mentés visszavisz az olvasó nézetre. Az új akvárium (`/uj`)
 * továbbra is egyből űrlap. Eddig az adatlap mindig szerkesztő űrlapként
 * nyílt, tengerinél tizennégy kitöltetlen céltartomány-mezővel.
 */
export function PilotAquariumEditorPage({
  aquariumId,
}: {
  aquariumId?: string;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const isEdit = Boolean(aquariumId);
  // an existing aquarium opens read; the form opens on "Szerkesztés" (Picasso 3.22)
  const [editing, setEditing] = useState(!aquariumId);
  // the aquarium as last loaded or saved: what the read view shows, and what "Mégse" goes back to
  const [snapshot, setSnapshot] = useState<AquariumDetail | null>(null);
  const [assistantEntity, setAssistantEntity] = useState<{
    id: string;
    number: string;
  } | null>(null);
  useAssistantEntity("Akvárium", assistantEntity?.id, assistantEntity?.number);
  const [loading, setLoading] = useState(isEdit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState("");

  const [ownershipType, setOwnershipType] =
    useState<AquariumOwnershipType>("OWN");
  const [customerSelection, setCustomerSelection] = useState<CustomerSelection>(
    {},
  );
  /**
   * A HELYSZÍN -- OPCIONÁLIS, csak akkor kérhető, ha az akvárium MEGLÉVŐ
   * (nem éppen most felvett) ügyfélé. Lásd az `Aquarium.departmentId`
   * séma-fejlécét: a Partner Portálon ez a mező kötelező lesz, a belső
   * felvitelen/szerkesztésen viszont elhagyható marad -- Balázs döntése,
   * 2026-09-25.
   */
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
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
  // a legutóbb MENTETT berendezés- és karbantartó-lista: ehhez képest vár valami mentésre (aquarium-pending-changes.ts)
  const [savedEquipment, setSavedEquipment] = useState<AquariumEquipment[]>([]);
  const [savedMaintainers, setSavedMaintainers] = useState<
    AquariumMaintainer[]
  >([]);
  // "Mentve." on the read view after a save, until the form opens again
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [customerEmail, setCustomerEmail] = useState<string | undefined>(
    undefined,
  );
  const [selectableMaintainers, setSelectableMaintainers] = useState<
    AquariumMaintainer[]
  >([]);
  const [targetsDraft, setTargetsDraft] = useState<TargetRangeDraft>({});
  const [targetsTouched, setTargetsTouched] = useState(false);

  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.AQUARIUMS_MANAGE),
  );
  // a ReefClub-kód kiadása csak ott, ahol a ReefClub fut (a szerver kapcsolója; élesen KI)
  const reefClubLinking = servedNavigationFeatures(session?.navigation).has(
    "reefclub-linking",
  );

  /** The page's fields from an aquarium: on load, after a save, and on "Mégse" (back to what was saved). */
  function applyDetail(detail: AquariumDetail) {
    setSnapshot(detail);
    setAssistantEntity({ id: detail.id, number: detail.aquariumNumber });
    setOwnershipType(detail.ownershipType);
    setCustomerSelection(
      detail.customerId
        ? {
            customerId: detail.customerId,
            customerLabel: detail.customerName,
          }
        : {},
    );
    setDepartmentId(detail.departmentId ?? "");
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
    setSavedEquipment(detail.equipment);
    setMaintainers(detail.maintainers);
    setSavedMaintainers(detail.maintainers);
    setCustomerEmail(detail.customerEmail);
    setExpectedUpdatedAt(detail.updatedAt);
    setTargetsDraft(draftFromTargets(detail.targets));
  }

  useEffect(() => {
    if (!aquariumId) return;
    let active = true;
    aquariumsApi
      .detail(token, aquariumId)
      .then((detail) => {
        if (!active) return;
        applyDetail(detail);
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
   * A HELYSZÍN-LISTA UGYANAZ A VÉGPONT, AMIT A MUNKALAP ÉS AZ ESZKÖZ IS
   * HASZNÁL (`worksheetsApi.departments`) -- ugyanaz a `WorksheetDepartment`
   * tábla, lásd az `Aquarium.departmentId` séma-fejlécét, miért közös név.
   *
   * A `departmentId` TÖRLÉSE NEM ITT TÖRTÉNIK, hanem a `CustomerPicker`
   * `onChange`-ében (lent) -- ha ide kerülne, a SZERKESZTÉS-BETÖLTÉS is
   * lefuttatná (a `customerSelection.customerId` akkor is "változik", amikor
   * a mentett akváriumot töltjük be), és a `detail.departmentId`-ből épp
   * betöltött értéket törölné a saját maga alatt.
   */
  useEffect(() => {
    const customerId =
      ownershipType === "CUSTOMER" ? customerSelection.customerId : undefined;
    if (!customerId) {
      setDepartments([]);
      return;
    }
    let active = true;
    worksheetsApi
      .departments(token, customerId)
      .then((response) => {
        if (active) setDepartments(response.items.filter((d) => d.isActive));
      })
      .catch(() => {
        if (active) setDepartments([]);
      });
    return () => {
      active = false;
    };
  }, [token, ownershipType, customerSelection.customerId]);

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

  /**
   * ÚJ, TENGERI AKVÁRIUMNÁL A KÓDBAN ÁLLÓ ALAPÉRTÉKEKKEL ELŐTÖLTVE,
   * ÉDESVÍZINÉL ÜRESEN -- Balázs kérése (2026-09-25), lásd
   * `pilot-aquarium-target-ranges.tsx` fejlécét. CSAK ÚJ FELVITELNÉL fut
   * (szerkesztésnél a mentett `detail.targets` a forrás), és CSAK addig,
   * amíg a felhasználó hozzá nem nyúlt a kártyához -- egy már megkezdett
   * saját beállítást a víztípus utólagos átváltása nem írhatja felül.
   */
  useEffect(() => {
    if (isEdit || targetsTouched) return;
    setTargetsDraft(
      waterType === "TENGERI"
        ? draftFromDefaults(AQUARIUM_MEASUREMENT_TARGET_RANGE)
        : {},
    );
  }, [waterType, isEdit, targetsTouched]);

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

  /** Az akvárium mezői, ahogy a Mentés (és az Új akvárium létrehozása) elküldi. */
  function currentPayload() {
    return {
      ownershipType,
      customerId:
        ownershipType === "CUSTOMER" ? customerSelection.customerId : undefined,
      newCustomer:
        ownershipType === "CUSTOMER"
          ? customerSelection.newCustomer
          : undefined,
      departmentId:
        ownershipType === "CUSTOMER" && departmentId ? departmentId : undefined,
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
      targets: targetsPayload(targetsDraft),
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (hasInvalidRow(targetsDraft)) {
      setError(
        "A vízérték céltartományoknál az alsó határ egyik paraméternél sem lehet nagyobb a felsőnél.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setSavedNotice(null);
    try {
      const basePayload = currentPayload();
      if (isEdit) {
        const saved = await saveEdit(basePayload);
        if (saved) {
          applyDetail(saved);
          setEditing(false);
          setSavedNotice("Mentve.");
        }
      } else {
        const created = await aquariumsApi.create(token, {
          ...basePayload,
          equipment: equipment.map(equipmentInput),
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

  /**
   * A SZERKESZTÉS MENTÉSE, EGY GOMBBAL (leltár 3.22): előbb az akvárium mezői (ez viszi az ütközés-ellenőrzést, `expectedUpdatedAt`),
   * aztán a törölt és a felvett berendezések, végül a karbantartók, ha változtak. Minden lépés a friss adatlapot adja vissza; a végén
   * abból áll a lap (a valódi berendezés-azonosítókkal és az új `updatedAt`-tel, hogy a következő Mentés ne ütközzön önmagával).
   *
   * HA KÖZBEN ELAKAD: ami lement, az mentett marad (a lap a legutolsó visszakapott adatlapból áll), ami nem, az a lapon vár, és a
   * következő Mentés csak azt küldi el. Egy már felvitt helyi sor ezért nem kerül fel kétszer.
   */
  async function saveEdit(
    basePayload: Omit<UpdateAquariumInput, "expectedUpdatedAt">,
  ): Promise<AquariumDetail | null> {
    const { remove, add } = equipmentChanges(savedEquipment, equipment);
    const maintainersChanged = !sameMaintainers(savedMaintainers, maintainers);
    let detail: AquariumDetail | null = null;
    const removed = new Set<string>();
    const added = new Set<string>();
    try {
      detail = await aquariumsApi.update(token, aquariumId!, {
        ...basePayload,
        expectedUpdatedAt,
      });
      for (const id of remove) {
        detail = await aquariumsApi.removeEquipment(token, aquariumId!, id);
        removed.add(id);
      }
      for (const row of add) {
        detail = await aquariumsApi.addEquipment(
          token,
          aquariumId!,
          equipmentInput(row),
        );
        added.add(row.id);
      }
      if (maintainersChanged)
        detail = await aquariumsApi.setMaintainers(
          token,
          aquariumId!,
          maintainers.map((m) => m.userId),
        );
      setEquipment(detail.equipment);
      setMaintainers(detail.maintainers);
      return detail;
    } catch (cause) {
      if (detail) {
        const stillToRemove = new Set(remove.filter((id) => !removed.has(id)));
        setEquipment((current) => [
          ...detail!.equipment.filter((row) => !stillToRemove.has(row.id)),
          ...current.filter(
            (row) => isLocalEquipment(row) && !added.has(row.id),
          ),
        ]);
        setError(
          `A mentés félúton elakadt: ${
            cause instanceof ApiError ? cause.message : "ismeretlen hiba"
          }. Ami eddig lement, mentve maradt; a többi a lapon vár, és a Mentés újra elküldi.`,
        );
        return null;
      }
      throw cause;
    } finally {
      if (detail) {
        setSavedEquipment(detail.equipment);
        setSavedMaintainers(detail.maintainers);
        setExpectedUpdatedAt(detail.updatedAt);
      }
    }
  }

  /** A berendezés a lapon kerül fel (helyi azonosítóval); a szerverre a Mentéssel megy, újnál és szerkesztésnél is. */
  function addEquipmentRow() {
    setEquipment((current) => [
      ...current,
      {
        id: `${LOCAL_EQUIPMENT_PREFIX}${current.length}-${Date.now()}`,
        ...newEquipment,
        quantity: newEquipment.quantity ?? 1,
      },
    ]);
    setNewEquipment(EMPTY_NEW_EQUIPMENT);
  }

  function removeEquipmentRow(equipmentId: string) {
    setEquipment((current) => current.filter((row) => row.id !== equipmentId));
    setPendingRemoval(null);
  }

  function toggleMaintainer(userId: string) {
    setMaintainers((current) =>
      current.some((m) => m.userId === userId)
        ? current.filter((m) => m.userId !== userId)
        : [
            ...current,
            selectableMaintainers.find((m) => m.userId === userId) ?? {
              userId,
              displayName: "",
            },
          ],
    );
  }

  const waiting = isEdit
    ? pendingParts({ savedEquipment, equipment, savedMaintainers, maintainers })
    : [];

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

  const reading = isEdit && !editing && snapshot !== null;
  const reefClubPanel =
    isEdit &&
    reefClubLinking &&
    ownershipType === "CUSTOMER" &&
    customerSelection.customerId ? (
      <ReefClubCodePanel
        token={token}
        customerId={customerSelection.customerId}
      />
    ) : null;

  return (
    <PilotThemeRoot
      bleed
      className="flex min-h-screen flex-col bg-pilot-grey-50"
    >
      <div className={`${PAGE_GUTTER_X} pt-6`}>
        <PilotBackLink
          href={isEdit ? `/akvariumok/${aquariumId}` : "/akvariumok"}
        >
          Akváriumok
        </PilotBackLink>
        <PageHeader
          title={
            reading
              ? snapshot.name
              : isEdit
                ? name || "Akvárium szerkesztése"
                : "Új akvárium"
          }
          actions={
            reading ? (
              <PilotButton
                variant="primary"
                onClick={() => {
                  setSavedNotice(null);
                  setEditing(true);
                }}
              >
                <Icon name="pencil" size={12} />
                Szerkesztés
              </PilotButton>
            ) : isEdit ? (
              <PilotButton
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  // back to what was saved: what waits on the page is dropped
                  if (snapshot) applyDetail(snapshot);
                  setError(null);
                  setEditing(false);
                }}
              >
                Mégse
              </PilotButton>
            ) : undefined
          }
          meta={
            isEdit ? (
              <>
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
              </>
            ) : undefined
          }
        />
      </div>

      {error ? (
        <div className={`${PAGE_GUTTER_X} pt-4`}>
          <Alert variant="danger" title="Hiba" description={error} />
        </div>
      ) : null}

      {reading ? (
        <div className={`flex-1 ${PAGE_GUTTER_X} py-6`}>
          {savedNotice ? (
            <p role="status" className="mb-4 text-sm text-pilot-grey-600">
              {savedNotice}
            </p>
          ) : null}
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <PilotAquariumReadView
              detail={snapshot}
              ownerExtra={reefClubPanel}
            />
            <div className="flex flex-col gap-5">
              <PilotAquariumWaterValues
                token={token}
                aquariumId={snapshot.id}
                waterType={snapshot.waterType}
                targets={snapshot.targets}
                canSendEmail={Boolean(snapshot.customerEmail)}
              />
              <PilotAquariumTargetRangesRead detail={snapshot} />
            </div>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className={`flex-1 ${PAGE_GUTTER_X} py-6`}
        >
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex flex-col gap-5">
              {/*
              NÉGY KÜLÖN KÁRTYA, A TERV SZAKASZOLÁSA SZERINT (2026-09-25,
              terv-összevetés): a terv (`NewAquarium`, App.tsx 861-982. sor)
              öt szakaszt ad (Tulajdon, Akvárium, Méretek, Karbantartók,
              Berendezések), itt eddig az első négy egyetlen "Alapadatok"
              kártyába volt összevonva. A mezők és a mögöttes logika
              VÁLTOZATLAN, csak a kártya-határok igazodtak a tervhez. A
              "Megjegyzés" mező a tervben NEM szerepel az Új akvárium
              űrlapon (csak az adatlapon) -- mivel a mai kódban már létezik
              és törlése nem ennek a körnek a tárgya, az "Akvárium" kártya
              végén maradt, a terv nem ismeri sorban.
            */}
              <PilotCard>
                <PilotCardHeader title="Tulajdon" />
                <div className="flex flex-col gap-4 p-5">
                  {/* a choice of two is the segmented switch, as the next control on the form (Picasso 3.28, acrobot 62633) */}
                  <div>
                    <PilotSegmentedControl
                      options={[OWNERSHIP_LABEL.OWN, OWNERSHIP_LABEL.CUSTOMER]}
                      value={OWNERSHIP_LABEL[ownershipType]}
                      onChange={(label) =>
                        setOwnershipType(
                          label === OWNERSHIP_LABEL.CUSTOMER
                            ? "CUSTOMER"
                            : "OWN",
                        )
                      }
                    />
                  </div>
                  {ownershipType === "CUSTOMER" ? (
                    <>
                      <CustomerPicker
                        token={token}
                        selection={customerSelection}
                        onChange={(selection) => {
                          setCustomerSelection(selection);
                          setDepartmentId("");
                        }}
                      />
                      {reefClubPanel}
                      {customerSelection.customerId ? (
                        <PilotFormField
                          label="Helyszín"
                          help="Elhagyható. A Partner Portálon a partner ezek közül a hozzárendelt helyszínek közül választ majd."
                        >
                          <PilotSelect
                            value={departmentId}
                            onChange={setDepartmentId}
                          >
                            <option value="">Nincs megadva</option>
                            {buildSiteOptions(departments).map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </PilotSelect>
                        </PilotFormField>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </PilotCard>

              <PilotCard>
                <PilotCardHeader title="Akvárium" />
                <div className="flex flex-col gap-4 p-5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <PilotFormField label="Megjegyzés">
                    <PilotInput value={notes} onChange={setNotes} />
                  </PilotFormField>
                </div>
              </PilotCard>

              <PilotCard>
                <PilotCardHeader title="Méretek" />
                <div className="flex flex-col gap-4 p-5">
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
                </div>
              </PilotCard>

              {isEdit ? (
                <PilotCard>
                  <PilotCardHeader title="Karbantartók" />
                  <div className="flex flex-col gap-4 p-5">
                    <PilotMaintainersEditor
                      selected={maintainers}
                      selectable={selectableMaintainers}
                      busy={busy}
                      onToggle={toggleMaintainer}
                    />
                  </div>
                </PilotCard>
              ) : null}

              <PilotCard>
                <PilotCardHeader title="Berendezések" />
                <div className="divide-y divide-pilot-grey-100 px-5 py-2">
                  {equipment.length ? (
                    equipment.map((row) => (
                      <div
                        key={row.id}
                        className="grid grid-cols-[130px_minmax(0,1fr)_auto] items-center gap-4 py-2.5"
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
                            aria-label={`${EQUIPMENT_KIND_LABEL[row.kind]}${row.manufacturer ? ` · ${row.manufacturer}` : ""}: törlés`}
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
                <div className="grid grid-cols-1 gap-3 px-5 pb-4 sm:grid-cols-5">
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
                    onClick={addEquipmentRow}
                  >
                    <Icon name="plus" size={13} />
                    Berendezés hozzáadása
                  </PilotButton>
                </div>
              </PilotCard>

              <div className="flex flex-wrap items-center justify-end gap-3 pb-8">
                {isEdit ? (
                  <p
                    className="mr-auto text-sm text-pilot-grey-600"
                    role="status"
                    data-testid="aquarium-save-state"
                  >
                    {waiting.length
                      ? `Mentésre vár: ${waiting.join(" és ")}. A Mentés a fenti adatokkal együtt viszi.`
                      : "A Mentés az összes fenti adatot menti, a karbantartókat és a berendezéseket is."}
                  </p>
                ) : null}
                <PilotButton type="submit" variant="primary" disabled={busy}>
                  {isEdit ? "Mentés" : "Létrehozás"}
                </PilotButton>
              </div>
            </div>

            <div className="flex flex-col gap-5">
              {isEdit && aquariumId ? (
                <PilotAquariumWaterValues
                  token={token}
                  aquariumId={aquariumId}
                  waterType={waterType || undefined}
                  targets={targetsPayload(targetsDraft)}
                  canSendEmail={Boolean(customerEmail)}
                />
              ) : null}
              <PilotAquariumTargetRanges
                waterType={waterType || undefined}
                draft={targetsDraft}
                onChange={(next) => {
                  setTargetsTouched(true);
                  setTargetsDraft(next);
                }}
              />
            </div>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={pendingRemoval != null}
        title={
          pendingRemoval
            ? `Törlöd ezt a berendezést: ${EQUIPMENT_KIND_LABEL[pendingRemoval.kind]}?`
            : ""
        }
        consequence={
          isEdit
            ? "A sor lekerül a listáról, és a Mentéssel az akváriumról is."
            : "A sor lekerül a felvinni szánt berendezések közül."
        }
        recovery={
          isEdit
            ? "Mentés előtt az oldal újratöltése visszahozza; mentés után újra fel kell venni."
            : "Újra felveheted, ugyanazokkal az adatokkal."
        }
        confirmLabel="Törlés"
        busy={busy}
        onConfirm={() => {
          if (pendingRemoval) removeEquipmentRow(pendingRemoval.id);
        }}
        onCancel={() => setPendingRemoval(null)}
      />
      <UnsavedChangesGuard when={waiting.length > 0} />
    </PilotThemeRoot>
  );
}

/**
 * A FIGMA `KarbantartokEditor` PILL-VÁLASZTÓJA. A kiválasztás a lapon vár, a fenti `saveEdit` menti (leltár 3.22) -- ez a
 * komponens csak a megjelenítést adja.
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
