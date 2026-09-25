"use client";

import {
  Alert,
  Button,
  ConfirmDialog,
  FormField,
  Icon,
  Input,
  Select,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type AssetDetail,
  type AssetDocumentType,
  type AssetQrCode,
  type AssetStatus,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { ServiceDocumentGallery } from "@/components/service/service-document-gallery";
import { assetsApi } from "@/lib/api/assets";
import {
  assetEventLabel,
  assetStatusLabel,
  assetStatusPilotVariant,
} from "../asset-labels";
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

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- ESZKÖZ ADATLAP (7. kör, 2/3 rész).
 *
 * Brief: `exchange/figma-eszkozok-atultetes-brief-2026-09-25.md`, forrás:
 * `exchange/figma-eszkozok-make-7/src/EszközScreen.tsx` (`EszközDetail`,
 * 455-747. sor).
 *
 * === A "VARRAT": MI KAP FIGMA-STÍLUST, MI MARAD RÉGI ===
 *
 * A mai (nem pilot) adatlap ÖSSZETETT, valódi funkciójú alrendszereket
 * ágyaz be: dokumentum-galéria + feltöltés (`ServiceDocumentGallery`,
 * ugyanaz a komponens, amit a hibajegy és a munkalap lapja is használ),
 * QR-csere, kivezetés és végleges törlés -- mindegyik megerősítő ablakkal
 * (`ConfirmDialog`). Ezek a mai kinézetükben maradnak, a Hibajegyek/
 * Akváriumok köröknél már bevált mintát követve: a kártya KERETE Figma-
 * stílust kap, a BELSEJE nem.
 *
 * === NÉGY KÜLÖN KÁRTYA A FIGMA SZERINT, EGY HELYETT ===
 *
 * A mai adatlap egyetlen, nagy `<dl>`-rácsban mutatja az Azonosítás/
 * Technikai/Hozzárendelés/Karbantartás mezőket. A Figma-terv ezt négy
 * külön kártyára bontja (Azonosítás, Technikai adatok, Hozzárendelés,
 * Karbantartás) -- ez csak MEGJELENÍTÉS, nem adatvesztés, mert minden mező
 * MEGVAN az `AssetDetail`-ben, csak máshogy csoportosítva jelenik meg.
 *
 * === EGY MEZŐ, AMIT A FIGMA KÉTSZER KÉR, ÉS EZ ÖSSZEVONVA MARAD ===
 *
 * A Figma "Hozzárendelés" kártyája "Tulajdonos" ÉS "Partner" mezőt is kér
 * -- a valóságban ez UGYANAZ az adat (`asset.owner.displayName`), a
 * tulajdonos lehet vevő vagy szállító partner, de nincs KÉT külön mező.
 * Ez a kártya ezért csak EGYSZER mutatja, "Tulajdonos" néven.
 *
 * === "KÖVETKEZŐ KARBANTARTÁS": SZERKESZTHETŐ, NEM CSAK OLVASHATÓ ===
 *
 * A Figma a "Karbantartás" kártyában olvasható mezőként kéri. A valóságban
 * ez a "Helyszíni állapot" kártya SZERKESZTHETŐ mezője (a mai adatlapon
 * is ott van, nem a műszaki rácsban) -- ott is marad, hogy a szerkesztés
 * ne szakadjon két helyre.
 *
 * === TÖBBSZINTŰ HIERARCHIA, NEM CSAK EGY SZÜLŐ ===
 *
 * A Figma mintaadata csak EGY szülőt ismer. A valódi `AssetDetail.ancestors`
 * a TELJES felmenő láncot adja (nem csak a közvetlen szülőt) -- ez a
 * képesség megmarad, nem szűkül egyetlen szülőre.
 */

const inputDate = (value?: string) => (value ? value.slice(0, 10) : "");
const isoDate = (value: string) => (value ? `${value}T00:00:00.000Z` : null);

const documentTypeLabel: Record<AssetDocumentType, string> = {
  INVOICE: "Számla",
  WARRANTY: "Garanciajegy",
  MANUAL: "Használati utasítás",
  OTHER: "Egyéb",
  PHOTO: "Fénykép",
};

type PendingConfirm =
  | { kind: "rotate-qr" }
  | { kind: "retire" }
  | { kind: "delete-asset" }
  | { kind: "delete-document"; documentId: string; fileName: string };

function performanceText(value?: string, unitCode?: string) {
  if (!value) return undefined;
  return unitCode ? `${value} ${unitCode}` : value;
}
function formatDate(value?: string) {
  return value
    ? new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : undefined;
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="mb-0.5 text-[11px] text-pilot-grey-400">{label}</p>
      <p className="text-sm text-pilot-grey-800">{value}</p>
    </div>
  );
}

