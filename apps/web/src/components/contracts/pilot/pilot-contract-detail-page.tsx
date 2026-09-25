"use client";

import { Alert } from "@acropora/ui";
import type { WorksheetDepartmentSummary } from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { JobAssetPicker } from "@/components/service-jobs/job-asset-picker";
import { buildSiteOptions } from "@/lib/partners/site-tree";
import { ApiError } from "@/lib/api/client";
import { contractsApi, type ContractSummary } from "@/lib/api/contracts";
import {
  maintenanceOrdersApi,
  type MaintenanceOrderSummary,
} from "@/lib/api/maintenance-orders";
import { worksheetsApi } from "@/lib/api/worksheets";
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotFormField,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

const ORDER_STATUS_LABEL: Record<MaintenanceOrderSummary["status"], string> = {
  ISSUED: "Kiállítva",
  SIGNED: "Aláírva",
  REVOKED: "Visszavonva",
};

const ORDER_STATUS_BADGE: Record<
  MaintenanceOrderSummary["status"],
  "amber" | "teal" | "danger"
> = {
  ISSUED: "amber",
  SIGNED: "teal",
  REVOKED: "danger",
};

/**
 * A `save()` A `number`/`title`/`validFrom` MEZŐT MINDIG ELKÜLDI --
 * ha a felhasználó kiüríti valamelyiket, az API `@MinLength`/`@IsDateString`
 * hibája angolul jelenne meg (lásd `pilot-contracts-page.tsx` `missingFields`
 * fejlécét, ugyanaz a hibaosztály). Ez a gomb-tiltást tápláló ellenőrzés.
 */
export function missingContractFields(contract: {
  number: string;
  title: string;
  validFrom: string;
}): string[] {
  const list: string[] = [];
  if (!contract.number.trim()) list.push("Szerződésszám");
  if (!contract.title.trim()) list.push("Szerződés címe");
  if (!contract.validFrom) list.push("Érvényesség kezdete");
  return list;
}

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- SZERZŐDÉS ADATLAP.
 *
 * Forrás: `exchange/figma-partnerek-make-13/src/PartnersScreen.tsx`
 * `ContractDetailPage` (1514-1716. sor). A régi (nem pilot)
 * `ContractDetailPage` kártya-sorrendje (Szerződés adatai → Szerződéses
 * tételek → Megrendelőlapok) már eddig is a terv szerint állt -- ez a port
 * a `@acropora/ui` `Card`/`Button`/`Input`/`Select`/`FormField`-et cseréli
 * pilot komponensekre, VÁLTOZATLAN adattal, hívással és validációval.
 *
 * A TÉTELEK ÉS A MEGRENDELŐLAPOK A MAI KÓDBÓL JÖNNEK: a terv csak egy
 * demo `issueOrder()`-t szimulál helyben; a valódi kód a szervertől kéri
 * le/állítja ki a megrendelőlapokat (`maintenanceOrdersApi`), és a Word
 * fájlt a #1162 óta a partner saját sablonjából tölti ki -- ez a
 * működés nem változik.
 */
