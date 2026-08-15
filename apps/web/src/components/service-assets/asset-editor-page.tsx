"use client";

import {
  Alert,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Select,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type AssetCriticality,
  type AssetKind,
  type AssetListItem,
  type CustomerAddress,
  type CustomerSummary,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { assetsApi } from "@/lib/api/assets";
import { customersApi } from "@/lib/api/customers";
import { assetCriticalityLabel, assetKindLabel } from "./asset-labels";

const toIsoDate = (value: string) =>
  value ? `${value}T00:00:00.000Z` : undefined;

export function AssetEditorPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [parentAssets, setParentAssets] = useState<AssetListItem[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerAddressId, setCustomerAddressId] = useState("");
  const [parentAssetId, setParentAssetId] = useState("");
  const [kind, setKind] = useState<AssetKind>("EQUIPMENT");
  const [criticality, setCriticality] =
    useState<AssetCriticality>("NORMAL");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [inventoryNumber, setInventoryNumber] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const [warrantyExpiresAt, setWarrantyExpiresAt] = useState("");
  const [serviceIntervalDays, setServiceIntervalDays] = useState("");
  const [nextServiceAt, setNextServiceAt] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      page: "1",
      pageSize: "100",
      status: "ACTIVE",
    });
    customersApi
      .list(token, query, controller.signal)
      .then((result) => setCustomers(result.items))
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A partnerlista nem tölthető be.",
          );
      })
      .finally(() => setLoadingOptions(false));
    return () => controller.abort();
  }, [canManage, token]);

  useEffect(() => {
    setCustomerAddressId("");
    setParentAssetId("");
    setAddresses([]);
    setParentAssets([]);
    if (!customerId) return;
    const controller = new AbortController();
    const assetQuery = new URLSearchParams({
      page: "1",
      pageSize: "100",
      status: "ACTIVE",
      customerId,
    });
    void Promise.all([
      customersApi
        .detail(token, customerId, controller.signal)
        .then((customer) => setAddresses(customer.addresses)),
      assetsApi
        .list(token, assetQuery, controller.signal)
        .then((result) => setParentAssets(result.items)),
    ]).catch((cause) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError"))
        setError(
          cause instanceof Error
            ? cause.message
            : "A partner eszközadatai nem tölthetők be.",
        );
    });
    return () => controller.abort();
  }, [customerId, token]);

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod eszköz rögzítéséhez"
        description="service.manage jogosultság szükséges."
      />
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!customerId || !name.trim()) {
      setError("A partner és az eszköz neve kötelező.");
      return;
    }
    const interval = serviceIntervalDays
      ? Number.parseInt(serviceIntervalDays, 10)
      : undefined;
    if (interval !== undefined && (!Number.isInteger(interval) || interval < 1)) {
      setError("A karbantartási intervallum legalább 1 nap legyen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await assetsApi.create(token, {
        customerId,
        customerAddressId: customerAddressId || undefined,
        parentAssetId: parentAssetId || undefined,
        kind,
        criticality,
        name: name.trim(),
        category: category.trim() || undefined,
        manufacturer: manufacturer.trim() || undefined,
        model: model.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        inventoryNumber: inventoryNumber.trim() || undefined,
        installedAt: toIsoDate(installedAt),
        warrantyExpiresAt: toIsoDate(warrantyExpiresAt),
        serviceIntervalDays: interval,
        nextServiceAt: toIsoDate(nextServiceAt),
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      router.push(`/szerviz/eszkozok/${created.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az eszköz nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Szerviz / Eszközök"
        title="Új eszköz"
        description="Önálló berendezés vagy egy meglévő rendszer részegységének rögzítése."
        actions={
          <Link href="/szerviz/eszkozok">
            <Button variant="secondary">Vissza a listához</Button>
          </Link>
        }
      />
      {error ? (
        <Alert variant="danger" title="A művelet nem sikerült" description={error} />
      ) : null}
      <form className="space-y-6" onSubmit={submit}>
        <Card className="p-6">
          <h2 className="font-semibold text-slate-950">Hozzárendelés</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FormField label="Partner">
              <Select
                required
                aria-label="Partner"
                value={customerId}
                disabled={loadingOptions}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">Válassz partnert…</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName} ({customer.partnerCode})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Helyszín / partnercím">
              <Select
                aria-label="Helyszín"
                value={customerAddressId}
                disabled={!customerId}
                onChange={(event) => setCustomerAddressId(event.target.value)}
              >
                <option value="">Nincs pontosítva</option>
                {addresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.name ? `${address.name} – ` : ""}
                    {address.postalCode} {address.city}, {address.line1}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Szülőeszköz">
              <Select
                aria-label="Szülőeszköz"
                value={parentAssetId}
                disabled={!customerId}
                onChange={(event) => setParentAssetId(event.target.value)}
              >
                <option value="">Önálló / főegység</option>
                {parentAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name} ({asset.assetNumber})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Típus">
              <Select
                aria-label="Eszköztípus"
                value={kind}
                onChange={(event) => setKind(event.target.value as AssetKind)}
              >
                {Object.entries(assetKindLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-slate-950">Azonosítás</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FormField label="Eszköz neve">
              <Input
                required
                aria-label="Eszköz neve"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="pl. Fóka felnyomó szivattyú"
              />
            </FormField>
            <FormField label="Kategória">
              <Input
                aria-label="Kategória"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="pl. Vízmozgatás"
              />
            </FormField>
            <FormField label="Gyártó">
              <Input
                aria-label="Gyártó"
                value={manufacturer}
                onChange={(event) => setManufacturer(event.target.value)}
              />
            </FormField>
            <FormField label="Modell">
              <Input
                aria-label="Modell"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </FormField>
            <FormField label="Sorozatszám">
              <Input
                aria-label="Sorozatszám"
                value={serialNumber}
                onChange={(event) => setSerialNumber(event.target.value)}
              />
            </FormField>
            <FormField label="Leltári szám">
              <Input
                aria-label="Leltári szám"
                value={inventoryNumber}
                onChange={(event) => setInventoryNumber(event.target.value)}
              />
            </FormField>
            <FormField label="Kritikusság">
              <Select
                aria-label="Kritikusság"
                value={criticality}
                onChange={(event) =>
                  setCriticality(event.target.value as AssetCriticality)
                }
              >
                {Object.entries(assetCriticalityLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <FormField label="Leírás" className="mt-4">
            <textarea
              aria-label="Leírás"
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
          </FormField>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-slate-950">Karbantartás</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FormField label="Telepítés dátuma">
              <Input
                type="date"
                aria-label="Telepítés dátuma"
                value={installedAt}
                onChange={(event) => setInstalledAt(event.target.value)}
              />
            </FormField>
            <FormField label="Garancia lejárata">
              <Input
                type="date"
                aria-label="Garancia lejárata"
                value={warrantyExpiresAt}
                onChange={(event) => setWarrantyExpiresAt(event.target.value)}
              />
            </FormField>
            <FormField label="Intervallum (nap)">
              <Input
                type="number"
                min={1}
                max={3650}
                aria-label="Karbantartási intervallum"
                value={serviceIntervalDays}
                onChange={(event) => setServiceIntervalDays(event.target.value)}
              />
            </FormField>
            <FormField label="Következő karbantartás">
              <Input
                type="date"
                aria-label="Következő karbantartás"
                value={nextServiceAt}
                onChange={(event) => setNextServiceAt(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Belső megjegyzés" className="mt-4">
            <textarea
              aria-label="Belső megjegyzés"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
          </FormField>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={busy || loadingOptions}>
            {busy ? "Mentés…" : "Eszköz létrehozása"}
          </Button>
        </div>
      </form>
    </div>
  );
}
