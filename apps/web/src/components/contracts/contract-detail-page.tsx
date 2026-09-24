"use client";

import { Alert, Button, Card, Input, Select } from "@acropora/ui";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contractsApi, type ContractSummary } from "@/lib/api/contracts";
import {
  maintenanceOrdersApi,
  type MaintenanceOrderSummary,
} from "@/lib/api/maintenance-orders";

const ORDER_STATUS_LABEL: Record<MaintenanceOrderSummary["status"], string> = {
  ISSUED: "Kiállítva",
  SIGNED: "Aláírva",
  REVOKED: "Visszavonva",
};

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

  const load = async () => {
    try {
      const detail = await contractsApi.detail(token, contractId);
      setContract(detail);
      // ALAPÉRTELMEZÉSBEN AZ ÖSSZES TÉTEL KI VAN VÁLASZTVA -- Balázs
      // döntése (2026-09-24): egy kiállítás a szerződés összes tételéből
      // visz egy-egy alkalmat, de tételenként kivehető.
      setSelectedItemIds(new Set(detail.items.map((item) => item.id)));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A szerződés nem tölthető be.",
      );
    }
  };
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
  useEffect(() => {
    if (token) {
      void load();
      void loadOrders();
    }
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
          <Input
            aria-label="Szerződésszám"
            value={contract.number}
            onChange={(event) =>
              setContract({ ...contract, number: event.target.value })
            }
          />
          <Input
            aria-label="Szerződés címe"
            value={contract.title}
            onChange={(event) =>
              setContract({ ...contract, title: event.target.value })
            }
          />
          <Input
            type="date"
            aria-label="Érvényes ettől"
            value={contract.validFrom.slice(0, 10)}
            onChange={(event) =>
              setContract({ ...contract, validFrom: event.target.value })
            }
          />
          <Input
            type="date"
            aria-label="Érvényes eddig"
            value={contract.validTo?.slice(0, 10) ?? ""}
            onChange={(event) =>
              setContract({ ...contract, validTo: event.target.value || null })
            }
          />
          <Select
            aria-label="Állapot"
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
        </div>
        {/*
          A KÉT MEZŐ A MEGRENDELŐLAPRA MEGY, ÉS MI TÖLTJÜK KI -- Balázs
          döntése (2026-09-24): a vevő szervezeti egysége és kapcsolattartója
          egy visszatérő ügyfélnél ismert egy korábbi megrendelésből, nem a
          vevőre vár. Lásd
          exchange/nautilus-megrendelolap-lekepezesi-terv-2026-09-24.md.
        */}
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            aria-label="Vevő szervezeti egysége (megrendelőlapon)"
            placeholder="Szervezeti egység megnevezése"
            value={contract.organizationalUnitName ?? ""}
            onChange={(event) =>
              setContract({
                ...contract,
                organizationalUnitName: event.target.value || null,
              })
            }
          />
          <Input
            aria-label="Vevő kapcsolattartója (megrendelőlapon)"
            placeholder="Ügyintéző"
            value={contract.contactPersonName ?? ""}
            onChange={(event) =>
              setContract({
                ...contract,
                contactPersonName: event.target.value || null,
              })
            }
          />
        </div>
        <Input
          aria-label="Megjegyzés"
          value={contract.notes ?? ""}
          onChange={(event) =>
            setContract({ ...contract, notes: event.target.value || null })
          }
        />
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? "Mentés…" : "Módosítások mentése"}
        </Button>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-lg font-semibold">Szerződéses tételek</h2>
        <ul className="space-y-2 text-sm">
          {contract.items.map((item) => (
            <li key={item.id}>
              {item.position}. {item.description} — {item.unitNet} Ft ×{" "}
              {item.quantity} db × {item.occasionsPerYear} alkalom / év,{" "}
              {item.vatRatePercent}% ÁFA
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