export function PilotContractDetailPage({
  contractId,
}: {
  contractId: string;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [contract, setContract] = useState<ContractSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [orders, setOrders] = useState<MaintenanceOrderSummary[] | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    new Set(),
  );
  const [issuing, setIssuing] = useState(false);

  /**
   * A TÉTELEK HELYSZÍNE ÉS ESZKÖZEI -- acrobot kérése (2026-09-24 20:36,
   * élesben blokkoló): a szerver mindig is tudta a
   * `ContractItem.departmentId`-t és az eszköz-hozzárendelést
   * (`contracts.service.ts` `normalize()`, `dto.ts` `ContractItemDto`), de
   * a webes felületen SEHOL nem volt mező hozzá -- csak egy figyelmeztetés
   * a Megrendelőlapok kártyán ("nincs helyszín megadva").
   *
   * KÜLÖN ÁLLAPOT, NEM A `contract` OBJEKTUMBA ÍRVA: a `contract.items` a
   * SZERVER válasza, és a mentés után onnan frissül -- ha közvetlenül azt
   * módosítanánk szerkesztés közben, egy sikertelen mentés után nem
   * lehetne visszaállni a betöltött állapotra.
   */
  const [itemDepartmentId, setItemDepartmentId] = useState<
    Record<string, string>
  >({});
  const [itemAssetIds, setItemAssetIds] = useState<Record<string, string[]>>(
    {},
  );
  const [departments, setDepartments] = useState<WorksheetDepartmentSummary[]>(
    [],
  );
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);

  /**
   * A TÉTEL-KULCSOS ÁLLAPOT EGYETLEN FORRÁSBÓL, AKÁR BETÖLTÉSKOR, AKÁR
   * MENTÉS UTÁN -- Balázs éles hibája (2026-09-24 21:48, Állatkert): a
   * `save()` eddig csak a `contract` state-et frissítette a szerver
   * válaszából, a `selectedItemIds`/`itemDepartmentId`/`itemAssetIds` a
   * RÉGI tétel-id-ken maradt. A repository mostantól ugyan stabilan tartja
   * a meglévő tételek id-jét (`contracts.repository.ts` `update()`), de a
   * hívás mindkét helyen UGYANEBBŐL a válaszból induljon, hogy egy
   * jövőbeli eltérés ne tudjon csendben visszatérni.
   */
  const applyContractDetail = (detail: ContractSummary) => {
    setContract(detail);
    // ALAPÉRTELMEZÉSBEN AZ ÖSSZES TÉTEL KI VAN VÁLASZTVA -- Balázs
    // döntése (2026-09-24): egy kiállítás a szerződés összes tételéből
    // visz egy-egy alkalmat, de tételenként kivehető.
    setSelectedItemIds(new Set(detail.items.map((item) => item.id)));
    setItemDepartmentId(
      Object.fromEntries(
        detail.items.map((item) => [item.id, item.departmentId ?? ""]),
      ),
    );
    setItemAssetIds(
      Object.fromEntries(
        detail.items.map((item) => [
          item.id,
          item.assets.map((asset) => asset.assetId),
        ]),
      ),
    );
  };

  const load = async () => {
    try {
      const detail = await contractsApi.detail(token, contractId);
      applyContractDetail(detail);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A szerződés nem tölthető be.",
      );
    }
  };

  const loadDepartments = useCallback(
    async (customerId: string, signal?: AbortSignal) => {
      try {
        const response = await worksheetsApi.departments(
          token,
          customerId,
          signal,
        );
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
    if (!contract) return;
    const controller = new AbortController();
    void loadDepartments(contract.customerId, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract?.customerId, loadDepartments]);

  const departmentOptions = useMemo(
    () => buildSiteOptions(departments),
    [departments],
  );
  const loadOrders = async () => {
    try {
      setOrders(await maintenanceOrdersApi.list(token, contractId));
    } catch (cause) {
      setOrderError(
        cause instanceof Error
          ? cause.message
          : "A megrendelőlapok nem tölthetők be.",
      );
    }
  };
  /**
   * NEM `if (token)` -- Balázs éles hibája (2026-09-24 17:39): a
   * `Session.token` OPCIONÁLIS (`packages/types/src/auth.ts`), mert
   * éles (jelszavas) bejelentkezésnél a böngésző httpOnly sütije
   * hitelesít, a kliens oldalon nincs olvasható token. `session?.token ??
   * ""` ilyenkor MINDIG üres string, tehát egy `if (token)` feltétel a
   * `load()`-ot SOHA nem futtatná le -- az adatlap örökre "Szerződés
   * betöltése…" marad. Az `apiRequest` üres token mellett is helyesen
   * hagyatkozik a sütire (lásd `client.ts` fejlécét); a lista oldal
   * (`pilot-contracts-page.tsx`) ezért működik: az nem feltételez tokent.
   */
  useEffect(() => {
    void load();
    void loadOrders();
  }, [contractId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!contract) return;
    setSaving(true);
    setError(null);
    setNumberError(null);
    try {
      const next = await contractsApi.update(token, contract.id, {
        number: contract.number,
        title: contract.title,
        validFrom: contract.validFrom,
        validTo: contract.validTo ?? null,
        status: contract.status,
        notes: contract.notes ?? null,
        organizationalUnitName: contract.organizationalUnitName ?? null,
        contactPersonName: contract.contactPersonName ?? null,
        /*
          A TELJES TÉTEL-LISTÁT KÜLDJÜK, MERT AZ `update()` A `items` MEZŐT
          EGYBEN CSERÉLI (`contracts.service.ts`: `items: patch.items ??
          existing...`) -- ha csak a helyszínt/eszközöket küldenénk, a
          többi mező (leírás, ár, mennyiség) elveszne. Az itt küldött érték
          ezért a betöltött tétel ADATAIT viszi tovább, a helyszín/eszköz
          mezőt pedig a szerkesztett állapotból.
        */
        items: contract.items.map((item) => ({
          id: item.id,
          description: item.description,
          unitNet: item.unitNet,
          quantity: item.quantity,
          occasionsPerYear: item.occasionsPerYear,
          vatRatePercent: item.vatRatePercent,
          departmentId: itemDepartmentId[item.id] || null,
          assetIds: itemAssetIds[item.id] ?? [],
        })),
      });
      applyContractDetail(next);
    } catch (cause) {
      /*
        UGYANAZ A MINTA, MINT A `pilot-contracts-page.tsx` `create()`-jén: a
        duplikált szerződésszám a mező alatt jelenik meg, nem egy általános
        dobozban -- Balázs éles hibája (2026-09-24 20:31).

        A `save()`-nek (ellentétben a `create()`-tel) MA KÉT `ConflictException`
        (409) forrása van: a szerződésszám egyedi megkötése, ÉS a tételek
        törlés+újraépítése, ha valamelyikhez már készült megrendelőlap (P2003,
        lásd `contracts.service.ts`). A második NEM a szerződésszámról szól,
        tehát a mező alatti helyre tenni félrevezető lenne -- ezért csak a
        szám-ütközés üzenetét irányítjuk a mezőhöz, a másikat az általános
        hibadobozba.
      */
      if (
        cause instanceof ApiError &&
        cause.status === 409 &&
        cause.message.startsWith("Ez a szerződésszám már létezik")
      ) {
        setNumberError(cause.message);
        return;
      }
      setError(
        cause instanceof Error ? cause.message : "A szerződés nem menthető.",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleItem = (itemId: string) => {
    setSelectedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const issue = async () => {
    if (!contract || selectedItemIds.size === 0) return;
    setIssuing(true);
    setOrderError(null);
    try {
      await maintenanceOrdersApi.issue(token, {
        contractId: contract.id,
        itemIds: [...selectedItemIds],
      });
      await loadOrders();
    } catch (cause) {
      setOrderError(
        cause instanceof Error
          ? cause.message
          : "A megrendelőlap nem állítható ki.",
      );
    } finally {
      setIssuing(false);
    }
  };

  const revoke = async (orderId: string) => {
    setOrderError(null);
    try {
      await maintenanceOrdersApi.revoke(token, orderId);
      await loadOrders();
    } catch (cause) {
      setOrderError(
        cause instanceof Error
          ? cause.message
          : "A megrendelőlap nem vonható vissza.",
      );
    }
  };

  const uploadSigned = async (orderId: string, file: File) => {
    setOrderError(null);
    try {
      await maintenanceOrdersApi.uploadSignedDocument(token, orderId, file);
      await loadOrders();
    } catch (cause) {
      setOrderError(
        cause instanceof Error
          ? cause.message
          : "Az aláírt PDF nem tölthető fel.",
      );
    }
  };

  const download = async (
    orderId: string,
    documentId: string,
    fileName: string,
  ) => {
    try {
      const blob = await maintenanceOrdersApi.downloadDocument(
        token,
        orderId,
        documentId,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setOrderError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető le.",
      );
    }
  };

  const selectedCount = useMemo(() => selectedItemIds.size, [selectedItemIds]);

  /**
   * UGYANAZ A HIBAOSZTÁLY, MINT AZ ÚJ SZERZŐDÉS ŰRLAPON
   * (`pilot-contracts-page.tsx` `missingFields`): a `number`/`title`/`validFrom`
   * mezőket a `save()` MINDIG elküldi, tehát ha a felhasználó kiüríti
   * őket, az API `@IsDateString`/`@MinLength` hibája angolul jelenne meg.
   * Itt a gomb-tiltás előzi meg.
   */
  const missing = useMemo(
    () => (contract ? missingContractFields(contract) : []),
    [contract],
  );

  if (error && !contract)
    return (
      <PilotThemeRoot>
        <Alert variant="danger" title="Betöltési hiba" description={error} />
      </PilotThemeRoot>
    );
  if (!contract)
    return (
      <PilotThemeRoot>
        <p className="text-sm text-pilot-grey-400">Szerződés betöltése…</p>
      </PilotThemeRoot>
    );
  return (
    <PilotThemeRoot>
      <div className="flex min-h-full flex-col">
        <div className="flex items-center justify-between border-b border-pilot-grey-200 bg-white px-8 py-5">
          <div>
            <Link
              href="/partnerek/szerzodesek"
              className="mb-0.5 block text-xs text-pilot-grey-400 hover:text-pilot-grey-700"
            >
              ← Szerződések
            </Link>
            <p className="text-xs text-pilot-grey-400">
              {contract.customer.displayName}
            </p>
            <h1 className="text-xl font-semibold text-pilot-grey-900">
              {contract.number}
            </h1>
          </div>
          <Link href="/partnerek/szerzodesek">
            <PilotButton type="button" variant="secondary">
              ← Vissza
            </PilotButton>
          </Link>
        </div>

        <div className="flex max-w-3xl flex-1 flex-col gap-4 px-8 py-6">
          {error ? (
            <Alert variant="danger" title="Mentési hiba" description={error} />
          ) : null}
          <PilotCard>
            <PilotCardHeader title="Szerződés adatai" />
            <div className="flex flex-col gap-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <PilotFormField
                  label="Szerződésszám"
                  required
                  help={numberError ?? undefined}
                >
                  <PilotInput
                    aria-label="Szerződésszám *"
                    value={contract.number}
                    onChange={(value) => {
                      setContract({ ...contract, number: value });
                      setNumberError(null);
                    }}
                  />
                </PilotFormField>
                <PilotFormField label="Szerződés címe" required>
                  <PilotInput
                    aria-label="Szerződés címe *"
                    value={contract.title}
                    onChange={(value) =>
                      setContract({ ...contract, title: value })
                    }
                  />
                </PilotFormField>
                <PilotFormField label="Érvényesség kezdete" required>
                  <PilotInput
                    aria-label="Érvényesség kezdete *"
                    type="date"
                    value={contract.validFrom.slice(0, 10)}
                    onChange={(value) =>
                      setContract({ ...contract, validFrom: value })
                    }
                  />
                </PilotFormField>
                <PilotFormField
                  label="Érvényesség vége"
                  help="Opcionális -- üresen hagyva határozatlan idejű."
                >
                  <PilotInput
                    aria-label="Érvényesség vége"
                    type="date"
                    value={contract.validTo?.slice(0, 10) ?? ""}
                    onChange={(value) =>
                      setContract({
                        ...contract,
                        validTo: value || null,
                      })
                    }
                  />
                </PilotFormField>
                <PilotFormField label="Állapot">
                  <PilotSelect
                    aria-label="Állapot"
                    value={contract.status}
                    onChange={(value) =>
                      setContract({
                        ...contract,
                        status: value as ContractSummary["status"],
                      })
                    }
                  >
                    <option value="DRAFT">Piszkozat</option>
                    <option value="ACTIVE">Aktív</option>
                    <option value="EXPIRED">Lejárt</option>
                    <option value="TERMINATED">Megszűnt</option>
                  </PilotSelect>
                </PilotFormField>
              </div>
              {/*
                A KÉT MEZŐ A MEGRENDELŐLAPRA MEGY, ÉS MI TÖLTJÜK KI -- Balázs
                döntése (2026-09-24): a vevő szervezeti egysége és kapcsolattartója
                egy visszatérő ügyfélnél ismert egy korábbi megrendelésből, nem a
                vevőre vár. Lásd
                exchange/nautilus-megrendelolap-lekepezesi-terv-2026-09-24.md.
              */}
              <div className="grid gap-4 sm:grid-cols-2">
                <PilotFormField label="Vevő szervezeti egysége (megrendelőlapon)">
                  <PilotInput
                    aria-label="Vevő szervezeti egysége (megrendelőlapon)"
                    placeholder="Szervezeti egység megnevezése"
                    value={contract.organizationalUnitName ?? ""}
                    onChange={(value) =>
                      setContract({
                        ...contract,
                        organizationalUnitName: value || null,
                      })
                    }
                  />
                </PilotFormField>
                <PilotFormField label="Vevő kapcsolattartója (megrendelőlapon)">
                  <PilotInput
                    aria-label="Vevő kapcsolattartója (megrendelőlapon)"
                    placeholder="Ügyintéző"
                    value={contract.contactPersonName ?? ""}
                    onChange={(value) =>
                      setContract({
                        ...contract,
                        contactPersonName: value || null,
                      })
                    }
                  />
                </PilotFormField>
              </div>
              <PilotFormField label="Megjegyzés">
                <PilotInput
                  aria-label="Megjegyzés"
                  value={contract.notes ?? ""}
                  onChange={(value) =>
                    setContract({ ...contract, notes: value || null })
                  }
                />
              </PilotFormField>
              <div className="flex flex-col gap-2">
                <div className="flex justify-end">
                  <PilotButton
                    type="button"
                    variant="primary"
                    disabled={saving || missing.length > 0}
                    onClick={() => void save()}
                  >
                    {saving ? "Mentés…" : "Módosítások mentése"}
                  </PilotButton>
                </div>
                {missing.length > 0 ? (
                  <p className="text-right text-xs font-medium text-red-600">
                    Hiányzik: {missing.join(", ")}.
                  </p>
                ) : null}
              </div>
            </div>
          </PilotCard>
          <PilotCard>
            <PilotCardHeader title="Szerződéses tételek" />
            {/*
              A HELYSZÍN ÉS AZ ESZKÖZ ITT SZERKESZTHETŐ -- acrobot kérése
              (2026-09-24 20:36, élesben blokkoló): a szerver mindig is tudta
              ezt a két mezőt (`ContractItem.departmentId`,
              `ContractItemAsset`), de a webes felületen sehol nem volt hozzá
              mező. A mentés a lap tetején lévő "Módosítások mentése" gombbal
              megy, ugyanabban a körben, mint a többi mező.
            */}
            <div className="flex flex-col gap-4 p-5">
              {!departmentsLoaded ? (
                <p className="text-sm text-pilot-grey-400">
                  Helyszínek betöltése…
                </p>
              ) : departmentOptions.length === 0 ? (
                <p className="text-sm text-pilot-grey-400">
                  Ehhez a partnerhez nincs felvéve helyszín.
                </p>
              ) : null}
              <ul className="flex flex-col gap-4 text-sm">
                {contract.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col gap-2 border-b border-pilot-grey-100 pb-3 last:border-0"
                  >
                    <p className="text-pilot-grey-900">
                      {item.position}. {item.description} — {item.unitNet} Ft ×{" "}
                      {item.quantity} db × {item.occasionsPerYear} alkalom / év,{" "}
                      {item.vatRatePercent}% ÁFA
                    </p>
                    {departmentOptions.length > 0 ? (
                      <div className="grid gap-2 md:grid-cols-2">
                        <PilotFormField label="Helyszín">
                          <PilotSelect
                            aria-label="Helyszín"
                            value={itemDepartmentId[item.id] ?? ""}
                            onChange={(value) =>
                              setItemDepartmentId((current) => ({
                                ...current,
                                [item.id]: value,
                              }))
                            }
                          >
                            <option value="">Nincs megadva</option>
                            {departmentOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </PilotSelect>
                        </PilotFormField>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-semibold text-pilot-grey-900">
                            Érintett eszközök
                          </span>
                          <JobAssetPicker
                            departmentId={itemDepartmentId[item.id] ?? ""}
                            selected={itemAssetIds[item.id] ?? []}
                            onChange={(assetIds) =>
                              setItemAssetIds((current) => ({
                                ...current,
                                [item.id]: assetIds,
                              }))
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </PilotCard>
          <PilotCard>
            <PilotCardHeader title="Megrendelőlapok" />
            <div className="flex flex-col gap-4 p-5">
              {orderError ? (
                <Alert
                  variant="danger"
                  title="Megrendelőlap-hiba"
                  description={orderError}
                />
              ) : null}
              <div>
                <p className="mb-2 text-sm text-pilot-grey-400">
                  Válaszd ki, mely tételekből visz egy-egy alkalmat a kiállítás
                  (alapból az összes ki van jelölve):
                </p>
                <ul className="flex flex-col gap-1 text-sm">
                  {contract.items.map((item) => (
                    <li key={item.id}>
                      <label className="flex cursor-pointer items-center gap-2 py-1">
                        <input
                          type="checkbox"
                          checked={selectedItemIds.has(item.id)}
                          onChange={() => toggleItem(item.id)}
                          className="h-4 w-4 rounded accent-pilot-aqua-600"
                        />
                        <span className="text-pilot-grey-800">
                          {item.position}. {item.description}
                        </span>
                        {item.departmentId ? null : (
                          <span className="text-xs text-red-600">
                            (nincs helyszín megadva -- nem állítható ki belőle)
                          </span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  <PilotButton
                    type="button"
                    variant="primary"
                    disabled={issuing || selectedCount === 0}
                    onClick={() => void issue()}
                  >
                    {issuing
                      ? "Kiállítás…"
                      : `Megrendelőlap kiállítása (${selectedCount} tétel)`}
                  </PilotButton>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {orders === null ? (
                  <p className="text-sm text-pilot-grey-400">
                    Megrendelőlapok betöltése…
                  </p>
                ) : orders.length === 0 ? (
                  <p className="text-sm text-pilot-grey-400">
                    Ehhez a szerződéshez még nem állítottunk ki megrendelőlapot.
                  </p>
                ) : (
                  orders.map((order) => (
                    <div
                      key={order.id}
                      className="flex flex-col gap-2 rounded-lg bg-pilot-grey-50 px-3 py-2 ring-1 ring-pilot-grey-100"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs text-pilot-grey-700">
                            {order.number}
                          </span>
                          <span className="text-xs text-pilot-grey-400">
                            {order.occasionYear}
                          </span>
                          <PilotBadge
                            variant={ORDER_STATUS_BADGE[order.status]}
                          >
                            {ORDER_STATUS_LABEL[order.status]}
                          </PilotBadge>
                        </div>
                        {order.status === "ISSUED" ? (
                          <div className="flex items-center gap-2">
                            <label className="cursor-pointer text-xs font-medium text-pilot-aqua-700 underline">
                              Aláírt PDF feltöltése
                              <input
                                type="file"
                                accept="application/pdf"
                                className="hidden"
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (file) void uploadSigned(order.id, file);
                                  event.target.value = "";
                                }}
                              />
                            </label>
                            <PilotButton
                              type="button"
                              variant="secondary"
                              onClick={() => void revoke(order.id)}
                            >
                              Visszavonás
                            </PilotButton>
                          </div>
                        ) : null}
                      </div>
                      <ul className="flex flex-col gap-1">
                        {order.documents.map((documentSummary) => (
                          <li key={documentSummary.id}>
                            <button
                              type="button"
                              className="text-xs font-medium text-pilot-aqua-700 underline"
                              onClick={() =>
                                void download(
                                  order.id,
                                  documentSummary.id,
                                  documentSummary.fileName,
                                )
                              }
                            >
                              {documentSummary.type === "SIGNED_FORM"
                                ? "Aláírt megrendelőlap"
                                : "Generált megrendelőlap"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            </div>
          </PilotCard>
        </div>
      </div>
    </PilotThemeRoot>
  );
}
