"use client";

import { Alert, Button, Card, Input, Select } from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contractsApi, type ContractSummary } from "@/lib/api/contracts";

type DraftItem = {
  description: string;
  unitNet: string;
  quantity: string;
  occasionsPerYear: string;
  vatRatePercent: string;
};
const emptyItem = (): DraftItem => ({
  description: "",
  unitNet: "",
  quantity: "1",
  occasionsPerYear: "1",
  vatRatePercent: "27",
});

function money(value: string) {
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 }).format(
    Number(value),
  );
}

/**
 * Irodai szerződéslap. A műszaki munkalap-szerkesztőt szándékosan nem használja:
 * az itt megjelenő egységár nem kerülhet technikusi képernyőre.
 */
export function ContractsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PARTNERS_MANAGE),
  );
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [customers, setCustomers] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    customerId: "",
    number: "",
    title: "",
    validFrom: "",
    validTo: "",
    notes: "",
    items: [emptyItem()],
  });

  const load = async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const [items, customerRows] = await Promise.all([
        contractsApi.list(token),
        contractsApi.customers(token),
      ]);
      setContracts(items);
      setCustomers(customerRows);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A szerződések nem tölthetők be.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [canManage, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const yearly = useMemo(
    () =>
      draft.items.reduce(
        (total, item) =>
          total +
          Number(item.unitNet || 0) *
            Number(item.quantity || 0) *
            Number(item.occasionsPerYear || 0),
        0,
      ),
    [draft.items],
  );
  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a szerződésekhez"
        description="partners.manage jogosultság szükséges."
      />
    );

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      await contractsApi.create(token, {
        customerId: draft.customerId,
        number: draft.number,
        title: draft.title,
        validFrom: draft.validFrom,
        validTo: draft.validTo || null,
        notes: draft.notes || null,
        items: draft.items.map((item) => ({
          ...item,
          occasionsPerYear: Number(item.occasionsPerYear),
        })),
      });
      setDraft({
        customerId: "",
        number: "",
        title: "",
        validFrom: "",
        validTo: "",
        notes: "",
        items: [emptyItem()],
      });
      setCreating(false);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A szerződés nem menthető.",
      );
    } finally {
      setSaving(false);
    }
  };

  const upload = async (id: string, file: File | undefined) => {
    if (!file) return;
    setUploading(id);
    setError(null);
    try {
      await contractsApi.uploadPdf(token, id, file);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető fel.",
      );
    } finally {
      setUploading(null);
    }
  };

  const download = async (
    contractId: string,
    documentId: string,
    fileName: string,
  ) => {
    try {
      const blob = await contractsApi.downloadPdf(
        token,
        contractId,
        documentId,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető le.",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted">Partnerek</p>
          <h1 className="text-2xl font-semibold">Szerződések</h1>
          <p className="mt-1 text-sm text-muted">
            Az éves díj a tétel egységárából, darabszámából és alkalomszámából
            számolódik.
          </p>
        </div>
        <Button onClick={() => setCreating((value) => !value)}>
          {creating ? "Űrlap bezárása" : "Új szerződés"}
        </Button>
      </div>
      {error ? (
        <Alert variant="danger" title="Műveleti hiba" description={error} />
      ) : null}
      {creating ? (
        <Card className="space-y-4 p-5">
          <h2 className="text-lg font-semibold">Új keretszerződés</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              aria-label="Partner"
              value={draft.customerId}
              onChange={(event) =>
                setDraft({ ...draft, customerId: event.target.value })
              }
            >
              <option value="">Partner kiválasztása</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.displayName}
                </option>
              ))}
            </Select>
            <Input
              placeholder="Szerződésszám (pl. SZ2026/0000019)"
              value={draft.number}
              onChange={(event) =>
                setDraft({ ...draft, number: event.target.value })
              }
            />
            <Input
              placeholder="Szerződés címe"
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
            <Input
              type="date"
              aria-label="Érvényes ettől"
              value={draft.validFrom}
              onChange={(event) =>
                setDraft({ ...draft, validFrom: event.target.value })
              }
            />
            <Input
              type="date"
              aria-label="Érvényes eddig"
              value={draft.validTo}
              onChange={(event) =>
                setDraft({ ...draft, validTo: event.target.value })
              }
            />
          </div>
          <div className="space-y-3">
            <h3 className="font-medium">Tételek</h3>
            {draft.items.map((item, index) => (
              <div className="grid gap-2 md:grid-cols-5" key={index}>
                <Input
                  placeholder="Tétel leírása"
                  value={item.description}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, description: event.target.value }
                          : row,
                      ),
                    })
                  }
                />
                <Input
                  inputMode="decimal"
                  placeholder="Nettó egységár"
                  value={item.unitNet}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, unitNet: event.target.value }
                          : row,
                      ),
                    })
                  }
                />
                <Input
                  inputMode="decimal"
                  placeholder="db"
                  value={item.quantity}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, quantity: event.target.value }
                          : row,
                      ),
                    })
                  }
                />
                <Input
                  inputMode="numeric"
                  placeholder="alkalom / év"
                  value={item.occasionsPerYear}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, occasionsPerYear: event.target.value }
                          : row,
                      ),
                    })
                  }
                />
                <Input
                  inputMode="decimal"
                  placeholder="ÁFA %"
                  value={item.vatRatePercent}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, vatRatePercent: event.target.value }
                          : row,
                      ),
                    })
                  }
                />
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() =>
                setDraft({ ...draft, items: [...draft.items, emptyItem()] })
              }
            >
              Tétel hozzáadása
            </Button>
            <p className="text-sm text-muted">
              Éves nettó összesen: {money(String(yearly))} Ft
            </p>
          </div>
          <Button disabled={saving} onClick={() => void create()}>
            {saving ? "Mentés…" : "Szerződés mentése"}
          </Button>
        </Card>
      ) : null}
      {loading ? (
        <p className="text-sm text-muted">Szerződések betöltése…</p>
      ) : contracts.length === 0 ? (
        <Card className="p-5 text-sm text-muted">
          Még nincs rögzített szerződés.
        </Card>
      ) : (
        contracts.map((contract) => (
          <Card className="space-y-3 p-5" key={contract.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-muted">
                  {contract.number} · {contract.customer.displayName}
                </p>
                <h2 className="text-lg font-semibold">{contract.title}</h2>
                <p className="text-sm text-muted">
                  Érvényes:{" "}
                  {new Date(contract.validFrom).toLocaleDateString("hu-HU")}
                  {contract.validTo
                    ? ` – ${new Date(contract.validTo).toLocaleDateString("hu-HU")}`
                    : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium"
                  href={`/partnerek/szerzodesek/${contract.id}`}
                >
                  Részletek és szerkesztés
                </Link>
                <label className="inline-flex cursor-pointer items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                  <input
                    className="sr-only"
                    type="file"
                    accept="application/pdf"
                    disabled={uploading === contract.id}
                    onChange={(event) =>
                      void upload(contract.id, event.target.files?.[0])
                    }
                  />
                  {uploading === contract.id ? "Feltöltés…" : "PDF feltöltése"}
                </label>
              </div>
            </div>
            <ul className="space-y-1 text-sm">
              {contract.items.map((item) => (
                <li key={item.id}>
                  {item.position}. {item.description} —{" "}
                  {money(
                    String(
                      Number(item.unitNet) *
                        Number(item.quantity) *
                        item.occasionsPerYear,
                    ),
                  )}{" "}
                  Ft nettó / év
                </li>
              ))}
            </ul>
            {contract.documents.length ? (
              <div className="flex flex-wrap gap-2">
                {contract.documents.map((document) => (
                  <Button
                    key={document.id}
                    variant="secondary"
                    onClick={() =>
                      void download(contract.id, document.id, document.fileName)
                    }
                  >
                    {document.fileName}
                  </Button>
                ))}
              </div>
            ) : null}
          </Card>
        ))
      )}
    </div>
  );
}
