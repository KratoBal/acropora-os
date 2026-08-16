"use client";

import {
  Alert,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type AssetCriticality,
  type AssetKind,
  type AssetListItem,
  type AssetOwnerOption,
  type AssetOwnerType,
  type AssetStatus,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { assetsApi } from "@/lib/api/assets";
import {
  assetCriticalityLabel,
  assetKindLabel,
  assetStatusLabel,
} from "./asset-labels";

const toIsoDate = (value: string) =>
  value ? `${value}T00:00:00.000Z` : undefined;
const inputDate = (value?: string) => value?.slice(0, 10) ?? "";

const ownerKey = (type: AssetOwnerType, id: string) => `${type}:${id}`;

export function AssetEditorPage({ assetId }: { assetId?: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const [owners, setOwners] = useState<AssetOwnerOption[]>([]);
  const [parentAssets, setParentAssets] = useState<AssetListItem[]>([]);
  const [selectedOwner, setSelectedOwner] = useState("");
  const [customerAddressId, setCustomerAddressId] = useState("");
  const [parentAssetId, setParentAssetId] = useState("");
  const [kind, setKind] = useState<AssetKind>("EQUIPMENT");
  const [status, setStatus] = useState<AssetStatus>("ACTIVE");
  const [criticality, setCriticality] = useState<AssetCriticality>("NORMAL");
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
  const [updatedAt, setUpdatedAt] = useState("");

  const owner = owners.find(
    (item) => ownerKey(item.type, item.id) === selectedOwner,
  );
  const addresses = owner?.addresses ?? [];

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    Promise.all([
      assetsApi.owners(token, controller.signal),
      assetId ? assetsApi.detail(token, assetId, controller.signal) : null,
    ])
      .then(([ownerResult, asset]) => {
        setOwners(ownerResult.items);
        if (!asset) return;
        setSelectedOwner(ownerKey(asset.owner.type, asset.owner.id));
        setCustomerAddressId(
          asset.owner.type === "CUSTOMER" ? (asset.address?.id ?? "") : "",
        );
        setParentAssetId(asset.parent?.id ?? "");
        setKind(asset.kind);
        setStatus(asset.status);
        setCriticality(asset.criticality);
        setName(asset.name);
        setCategory(asset.category ?? "");
        setManufacturer(asset.manufacturer ?? "");
        setModel(asset.model ?? "");
        setSerialNumber(asset.serialNumber ?? "");
        setInventoryNumber(asset.inventoryNumber ?? "");
        setInstalledAt(inputDate(asset.installedAt));
        setWarrantyExpiresAt(inputDate(asset.warrantyExpiresAt));
        setServiceIntervalDays(asset.serviceIntervalDays?.toString() ?? "");
        setNextServiceAt(inputDate(asset.nextServiceAt));
        setDescription(asset.description ?? "");
        setNotes(asset.notes ?? "");
        setUpdatedAt(asset.updatedAt);
      })
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
  }, [assetId, canManage, token]);

  useEffect(() => {
    setParentAssets([]);
    if (!owner) return;
    const controller = new AbortController();
    const assetQuery = new URLSearchParams({
      page: "1",
      pageSize: "100",
      status: "ACTIVE",
      ownerType: owner.type,
      ownerId: owner.id,
    });
    void assetsApi
      .list(token, assetQuery, controller.signal)
      .then((result) =>
        setParentAssets(result.items.filter((item) => item.id !== assetId)),
      )
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A partner eszközadatai nem tölthetők be.",
          );
      });
    return () => controller.abort();
  }, [assetId, owner, token]);

  useEffect(() => {
    if (assetId) return;
    const interval = Number.parseInt(serviceIntervalDays, 10);
    if (!Number.isInteger(interval) || interval < 1) return;
    const base = installedAt
      ? new Date(`${installedAt}T00:00:00.000Z`)
      : new Date();
    base.setUTCDate(base.getUTCDate() + interval);
    setNextServiceAt(base.toISOString().slice(0, 10));
  }, [assetId, installedAt, serviceIntervalDays]);

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
    if (!owner || !name.trim()) {
      setError("A partner és az eszköz neve kötelező.");
      return;
    }
    const interval = serviceIntervalDays
      ? Number.parseInt(serviceIntervalDays, 10)
      : undefined;
    if (
      interval !== undefined &&
      (!Number.isInteger(interval) || interval < 1)
    ) {
      setError("A karbantartási intervallum legalább 1 nap legyen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = assetId
        ? await assetsApi.update(token, assetId, {
            ownerType: owner.type,
            ownerId: owner.id,
            customerAddressId: customerAddressId || null,
            parentAssetId: parentAssetId || null,
            kind,
            status,
            criticality,
            name: name.trim(),
            category: category.trim() || null,
            manufacturer: manufacturer.trim() || null,
            model: model.trim() || null,
            serialNumber: serialNumber.trim() || null,
            inventoryNumber: inventoryNumber.trim() || null,
            installedAt: toIsoDate(installedAt) ?? null,
            warrantyExpiresAt: toIsoDate(warrantyExpiresAt) ?? null,
            serviceIntervalDays: interval ?? null,
            nextServiceAt: toIsoDate(nextServiceAt) ?? null,
            description: description.trim() || null,
            notes: notes.trim() || null,
            expectedUpdatedAt: updatedAt,
          })
        : await assetsApi.create(token, {
            ownerType: owner.type,
            ownerId: owner.id,
            customerAddressId: customerAddressId || undefined,
            parentAssetId: parentAssetId || undefined,
            kind,
            status,
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
      router.push(`/szerviz/eszkozok/${saved.id}`);
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
        eyebrow="Szerviz / Eszköznyilvántartás"
        title={assetId ? "Eszköz módosítása" : "Új eszköz"}
        description="Önálló berendezés vagy egy meglévő rendszer részegységének rögzítése."
        actions={
          <Link href="/szerviz/eszkozok">
            <Button variant="secondary">Vissza a listához</Button>
          </Link>
        }
      />
      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
        />
      ) : null}
      <form className="space-y-6" onSubmit={submit}>
        <Card className="p-6">
          <h2 className="font-semibold text-slate-950">Hozzárendelés</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FormField label="Partner">
              <Select
                required
                aria-label="Partner"
                value={selectedOwner}
                disabled={loadingOptions}
                onChange={(event) => {
                  setSelectedOwner(event.target.value);
                  setCustomerAddressId("");
                  setParentAssetId("");
                }}
              >
                <option value="">Válassz partnert…</option>
                {owners.map((item) => (
                  <option
                    key={ownerKey(item.type, item.id)}
                    value={ownerKey(item.type, item.id)}
                  >
                    {item.type === "CUSTOMER" ? "Vevő" : "Partner"} ·{" "}
                    {item.displayName} ({item.code})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Helyszín / partnercím">
              <Select
                aria-label="Helyszín"
                value={customerAddressId}
                disabled={!owner || owner.type !== "CUSTOMER"}
                onChange={(event) => setCustomerAddressId(event.target.value)}
              >
                <option value="">Nincs pontosítva</option>
                {addresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.name ? `${address.name} – ` : ""}
                    {address.formatted}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Szülőeszköz">
              <Select
                aria-label="Szülőeszköz"
                value={parentAssetId}
                disabled={!owner}
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
            <FormField label="Státusz">
              <Select
                aria-label="Eszköz státusza"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as AssetStatus)
                }
              >
                {Object.entries(assetStatusLabel).map(([value, label]) => (
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
            <Textarea
              aria-label="Leírás"
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
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
            <Textarea
              aria-label="Belső megjegyzés"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={busy || loadingOptions}>
            {busy
              ? "Mentés…"
              : assetId
                ? "Módosítások mentése"
                : "Eszköz létrehozása"}
          </Button>
        </div>
      </form>
    </div>
  );
}
