"use client";
import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@acropora/ui";
import { hasPermission, PERMISSIONS, type BrandDetail } from "@acropora/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import { brandsApi } from "@/lib/api/brands";

export function BrandEditorPage({ brandId }: { brandId?: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [brand, setBrand] = useState<BrandDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(brandId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [name, setName] = useState(searchParams.get("name") ?? "");
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [alias, setAlias] = useState(searchParams.get("sourceName") ?? "");
  const [aliasSource, setAliasSource] = useState(
    searchParams.get("source") ?? "MANUAL",
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const token = session?.token ?? "";
  const load = async () => {
    if (!brandId || !session) return;
    setLoading(true);
    try {
      const next = await brandsApi.detail(token, brandId);
      setBrand(next);
      setName(next.name);
      setDescription(next.description ?? "");
      setWebsiteUrl(next.websiteUrl ?? "");
      setLogoUrl(next.logoUrl ?? "");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A márka nem tölthető be.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [brandId, token]);
  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs szerkesztési jogosultságod"
        description="A márkaadatok módosításához products.manage szükséges."
      />
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("A kanonikus név kötelező.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (brand)
        setBrand(
          await brandsApi.update(token, brand.id, {
            name,
            description: description || null,
            websiteUrl: websiteUrl || null,
            logoUrl: logoUrl || null,
            expectedUpdatedAt: brand.updatedAt,
          }),
        );
      else {
        const created = await brandsApi.create(token, {
          name,
          description: description || undefined,
          websiteUrl: websiteUrl || undefined,
          logoUrl: logoUrl || undefined,
          aliases: alias.trim() ? [{ alias, source: aliasSource }] : [],
        });
        const returnTo = searchParams.get("returnTo");
        router.push(
          returnTo
            ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}brandCreated=${created.id}`
            : `/admin/brands/${created.id}`,
        );
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "A név vagy alias már használatban van, illetve az adat időközben megváltozott."
          : cause instanceof Error
            ? cause.message
            : "A mentés sikertelen.",
      );
      if (cause instanceof ApiError && cause.status === 409 && brandId)
        await load();
    } finally {
      setBusy(false);
    }
  };
  const addAlias = async () => {
    if (!brand || !alias.trim()) return;
    setBusy(true);
    try {
      setBrand(
        await brandsApi.addAlias(token, brand.id, {
          alias,
          source: aliasSource,
        }),
      );
      setAlias("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az alias nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!brand) return;
    setBusy(true);
    try {
      setBrand(
        brand.isActive
          ? await brandsApi.archive(token, brand.id)
          : await brandsApi.restore(token, brand.id),
      );
      setConfirmArchive(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az állapot nem módosítható.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <div aria-label="Márka betöltése">
        <Skeleton className="h-96" />
      </div>
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title={brand ? brand.name : "Új márka"}
        description="Kanonikus identitás, megjelenés, aliasok és forráskapcsolatok."
        actions={
          <Link href="/admin/brands">
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
          <h2 className="font-semibold">Identitás</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField label="Kanonikus név">
              <Input
                aria-label="Kanonikus név"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField label="Slug">
              <Input disabled value={brand?.slug ?? "Mentéskor generálódik"} />
            </FormField>
          </div>
          {brand ? (
            <div className="mt-4 flex items-center gap-2">
              <Badge variant={brand.isActive ? "success" : "neutral"}>
                {brand.isActive ? "Aktív" : "Archivált"}
              </Badge>
              <span className="text-xs text-slate-500">
                Normalizált kulcs: {brand.normalizedName}
              </span>
            </div>
          ) : null}
        </Card>
        <Card className="p-6">
          <h2 className="font-semibold">Megjelenés</h2>
          <div className="mt-4 grid gap-4">
            <FormField label="Leírás">
              <textarea
                aria-label="Leírás"
                className="min-h-24 w-full rounded-lg border border-slate-200 p-3 text-sm"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Weboldal URL">
                <Input
                  type="url"
                  value={websiteUrl}
                  onChange={(event) => setWebsiteUrl(event.target.value)}
                />
              </FormField>
              <FormField label="Logó URL">
                <Input
                  type="url"
                  value={logoUrl}
                  onChange={(event) => setLogoUrl(event.target.value)}
                />
              </FormField>
            </div>
          </div>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? "Mentés…" : "Változások mentése"}
          </Button>
        </div>
      </form>
      {brand ? (
        <>
          <Card className="p-6">
            <h2 className="font-semibold">Aliasok</h2>
            <div className="mt-4 flex gap-2">
              <Input
                aria-label="Új alias"
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                placeholder="Forrásnév"
              />
              <Select
                aria-label="Alias forrása"
                value={aliasSource}
                onChange={(event) => setAliasSource(event.target.value)}
              >
                <option>MANUAL</option>
                <option>UNAS</option>
              </Select>
              <Button
                disabled={busy || !alias.trim()}
                onClick={() => void addAlias()}
              >
                Alias hozzáadása
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              {brand.aliases.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <strong>{item.alias}</strong> <Badge>{item.source}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(`Törlöd ezt az aliast: ${item.alias}?`)
                      )
                        void brandsApi
                          .removeAlias(token, brand.id, item.id)
                          .then(setBrand)
                          .catch((cause) =>
                            setError(
                              cause instanceof Error
                                ? cause.message
                                : "Az alias nem törölhető.",
                            ),
                          );
                    }}
                  >
                    Eltávolítás
                  </Button>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-6">
            <h2 className="font-semibold">Használat és források</h2>
            <p className="mt-2 text-sm">
              {brand.usage.productCount} termék ·{" "}
              {brand.usage.reviewReferenceCount} review hivatkozás
            </p>
            <div className="mt-3">
              {brand.externalMappings.map((mapping) => (
                <Badge key={mapping.id}>
                  {mapping.system}: {mapping.externalId}
                </Badge>
              ))}
            </div>
          </Card>
          <Card className="p-6">
            <h2 className="font-semibold">Audit</h2>
            <p className="mt-2 text-sm text-slate-500">
              Létrehozva: {new Date(brand.createdAt).toLocaleString("hu-HU")} ·
              Frissítve: {new Date(brand.updatedAt).toLocaleString("hu-HU")}
              {brand.archivedAt
                ? ` · Archiválva: ${new Date(brand.archivedAt).toLocaleString("hu-HU")}`
                : ""}
            </p>
            <Button
              className="mt-4"
              variant={brand.isActive ? "danger" : "secondary"}
              onClick={() =>
                brand.isActive ? setConfirmArchive(true) : void archive()
              }
            >
              {brand.isActive ? "Archiválás" : "Visszaállítás"}
            </Button>
          </Card>
        </>
      ) : null}
      {confirmArchive ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
        >
          <Card className="max-w-lg p-6">
            <h2 id="archive-title" className="font-semibold">
              Márka archiválása
            </h2>
            <p className="mt-2 text-sm">
              A márkát {brand?.usage.productCount ?? 0} termék használja. A
              meglévő termékkapcsolatok és importelőzmények megmaradnak, de
              automatikus új hozzárendelés nem történhet.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmArchive(false)}
              >
                Mégse
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void archive()}
              >
                Archiválás megerősítése
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