export function PilotAssetDetailPage({ assetId }: { assetId: string }) {
  const backToList = useReturnTo("/szerviz/eszkozok");
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const canDelete = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_ASSET_DELETE),
  );

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [qr, setQr] = useState<AssetQrCode | null>(null);
  const [status, setStatus] = useState<AssetStatus>("ACTIVE");
  const [nextServiceAt, setNextServiceAt] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [documentType, setDocumentType] =
    useState<AssetDocumentType>("INVOICE");
  const [documentFile, setDocumentFile] = useState<File | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        const [detail, code] = await Promise.all([
          assetsApi.detail(token, assetId, signal),
          assetsApi.qr(token, assetId, signal),
        ]);
        setAsset(detail);
        setQr(code);
        setStatus(detail.status);
        setNextServiceAt(inputDate(detail.nextServiceAt));
        setNotes(detail.notes ?? "");
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "Az eszköz adatlapja nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [assetId, canView, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const save = async () => {
    if (!asset || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await assetsApi.update(token, asset.id, {
        status,
        nextServiceAt: isoDate(nextServiceAt),
        notes: notes.trim() || null,
        expectedUpdatedAt: asset.updatedAt,
      });
      setAsset(updated);
      setNotice("Az eszköz állapota és karbantartási adatai elmentve.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A módosítás nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  };

  const retire = async () => {
    if (!asset || busy) return;
    setPending(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await assetsApi.update(token, asset.id, {
        status: "RETIRED",
        expectedUpdatedAt: asset.updatedAt,
      });
      setAsset(updated);
      setStatus("RETIRED");
      setNotice(
        "Az eszköz kivezetve. Az aktív listákban nem jelenik meg, de megmaradt, és bármikor visszaállítható itt, az állapot mezőben.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A kivezetés nem menthető.",
      );
    } finally {
      setBusy(false);
    }
  };

  const removeAsset = async () => {
    if (!asset || busy) return;
    setPending(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await assetsApi.remove(token, asset.id);
      setDeleted(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az eszköz nem törölhető.",
      );
    } finally {
      setBusy(false);
    }
  };

  const rotateQr = async () => {
    if (!asset || busy) return;
    setPending(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await assetsApi.rotateQr(token, asset.id);
      const code = await assetsApi.qr(token, asset.id);
      setAsset(updated);
      setQr(code);
      setNotice("Új QR-kód készült. A régi matrica már nem használható.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A QR-kód nem cserélhető le.",
      );
    } finally {
      setBusy(false);
    }
  };

  const downloadQr = () => {
    if (!qr) return;
    const url = URL.createObjectURL(
      new Blob([qr.svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${qr.assetNumber}-qr.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const uploadDocument = async () => {
    if (!asset || !documentFile || busy) return;
    setBusy(true);
    setError(null);
    try {
      await assetsApi.uploadDocument(
        token,
        asset.id,
        documentType,
        documentFile,
      );
      setDocumentFile(null);
      await load();
      setNotice("A dokumentum feltöltve.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A dokumentum nem tölthető fel.",
      );
    } finally {
      setBusy(false);
    }
  };

  const downloadDocument = async (documentId: string, fileName: string) => {
    if (!asset) return;
    try {
      const blob = await assetsApi.downloadDocument(
        token,
        asset.id,
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
        cause instanceof Error
          ? cause.message
          : "A dokumentum nem tölthető le.",
      );
    }
  };

  const deleteDocument = async (documentId: string) => {
    if (!asset || busy) return;
    setPending(null);
    setBusy(true);
    try {
      await assetsApi.deleteDocument(token, asset.id, documentId);
      await load();
      setNotice("A dokumentum törölve.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A dokumentum nem törölhető.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az eszközadathoz"
        description="service.view jogosultság szükséges."
      />
    );
  if (loading && !asset)
    return (
      <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50 p-8">
        <Skeleton className="h-72" />
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50">
      {deleted ? (
        <div className="p-8">
          <PilotCard>
            <div className="p-6 text-sm text-pilot-grey-700">
              Az eszköz törölve. Visszatérés az{" "}
              <Link
                className="text-pilot-aqua-600 underline"
                href="/szerviz/eszkozok"
              >
                eszközlistához
              </Link>
              .
            </div>
          </PilotCard>
        </div>
      ) : asset ? (
        <>
          <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
            <Link
              href={backToList.href}
              className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400 transition-colors hover:text-pilot-grey-700"
            >
              <Icon name="chevron-left" size={12} />
              {backToList.fromWithinApp ? "Vissza" : "Eszköznyilvántartás"}
            </Link>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div>
                  <div className="mb-1.5 flex items-center gap-2.5">
                    <h1 className="text-xl font-semibold text-pilot-grey-900">
                      {asset.name}
                    </h1>
                    <PilotBadge variant={assetStatusPilotVariant(asset.status)}>
                      {assetStatusLabel[asset.status]}
                    </PilotBadge>
                  </div>
                  <p className="text-sm text-pilot-grey-500">
                    {asset.owner.displayName}
                    {asset.unit ? ` · ${asset.unit.path.join(" / ")}` : ""}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-pilot-grey-400">
                    {asset.assetNumber}
                  </p>
                </div>
              </div>
              {canManage ? (
                <Link href={`/szerviz/eszkozok/${asset.id}/szerkesztes`}>
                  <PilotButton variant="primary">
                    <Icon name="pencil" size={12} />
                    Eszköz módosítása
                  </PilotButton>
                </Link>
              ) : null}
            </div>
          </div>

          {error ? (
            <div className="px-8 pt-4">
              <Alert
                variant="danger"
                title="A művelet nem sikerült"
                description={error}
              />
            </div>
          ) : null}
          {notice ? (
            <div className="px-8 pt-4">
              <Alert variant="info" title="Mentve" description={notice} />
            </div>
          ) : null}

          <div className="grid items-start gap-6 px-8 py-6 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-5">
              <PilotCard>
                <PilotCardHeader title="Azonosítás" />
                <div className="grid grid-cols-2 gap-x-8 gap-y-4 p-5">
                  <Field label="Partnerkód" value={asset.owner.code} />
                  <Field
                    label="Partner belső kódja"
                    value={asset.partnerInternalCode}
                  />
                  <Field label="Sorozatszám" value={asset.serialNumber} />
                  <Field label="Matricakód" value={asset.labelCode} />
                </div>
              </PilotCard>

              <PilotCard>
                <PilotCardHeader title="Technikai adatok" />
                <div className="grid grid-cols-2 gap-x-8 gap-y-4 p-5">
                  <Field label="Kategória" value={asset.category} />
                  <Field label="Funkció" value={asset.function} />
                  <Field label="Gyártó" value={asset.manufacturer} />
                  <Field label="Modell" value={asset.model} />
                  <Field
                    label="Teljesítmény"
                    value={performanceText(
                      asset.performance,
                      asset.performanceUnit?.code,
                    )}
                  />
                  <Field
                    label="Fogyasztás"
                    value={performanceText(asset.powerConsumption, "kW")}
                  />
                  <Field
                    label="Térfogat"
                    value={performanceText(asset.volume, "m³")}
                  />
                  <Field label="FP / Elektromos" value={asset.electricalCode} />
                  {/*
                    A FIGMA-TERV NEM KÉR "TERMÉKTÖRZS" ÉS "FOGYASZTÁS (EREDETI)"
                    MEZŐT, DE EZEK VALÓS ADATOK -- lásd a mai adatlap
                    (asset-detail-page.tsx) fejlécét: a "P1/P2" alakú eredeti
                    fogyasztás-szöveget csak akkor mutatjuk, ha eltér a
                    kiírt számtól. Nem hagyjuk el csendben.
                  */}
                  <Field label="Terméktörzs" value={asset.product?.name} />
                  {asset.powerConsumptionRaw &&
                  asset.powerConsumptionRaw !== asset.powerConsumption ? (
                    <Field
                      label="Fogyasztás (eredeti)"
                      value={asset.powerConsumptionRaw}
                    />
                  ) : null}
                </div>
                {asset.description ? (
                  <div className="border-t border-pilot-grey-100 px-5 py-4">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-pilot-grey-400">
                      Leírás
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-pilot-grey-700">
                      {asset.description}
                    </p>
                  </div>
                ) : null}
              </PilotCard>

              <PilotCard>
                <PilotCardHeader title="Hozzárendelés" />
                <div className="grid grid-cols-2 gap-x-8 gap-y-4 p-5">
                  <Field label="Tulajdonos" value={asset.owner.displayName} />
                  <Field label="Akvárium" value={asset.aquarium?.name} />
                  {asset.owner.type === "SUPPLIER" ? (
                    <Field
                      label="Alegység"
                      value={
                        asset.unit
                          ? `${asset.unit.path.join(" / ")} (${asset.unit.code})`
                          : asset.address?.formatted
                            ? `Nincs pontosítva. A partner címe látszik helyette: ${asset.address.formatted}`
                            : "Nincs pontosítva."
                      }
                    />
                  ) : (
                    <Field label="Vevő címe" value={asset.address?.formatted} />
                  )}
                </div>
              </PilotCard>

              <PilotCard>
                <PilotCardHeader title="Karbantartás" />
                <div className="grid grid-cols-2 gap-x-8 gap-y-4 p-5">
                  <Field
                    label="Telepítés"
                    value={formatDate(asset.installedAt)}
                  />
                  <Field
                    label="Garancia"
                    value={formatDate(asset.warrantyExpiresAt)}
                  />
                  <Field
                    label="Intervallum (napokban)"
                    value={
                      asset.serviceIntervalDays
                        ? `${asset.serviceIntervalDays} nap`
                        : undefined
                    }
                  />
                  {/*
                    A "KÖVETKEZŐ KARBANTARTÁS" NEM ITT SZERKESZTHETŐ -- lásd a
                    fájl fejlécét: a jobb oldali "Helyszíni állapot" kártya
                    mezője, hogy a szerkesztés ne szakadjon két helyre. Itt
                    csak OLVASHATÓ formában jelenik meg, ha van érték.
                  */}
                  <Field
                    label="Következő karbantartás"
                    value={formatDate(asset.nextServiceAt)}
                  />
                </div>
              </PilotCard>

              {/*
                A DOKUMENTUM-GALÉRIA ÉS A FELTÖLTÉS A RÉGI KINÉZETÉBEN MARAD
                ("varrat") -- lásd a fájl fejlécét: ugyanaz a komponens, amit
                a hibajegy és a munkalap lapja is használ.
              */}
              <PilotCard>
                <PilotCardHeader title="Dokumentumok" />
                <div className="p-5">
                  <p className="mb-4 text-sm text-pilot-grey-500">
                    Számla, garanciajegy és használati utasítás PDF formátumban,
                    legfeljebb 10 MB méretben. A telefonról feltöltött fényképek
                    is itt jelennek meg.
                  </p>
                  <ServiceDocumentGallery
                    items={asset.documents}
                    loadBlob={(documentId) =>
                      assetsApi.downloadDocumentThumbnail(
                        token,
                        asset.id,
                        documentId,
                      )
                    }
                    onDownload={(item) =>
                      void downloadDocument(item.id, item.fileName)
                    }
                    onDelete={
                      canManage
                        ? (item) =>
                            setPending({
                              kind: "delete-document",
                              documentId: item.id,
                              fileName: item.fileName,
                            })
                        : undefined
                    }
                    onSaveCaption={
                      canManage
                        ? async (item, caption) => {
                            await assetsApi.setDocumentCaption(
                              token,
                              asset.id,
                              item.id,
                              caption,
                            );
                            await load();
                          }
                        : undefined
                    }
                    itemLabel={(item) => documentTypeLabel[item.type]}
                    emptyText="Ehhez az eszközhöz még nincs dokumentum feltöltve."
                  />
                  {canManage ? (
                    <div className="mt-5 grid gap-3 border-t border-pilot-grey-100 pt-5 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
                      <FormField label="Dokumentumtípus">
                        <Select
                          aria-label="Dokumentumtípus"
                          value={documentType}
                          onChange={(event) =>
                            setDocumentType(
                              event.target.value as AssetDocumentType,
                            )
                          }
                        >
                          {Object.entries(documentTypeLabel).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </Select>
                      </FormField>
                      <FormField label="Fénykép vagy PDF">
                        <Input
                          type="file"
                          accept="image/jpeg,image/png,application/pdf"
                          aria-label="Fénykép vagy PDF"
                          onChange={(event) =>
                            setDocumentFile(event.target.files?.[0] ?? null)
                          }
                        />
                      </FormField>
                      <Button
                        disabled={!documentFile || busy}
                        onClick={() => void uploadDocument()}
                      >
                        Feltöltés
                      </Button>
                    </div>
                  ) : null}
                </div>
              </PilotCard>

              <PilotCard>
                <PilotCardHeader title="Előzmények" />
                <div className="flex flex-col gap-0 p-5">
                  {asset.events.map((event, index) => (
                    <div
                      key={event.id}
                      className="relative flex gap-3 pb-4 last:pb-0"
                    >
                      <div className="flex flex-col items-center">
                        <div
                          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                            event.type === "CREATED"
                              ? "bg-pilot-aqua-500"
                              : "bg-pilot-grey-300"
                          }`}
                        />
                        {index < asset.events.length - 1 ? (
                          <div className="mt-1 w-px flex-1 bg-pilot-grey-100" />
                        ) : null}
                      </div>
                      <div className="min-h-0 pb-0">
                        <p className="text-xs text-pilot-grey-700">
                          {assetEventLabel[event.type]}
                        </p>
                        <p className="mt-0.5 text-[10px] text-pilot-grey-400">
                          {formatDateTime(event.occurredAt)}
                          {event.actor ? ` · ${event.actor.displayName}` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </PilotCard>

              {/*
                A KIVEZETÉS/TÖRLÉS A RÉGI GOMB- ÉS MEGERŐSÍTŐ-LOGIKÁVAL MARAD
                ("varrat") -- lásd a mai adatlap fejlécét: a törlés
                szándékosan NEM egyenrangú a kivezetéssel, egy lépéssel
                bentebb áll.
              */}
              {canManage ? (
                <PilotCard>
                  <div className="border-b border-pilot-grey-100 px-5 py-4">
                    <h3 className="text-sm font-semibold text-red-700">
                      Eszköz kivezetése
                    </h3>
                  </div>
                  <div className="p-5">
                    <p className="mb-3 text-xs text-pilot-grey-500">
                      A kivezetett eszköz megmarad a nyilvántartásban a teljes
                      történetével együtt, csak az aktív listákból kerül ki.
                    </p>
                    <PilotButton
                      variant="secondary"
                      disabled={busy || asset.status === "RETIRED"}
                      onClick={() => setPending({ kind: "retire" })}
                    >
                      {asset.status === "RETIRED"
                        ? "Már kivezetett"
                        : "Eszköz kivezetése"}
                    </PilotButton>
                    {asset.status === "RETIRED" && canDelete ? (
                      <p className="mt-3 text-sm">
                        <button
                          type="button"
                          className="cursor-pointer text-pilot-grey-500 underline"
                          onClick={() => setPending({ kind: "delete-asset" })}
                        >
                          Végleges törlés
                        </button>
                      </p>
                    ) : null}
                  </div>
                </PilotCard>
              ) : null}
            </div>

            <div className="flex flex-col gap-5">
              <PilotCard>
                <PilotCardHeader title="QR-azonosító" />
                <div className="flex flex-col items-center gap-3 p-5">
                  {qr ? (
                    <>
                      <div
                        className="flex h-28 w-28 items-center justify-center rounded-lg bg-pilot-grey-50 p-2 ring-1 ring-pilot-grey-200"
                        aria-label={`${asset.assetNumber} QR-kódja`}
                        dangerouslySetInnerHTML={{ __html: qr.svg }}
                      />
                      <p className="text-center font-mono text-[10px] text-pilot-grey-400">
                        {asset.labelCode ?? asset.assetNumber}
                      </p>
                      <PilotButton variant="secondary" onClick={downloadQr}>
                        <Icon name="download" size={12} />
                        QR letöltése (SVG)
                      </PilotButton>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => setPending({ kind: "rotate-qr" })}
                          disabled={busy}
                          className="cursor-pointer text-xs font-medium text-pilot-grey-400 transition-colors hover:text-pilot-grey-700 disabled:cursor-not-allowed"
                        >
                          QR-kód lecserélése
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </PilotCard>

              {canManage ? (
                <PilotCard>
                  <PilotCardHeader title="Helyszíni állapot" />
                  <div className="flex flex-col gap-4 p-5">
                    <PilotFormField label="Eszköz státusza">
                      <PilotSelect
                        value={status}
                        onChange={(value) => setStatus(value as AssetStatus)}
                      >
                        {Object.entries(assetStatusLabel).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </PilotSelect>
                    </PilotFormField>
                    <PilotFormField label="Következő karbantartás">
                      <PilotInput
                        type="date"
                        value={nextServiceAt}
                        onChange={setNextServiceAt}
                      />
                    </PilotFormField>
                    <PilotFormField label="Belső megjegyzés (csak nekünk látható)">
                      <textarea
                        rows={3}
                        aria-label="Belső megjegyzés"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Megjegyzés…"
                        className="w-full resize-none rounded-md px-3 py-2 text-sm text-pilot-grey-800 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                      />
                    </PilotFormField>
                    <PilotButton
                      variant="primary"
                      disabled={busy}
                      onClick={() => void save()}
                    >
                      {busy ? "Mentés…" : "Állapot mentése"}
                    </PilotButton>
                  </div>
                </PilotCard>
              ) : null}

              {asset.ancestors.length > 0 || asset.children.length > 0 ? (
                <PilotCard>
                  <PilotCardHeader title="Eszközhierarchia" />
                  <div className="flex flex-col gap-4 p-5">
                    {asset.ancestors.length > 0 ? (
                      <div>
                        <p className="mb-1.5 text-[11px] text-pilot-grey-400">
                          Főegységek
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {asset.ancestors.map((ancestor) => (
                            <Link
                              key={ancestor.id}
                              href={`/szerviz/eszkozok/${ancestor.id}`}
                              className="flex items-center gap-2 text-sm text-pilot-aqua-600 transition-colors hover:text-pilot-aqua-800"
                            >
                              <Icon name="box" size={12} />
                              {ancestor.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {asset.children.length > 0 ? (
                      <div>
                        <p className="mb-1.5 text-[11px] text-pilot-grey-400">
                          Beépített részegységek
                        </p>
                        <div className="flex flex-col gap-2">
                          {asset.children.map((child) => (
                            <Link
                              key={child.id}
                              href={`/szerviz/eszkozok/${child.id}`}
                              className="flex items-center gap-2 text-sm text-pilot-aqua-600 transition-colors hover:text-pilot-aqua-800"
                            >
                              <Icon name="box" size={12} />
                              <div>
                                <p>{child.name}</p>
                                <p className="font-mono text-[10px] text-pilot-grey-400">
                                  {child.assetNumber}
                                </p>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </PilotCard>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={pending?.kind === "rotate-qr"}
        title="Lecseréled az eszköz QR-kódját?"
        consequence="A korábbi matricán lévő kód azonnal érvénytelen lesz: a régi matricát beolvasva az alkalmazás nem találja meg az eszközt."
        recovery="A régi kód nem állítható vissza. Az új kódot ki kell nyomtatni, és a régi matricát le kell cserélni az eszközön."
        confirmLabel="QR-kód cseréje"
        busy={busy}
        onConfirm={() => void rotateQr()}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === "retire"}
        title="Kivezeted ezt az eszközt?"
        consequence="Az eszköz kikerül az aktív listákból, és új munkához nem lesz felajánlva. Az adatlapja, az eseménynaplója és a dokumentumai megmaradnak."
        recovery="Visszavonható: az állapot bármikor visszaállítható aktívra ezen az adatlapon, az állapot mezőben."
        confirmLabel="Kivezetés"
        busy={busy}
        onConfirm={() => void retire()}
        onCancel={() => setPending(null)}
      >
        {canDelete ? (
          <button
            type="button"
            className="text-sm underline"
            onClick={() => setPending({ kind: "delete-asset" })}
          >
            Ez az eszköz téves felvitel? Végleges törlés.
          </button>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={pending?.kind === "delete-asset"}
        title="Véglegesen törlöd ezt az eszközt?"
        consequence="Az eszköz, az eseménynaplója és a hozzá feltöltött dokumentumok megszűnnek."
        recovery="Nem vonható vissza. Ha az eszköz létezett és dolgoztak rajta, a kivezetés a helyes lépés."
        confirmLabel="Végleges törlés"
        busy={busy}
        onConfirm={() => void removeAsset()}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === "delete-document"}
        title={
          pending?.kind === "delete-document"
            ? `Törlöd ezt a dokumentumot: ${pending.fileName}?`
            : "Törlöd ezt a dokumentumot?"
        }
        consequence="A fájl lekerül az eszköz adatlapjáról, és a tárolóból is törlődik."
        recovery="Nem vonható vissza: ha újra kell, fel kell tölteni egy másolatot."
        confirmLabel="Végleges törlés"
        busy={busy}
        onConfirm={() => {
          if (pending?.kind === "delete-document")
            void deleteDocument(pending.documentId);
        }}
        onCancel={() => setPending(null)}
      />
    </PilotThemeRoot>
  );
}
