"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
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
import { assetsApi } from "@/lib/api/assets";
import {
  assetCriticalityLabel,
  assetEventLabel,
  assetKindLabel,
  assetStatusLabel,
} from "./asset-labels";

/**
 * A KÉT MEGERŐSÍTENDŐ MŰVELET ezen az oldalon. Az `id` a dokumentumé; a
 * QR-cserénél nincs mit azonosítani, mert az az eszköz egyetlen matricája.
 */
type PendingConfirm =
  | { kind: "rotate-qr" }
  | { kind: "retire" }
  | { kind: "delete-asset" }
  | { kind: "delete-document"; documentId: string; fileName: string };

const inputDate = (value?: string) => (value ? value.slice(0, 10) : "");
const isoDate = (value: string) => (value ? `${value}T00:00:00.000Z` : null);

function statusVariant(status: AssetStatus) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "RETIRED") return "neutral" as const;
  return "warning" as const;
}

const documentTypeLabel: Record<AssetDocumentType, string> = {
  INVOICE: "Számla",
  WARRANTY: "Garanciajegy",
  MANUAL: "Használati utasítás",
  OTHER: "Egyéb",
};

export function AssetDetailPage({ assetId }: { assetId: string }) {
  const backToList = useReturnTo("/szerviz/eszkozok");
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  /**
   * AKINEK NINCS TORLESI JOGA, ANNAK A HIVATKOZAS SEM JELENIK MEG -- nem
   * letiltva, hanem sehogy. Egy letiltott gomb azt mondja, hogy "ezt lehetne,
   * csak neked nem", es olyan kerdest szul, amire a felulet nem tud valaszolni.
   */
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

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az eszközadathoz"
        description="service.view jogosultság szükséges."
      />
    );

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

  /**
   * KIVEZETES: a statuszt allitja `RETIRED`-re, semmi mast. A sor megmarad, a
   * tortenete is -- ezert ez a FO UT, es ezert allithato vissza.
   */
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

  /**
   * VEGLEGES TORLES. A szerver hibauzenetet SZO SZERINT adjuk tovabb: az
   * megnevezi, MI tartja vissza (hany hibajegy, munkalapsor, alarendelt
   * eszkoz). Egy "az eszkoz nem torolheto" mondat ugyanannyit mondana, mint a
   * semmi -- a felhasznalo nem tudna, hol nezzen utana.
   */
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
      setNotice("A PDF dokumentum feltöltve.");
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

  return (
    <div className="space-y-6">
      {/*
        A FEJLEC IS A TOROLT ESZKOZ NEVET VISELTE, es ez a panasz MASODIK fele
        volt. A kartya egyetlen helyet nevezett meg (az adatlap-blokkot), a
        meres kettot talalt: a nev egy `h1`-ben all a fejlecben, a leltari szam
        alatta. Aki a torles utan a kepernyore nez, ugyanugy a torolt eszkozt
        latja, akkor is, ha az adatlap mar eltunt alola.

        A modositas gombja is elmarad: egy torolt eszkozt nincs mit szerkeszteni,
        es a link egy mar nem letezo rekordra vinne.
      */}
      <PageHeader
        eyebrow="Szerviz / Eszköznyilvántartás"
        title={deleted ? "Eszköz törölve" : (asset?.name ?? "Eszköz adatlap")}
        description={deleted ? undefined : asset?.assetNumber}
        actions={
          <div className="flex gap-2">
            {canManage && asset && !deleted ? (
              <Link href={`/szerviz/eszkozok/${asset.id}/szerkesztes`}>
                <Button>Eszköz módosítása</Button>
              </Link>
            ) : null}
            <Link href={backToList.href}>
              <Button variant="secondary">
                {backToList.fromWithinApp ? "Vissza" : "Vissza a listához"}
              </Button>
            </Link>
          </div>
        }
      />
      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
          action={
            !asset ? (
              <Button variant="secondary" onClick={() => void load()}>
                Újrapróbálás
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {notice ? (
        <Alert variant="info" title="Mentve" description={notice} />
      ) : null}
      {loading && !asset ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      ) : null}
      {/*
        A `!deleted` NEM DISZITES: nelkule a torles utan KET EGYMASNAK
        ELLENTMONDO dolog all egy kepernyon -- a kartya azt mondja, hogy az
        eszkoz torolve, es kozvetlenul folotte ott az adatlapja. Balazs eles
        hasznalatbol jelezte (2026-09-02): "ha letorlom, akkor nem a listahoz
        ugrik vissza hanem a torolt eszkoz adatai maradnak a kepernyon".

        A `deleted` allapot MAR LETEZETT es a visszateres-kartya mar mukodott;
        csak ez a feltetel nem tudott rola. Egy fel-bekotott allapot rosszabb,
        mint a hianyzo: a kepernyo egyik fele igazat mond, a masik nem.
      */}
      {asset && !deleted ? (
        <>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <div className="space-y-6">
              <Card className="p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(asset.status)}>
                    {assetStatusLabel[asset.status]}
                  </Badge>
                  <Badge variant="info">{assetKindLabel[asset.kind]}</Badge>
                  <Badge>{assetCriticalityLabel[asset.criticality]}</Badge>
                </div>
                <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  <Data label="Tulajdonos" value={asset.owner.displayName} />
                  <Data label="Partnerkód" value={asset.owner.code} />
                  {/* AZ ALEGYSEG A VALASZTOTT HELY, A CIM A VISSZAESES.
                      Partner-tulajdonosnal a cim MINDIG a partner sajat postai
                      cime (vevoi cim oda nem rendelheto), tehat ha nincs
                      alegyseg, ez nem valasztas eredmenye. A jeloles ezert
                      mondja ki: kulonben egy nem pontositott eszkoz pontosan
                      ugy nez ki, mint egy pontositott. */}
                  {asset.owner.type === "SUPPLIER" ? (
                    <Data
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
                    <Data label="Vevő címe" value={asset.address?.formatted} />
                  )}
                  <Data label="Akvárium" value={asset.aquarium?.name} />
                  <Data label="Gyártó" value={asset.manufacturer} />
                  <Data label="Modell" value={asset.model} />
                  <Data label="Sorozatszám" value={asset.serialNumber} />
                  <Data label="Leltári szám" value={asset.inventoryNumber} />
                  <Data label="Terméktörzs" value={asset.product?.name} />
                  <Data
                    label="Telepítés"
                    value={formatDate(asset.installedAt)}
                  />
                  <Data
                    label="Garancia"
                    value={formatDate(asset.warrantyExpiresAt)}
                  />
                  <Data
                    label="Intervallum"
                    value={
                      asset.serviceIntervalDays
                        ? `${asset.serviceIntervalDays} nap`
                        : undefined
                    }
                  />
                </dl>
                {asset.description ? (
                  <div className="mt-6 border-t pt-5">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      Leírás
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {asset.description}
                    </p>
                  </div>
                ) : null}
              </Card>

              {(asset.ancestors.length > 0 || asset.children.length > 0) && (
                <Card className="p-6">
                  <h2 className="font-semibold text-slate-950">
                    Eszközhierarchia
                  </h2>
                  {asset.ancestors.length > 0 ? (
                    <div className="mt-4">
                      <p className="text-xs font-bold uppercase text-slate-400">
                        Főegységek
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        {asset.ancestors.map((ancestor) => (
                          <Link
                            key={ancestor.id}
                            href={`/szerviz/eszkozok/${ancestor.id}`}
                            className="rounded-md bg-slate-100 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-800"
                          >
                            {ancestor.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {asset.children.length > 0 ? (
                    <div className="mt-5">
                      <p className="text-xs font-bold uppercase text-slate-400">
                        Részegységek
                      </p>
                      <div className="mt-2 divide-y rounded-lg border">
                        {asset.children.map((child) => (
                          <Link
                            key={child.id}
                            href={`/szerviz/eszkozok/${child.id}`}
                            className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50"
                          >
                            <span className="font-medium">{child.name}</span>
                            <span className="font-mono text-xs text-slate-500">
                              {child.assetNumber}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </Card>
              )}

              <Card className="p-6">
                <h2 className="font-semibold text-slate-950">Dokumentumok</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Számla, garanciajegy és használati utasítás PDF formátumban,
                  legfeljebb 10 MB méretben.
                </p>
                {asset.documents.length > 0 ? (
                  <div className="mt-4 divide-y rounded-lg border">
                    {asset.documents.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {documentTypeLabel[item.type]} · {item.fileName}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {formatFileSize(item.sizeBytes)} ·{" "}
                            {formatDateTime(item.createdAt)}
                            {item.uploadedBy
                              ? ` · ${item.uploadedBy.displayName}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              void downloadDocument(item.id, item.fileName)
                            }
                          >
                            Letöltés
                          </Button>
                          {canManage ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                setPending({
                                  kind: "delete-document",
                                  documentId: item.id,
                                  fileName: item.fileName,
                                })
                              }
                            >
                              Törlés
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    Ehhez az eszközhöz még nincs dokumentum feltöltve.
                  </p>
                )}
                {canManage ? (
                  <div className="mt-5 grid gap-3 border-t pt-5 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
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
                    <FormField label="PDF fájl">
                      <Input
                        type="file"
                        accept="application/pdf,.pdf"
                        aria-label="PDF fájl"
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
              </Card>

              <Card className="p-6">
                <h2 className="font-semibold text-slate-950">Előzmények</h2>
                <div className="mt-4 divide-y">
                  {asset.events.map((event) => (
                    <div key={event.id} className="flex gap-4 py-3 first:pt-0">
                      <span className="mt-1 size-2 shrink-0 rounded-full bg-teal-600" />
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {assetEventLabel[event.type]}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatDateTime(event.occurredAt)}
                          {event.actor ? ` · ${event.actor.displayName}` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="p-6">
                <h2 className="font-semibold text-slate-950">QR-azonosító</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  A matrica leolvasása az Acropora OS mobilalkalmazásban nyitja
                  meg ezt az eszközt.
                </p>
                {qr ? (
                  <div className="mt-5">
                    <div
                      className="mx-auto aspect-square max-w-[260px] overflow-hidden rounded-xl border bg-white p-3"
                      aria-label={`${asset.assetNumber} QR-kódja`}
                      dangerouslySetInnerHTML={{ __html: qr.svg }}
                    />
                    <div className="mt-4 grid gap-2">
                      <Button onClick={downloadQr}>QR letöltése (SVG)</Button>
                      {canManage ? (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => setPending({ kind: "rotate-qr" })}
                        >
                          QR-kód lecserélése
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </Card>

              {canManage ? (
                <Card className="p-6">
                  <h2 className="font-semibold text-slate-950">
                    Helyszíni állapot
                  </h2>
                  <div className="mt-4 space-y-4">
                    <FormField label="Státusz">
                      <Select
                        aria-label="Eszköz státusza"
                        value={status}
                        onChange={(event) =>
                          setStatus(event.target.value as AssetStatus)
                        }
                      >
                        {Object.entries(assetStatusLabel).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </Select>
                    </FormField>
                    <FormField label="Következő karbantartás">
                      <Input
                        type="date"
                        aria-label="Következő karbantartás"
                        value={nextServiceAt}
                        onChange={(event) =>
                          setNextServiceAt(event.target.value)
                        }
                      />
                    </FormField>
                    <FormField label="Belső megjegyzés">
                      <Textarea
                        rows={5}
                        aria-label="Belső megjegyzés"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                      />
                    </FormField>
                    <Button disabled={busy} onClick={() => void save()}>
                      {busy ? "Mentés…" : "Állapot mentése"}
                    </Button>
                  </div>
                </Card>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {deleted ? (
        <Card className="p-4">
          <p className="text-sm">
            Az eszköz törölve. Visszatérés az{" "}
            <a className="underline" href="/szerviz/eszkozok">
              eszközlistához
            </a>
            .
          </p>
        </Card>
      ) : null}
      {canManage && asset && !deleted ? (
        <Card className="p-4">
          {/*
            EGY GOMB, ES AZ A KIVEZETES. Aki egy eszkozt "el akar tuntetni", az
            az esetek nagy reszeben KIVEZETNI akar -- a torles a ritkabb es a
            visszafordithatatlan. Ket egymas melletti gomb VALASZTASSA tenne,
            ami nem az: a ketto nem egyenrangu, es a felulet ne allitsa, hogy az.
            A torles ezert egy lepessel bentebb all, a megerosito ablakban.
          */}
          <h2 className="text-base font-medium">Eszköz kivezetése</h2>
          <p className="mt-1 text-sm">
            A kivezetett eszköz megmarad a nyilvántartásban a teljes
            történetével együtt, csak az aktív listákból kerül ki.
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            disabled={busy || asset.status === "RETIRED"}
            onClick={() => setPending({ kind: "retire" })}
          >
            {asset.status === "RETIRED"
              ? "Már kivezetett"
              : "Eszköz kivezetése"}
          </Button>
          {/*
            A MAR KIVEZETETT ESZKOZ ZSAKUTCA VOLT, ES EZ A FENTI DONTES NEM
            SZANDEKOLT MELLEKHATASA. A torles egyetlen bejarata a KIVEZETES
            megerosito ablaka; ha az eszkoz mar kivezetett, a gomb tiltott, az
            ablak nem nyilik meg, es vele a torles sem. A szerver eközben
            MEGENGEDNE: a harom akadalya (hibajegy, munkalapsor, alarendelt
            eszkoz) kozott a RETIRED allapot nincs ott.

            Balazs dontese (2026-09-02 12:43): "igen legyen kozvetlenul elerheto
            a torles".

            CSAK A KIVEZETETT ESETBEN, es hivatkozaskent, nem gombkent. Aktiv
            eszkoznel a kivezetes marad a fo ut, es a ketto tovabbra sem
            egyenrangu -- ugyanaz a megerosito ablak nyilik, ugyanazokkal a
            szerver oldali akadalyokkal.
          */}
          {asset.status === "RETIRED" && canDelete ? (
            <p className="mt-3 text-sm">
              <button
                type="button"
                className="underline"
                onClick={() => setPending({ kind: "delete-asset" })}
              >
                Végleges törlés
              </button>
            </p>
          ) : null}
        </Card>
      ) : null}

      {/*
        A KÉT MEGERŐSÍTÉS. Mindkettő megnevezi, MI VÉSZ EL és HONNAN szerezhető
        vissza. A dokumentum törlésének szövege eddig annyi volt, hogy „biztosan
        törlöd ezt a dokumentumot?" -- pedig ez a művelet visszafordíthatatlan,
        és a fájl a szerverről is eltűnik.
      */}
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
      {/*
        A VISSZAFORDITHATOSAG ITT NEM DISZITES, HANEM A DONTES ERTELME.
        Balazs azert tette a kivezetest fo utta, mert MEGORZI az adatot. Ha a
        felhasznalo veglegesnek hiszi, akkor epp a TORLES fele mozdul -- vagyis
        egy kimondatlan visszafordithatosag PONT AZ ELLENKEZOJET eri el annak,
        amit a dontes akart. Ezert all a `recovery` szovegben, hogy visszavonhato
        ES hogy HOL.
      */}
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
    </div>
  );
}

function Data({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-slate-800">
        {value ?? "—"}
      </dd>
    </div>
  );
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

function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} kB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
