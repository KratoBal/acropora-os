"use client";

import { Alert, Button, Card, FormField, Input, Select } from "@acropora/ui";
import type { WorksheetDepartmentSummary } from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { JobAssetPicker } from "@/components/service-jobs/job-asset-picker";
import { buildSiteOptions } from "@/lib/partners/site-tree";
import { contractsApi, type ContractSummary } from "@/lib/api/contracts";
import {
  maintenanceOrdersApi,
  type MaintenanceOrderSummary,
} from "@/lib/api/maintenance-orders";
import { worksheetsApi } from "@/lib/api/worksheets";

const ORDER_STATUS_LABEL: Record<MaintenanceOrderSummary["status"], string> = {
  ISSUED: "Kiállítva",
  SIGNED: "Aláírva",
  REVOKED: "Visszavonva",
};

/**
 * A `save()` A `number`/`title`/`validFrom` MEZŐT MINDIG ELKÜLDI --
 * ha a felhasználó kiüríti valamelyiket, az API `@MinLength`/`@IsDateString`
 * hibája angolul jelenne meg (lásd `contracts-page.tsx` `missingFields`
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

export function ContractDetailPage({ contractId }: { contractId: string }) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [contract, setContract] = useState<ContractSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const load = async () => {
    try {
      const detail = await contractsApi.detail(token, contractId);
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
   * (`contracts-page.tsx`) ezért működik: az nem feltételez tokent.
   */
  useEffect(() => {
    void load();
    void loadOrders();
  }, [contractId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!contract) return;
    setSaving(true);
    setError(null);
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
          description: item.description,
          unitNet: item.unitNet,
          quantity: item.quantity,
          occasionsPerYear: item.occasionsPerYear,
          vatRatePercent: item.vatRatePercent,
          departmentId: itemDepartmentId[item.id] || null,
          assetIds: itemAssetIds[item.id] ?? [],
        })),
      });
      setContract(next);
    } catch (cause) {
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
   * (`contracts-page.tsx` `missingFields`): a `number`/`title`/`validFrom`
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
      <Alert variant="danger" title="Betöltési hiba" description={error} />
    );
  if (!contract)
    return <p className="text-sm text-muted">Szerződés betöltése…</p>;
  return (
    <div className="space-y-6">
      <Link className="text-sm underline" href="/partnerek/szerzodesek">
        ← Szerződések
      </Link>
      <div>
        <p className="text-sm text-muted">{contract.customer.displayName}</p>
        <h1 className="text-2xl font-semibold">{contract.number}</h1>
      </div>
      {error ? (
        <Alert variant="danger" title="Mentési hiba" description={error} />
      ) : null}
      <Card className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">Szerződés adatai</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Szerződésszám *" htmlFor="contract-edit-number">
            <Input
              id="contract-edit-number"
              value={contract.number}
              onChange={(event) =>
                setContract({ ...contract, number: event.target.value })
              }
            />
          </FormField>
          <FormField label="Szerződés címe *" htmlFor="contract-edit-title">
            <Input
              id="contract-edit-title"
              value={contract.title}
              onChange={(event) =>
                setContract({ ...contract, title: event.target.value })
              }
            />
          </FormField>
          <FormField
            label="Érvényesség kezdete *"
            htmlFor="contract-edit-valid-from"
          >
            <Input
              id="contract-edit-valid-from"
              type="date"
              value={contract.validFrom.slice(0, 10)}
              onChange={(event) =>
                setContract({ ...contract, validFrom: event.target.value })
              }
            />
          </FormField>
          <FormField
            label="Érvényesség vége"
            htmlFor="contract-edit-valid-to"
            description="Opcionális -- üresen hagyva határozatlan idejű."
          >
            <Input
              id="contract-edit-valid-to"
              type="date"
              value={contract.validTo?.slice(0, 10) ?? ""}
              onChange={(event) =>
                setContract({
                  ...contract,
                  validTo: event.target.value || null,
                })
              }
            />
          </FormField>
          <FormField label="Állapot" htmlFor="contract-edit-status">
            <Select
              id="contract-edit-status"
              value={contract.status}
              onChange={(event) =>
                setContract({
                  ...contract,
                  status: event.target.value as ContractSummary["status"],
                })
              }
            >
              <option value="DRAFT">Piszkozat</option>
              <option value="ACTIVE">Aktív</option>
              <option value="EXPIRED">Lejárt</option>
              <option value="TERMINATED">Megszűnt</option>
            </Select>
          </FormField>
        </div>
        {/*
          A KÉT MEZŐ A MEGRENDELŐLAPRA MEGY, ÉS MI TÖLTJÜK KI -- Balázs
          döntése (2026-09-24): a vevő szervezeti egysége és kapcsolattartója
          egy visszatérő ügyfélnél ismert egy korábbi megrendelésből, nem a
          vevőre vár. Lásd
          exchange/nautilus-megrendelolap-lekepezesi-terv-2026-09-24.md.
        */}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            label="Vevő szervezeti egysége (megrendelőlapon)"
            htmlFor="contract-edit-org-unit"
          >
            <Input
              id="contract-edit-org-unit"
              placeholder="Szervezeti egység megnevezése"
              value={contract.organizationalUnitName ?? ""}
              onChange={(event) =>
                setContract({
                  ...contract,
                  organizationalUnitName: event.target.value || null,
                })
              }
            />
          </FormField>
          <FormField
            label="Vevő kapcsolattartója (megrendelőlapon)"
            htmlFor="contract-edit-contact"
          >
            <Input
              id="contract-edit-contact"
              placeholder="Ügyintéző"
              value={contract.contactPersonName ?? ""}
              onChange={(event) =>
                setContract({
                  ...contract,
                  contactPersonName: event.target.value || null,
                })
              }
            />
          </FormField>
        </div>
        <FormField label="Megjegyzés" htmlFor="contract-edit-notes">
          <Input
            id="contract-edit-notes"
            value={contract.notes ?? ""}
            onChange={(event) =>
              setContract({ ...contract, notes: event.target.value || null })
            }
          />
        </FormField>
        <div className="space-y-2">
          <Button
            disabled={saving || missing.length > 0}
            onClick={() => void save()}
          >
            {saving ? "Mentés…" : "Módosítások mentése"}
          </Button>
          {missing.length > 0 ? (
            <p className="text-xs font-medium text-rose-600">
              Hiányzik: {missing.join(", ")}.
            </p>
          ) : null}
        </div>
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">Szerződéses tételek</h2>
        {/*
          A HELYSZÍN ÉS AZ ESZKÖZ ITT SZERKESZTHETŐ -- acrobot kérése
          (2026-09-24 20:36, élesben blokkoló): a szerver mindig is tudta
          ezt a két mezőt (`ContractItem.departmentId`,
          `ContractItemAsset`), de a webes felületen sehol nem volt hozzá
          mező. A mentés a lap tetején lévő "Módosítások mentése" gombbal
          megy, ugyanabban a körben, mint a többi mező.
        */}
        {!departmentsLoaded ? (
          <p className="text-sm text-muted">Helyszínek betöltése…</p>
        ) : departmentOptions.length === 0 ? (
          <p className="text-sm text-muted">
            Ehhez a partnerhez nincs felvéve helyszín.
          </p>
        ) : null}
        <ul className="space-y-4 text-sm">
          {contract.items.map((item) => (
            <li key={item.id} className="space-y-2 border-b pb-3 last:border-0">
              <p>
                {item.position}. {item.description} — {item.unitNet} Ft ×{" "}
                {item.quantity} db × {item.occasionsPerYear} alkalom / év,{" "}
                {item.vatRatePercent}% ÁFA
              </p>
              {departmentOptions.length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <FormField
                    label="Helyszín"
                    htmlFor={`contract-item-department-${item.id}`}
                  >
                    <Select
                      id={`contract-item-department-${item.id}`}
                      value={itemDepartmentId[item.id] ?? ""}
                      onChange={(event) =>
                        setItemDepartmentId((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Nincs megadva</option>
                      {departmentOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <div className="space-y-1">
                    <span className="text-sm font-semibold">
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
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="text-lg font-semibold">Megrendelőlapok</h2>
        {orderError ? (
          <Alert
            variant="danger"
            title="Megrendelőlap-hiba"
            description={orderError}
          />
        ) : null}
        <div>
          <p className="mb-2 text-sm text-muted">
            Válaszd ki, mely tételekből visz egy-egy alkalmat a kiállítás
            (alapból az összes ki van jelölve):
          </p>
          <ul className="space-y-1 text-sm">
            {contract.items.map((item) => (
              <li key={item.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedItemIds.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                  />
                  {item.position}. {item.description}
                  {item.departmentId ? null : (
                    <span className="text-xs text-rose-600">
                      (nincs helyszín megadva -- nem állítható ki belőle)
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
          <Button
            className="mt-3"
            disabled={issuing || selectedCount === 0}
            onClick={() => void issue()}
          >
            {issuing
              ? "Kiállítás…"
              : `Megrendelőlap kiállítása (${selectedCount} tétel)`}
          </Button>
        </div>
        <div className="space-y-3">
          {orders === null ? (
            <p className="text-sm text-muted">Megrendelőlapok betöltése…</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-muted">
              Ehhez a szerződéshez még nem állítottunk ki megrendelőlapot.
            </p>
          ) : (
            orders.map((order) => (
              <div key={order.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {order.number} · {ORDER_STATUS_LABEL[order.status]} ·{" "}
                    {order.occasionYear}
                  </span>
                  {order.status === "ISSUED" ? (
                    <div className="flex items-center gap-2">
                      <label className="cursor-pointer text-brand-700 underline">
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
                      <Button
                        variant="secondary"
                        onClick={() => void revoke(order.id)}
                      >
                        Visszavonás
                      </Button>
                    </div>
                  ) : null}
                </div>
                <ul className="mt-2 space-y-1">
                  {order.documents.map((documentSummary) => (
                    <li key={documentSummary.id}>
                      <button
                        type="button"
                        className="text-brand-700 underline"
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
      </Card>
    </div>
  );
}
