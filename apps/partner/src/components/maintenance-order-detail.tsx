"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Icon,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataRow,
  PilotThemeRoot,
  pilotBadgeVariantForTone,
} from "@acropora/ui";
import {
  maintenanceOrderStatusLabel,
  maintenanceOrderStatusTone,
  type MaintenanceOrderPartnerDetail,
} from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { Message } from "./ticket-list";

/**
 * A MEGRENDELÉS ADATLAPJA.
 *
 * === A "TÉTELEK" TÁBLÁZAT ÁR NÉLKÜL ===
 *
 * Ugyanaz a szabály, mint a szerviz belső felületén és a munkalap portál-
 * adatlapján: a szervizes jogköre itt sem lát árat. A szerver válasza
 * (`MaintenanceOrderPartnerItem`) STRUKTURÁLISAN nem is hordoz ár-mezőt --
 * lásd a típus fejlécét.
 *
 * === A LETÖLTÉS A VALÓDI TÁROLT FÁJLTÍPUST KÖVETI ===
 *
 * A generált megrendelőlap MA `.docx` (a mai nap `feat/maintenance-order-
 * form-docx` munkája óta), az aláírt példány mindig PDF. A gomb ezért a
 * szervertől kapott `fileName`/`contentType` mezőket használja, nem
 * feltételezi előre egyik formátumot sem -- a Figma terv `.pdf` fájlnév-
 * feltevése emiatt itt SZÁNDÉKOSAN nem jelenik meg.
 *
 * === A FELTÖLTŐ KÁRTYA KÉT FELTÉTELHEZ KÖTŐDIK ===
 *
 * Csak `status === "ISSUED"` ÉS `canUploadSigned` esetén jelenik meg --
 * az első a Figma terv szabálya (csak kiállított lapra tölthető fel aláírt
 * példány), a második a `MAINTENANCE_ORDER_UPLOAD_SIGNED` felhasználónkénti
 * képesség, amit a szerver dönt el. Ha a lap kiállítva áll, de a hívónál
 * nincs bejelölve a képesség, a kártya NEM jelenik meg -- ugyanaz a döntés,
 * mint az eszköz-akvárium hozzárendelésnél (`aquarium-detail.tsx`): a
 * hiány nem hibaüzenet, egyszerűen nincs mit felajánlani.
 */
export function MaintenanceOrderDetail({ id }: { id: string }) {
  const [order, setOrder] = useState<MaintenanceOrderPartnerDetail | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrder(await partnerApi.maintenanceOrder(id));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A megrendelés nem tölthető be.",
      );
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function download(documentId: string, fileName: string) {
    const blob = await partnerApi.maintenanceOrderDocumentBlob(id, documentId);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await partnerApi.uploadSignedMaintenanceOrder(id, file);
      setFile(null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A fájl nem tölthető fel.",
      );
    } finally {
      setUploading(false);
    }
  }

  if (error && !order)
    return (
      <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </PilotThemeRoot>
    );
  if (!order)
    return (
      <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
        <p className="text-sm text-pilot-grey-400">Megrendelés betöltése…</p>
      </PilotThemeRoot>
    );

  const generated = order.documents.find(
    (doc) => doc.type === "GENERATED_FORM",
  );
  const showUpload = order.status === "ISSUED" && order.canUploadSigned;

  return (
    <PilotThemeRoot className="bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <VisszaLink />
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          {order.number}
        </p>
        <div className="flex items-start gap-3">
          <h1 className="flex-1 text-xl font-semibold text-pilot-grey-900">
            Megrendelés – {order.period}
          </h1>
          <PilotBadge
            variant={pilotBadgeVariantForTone(
              maintenanceOrderStatusTone[order.status],
            )}
          >
            {maintenanceOrderStatusLabel[order.status]}
          </PilotBadge>
        </div>
        {error ? (
          <p
            className="mt-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-5 px-8 py-6 max-w-2xl">
        <PilotCard>
          <PilotCardHeader title="Megrendelés adatai" />
          <div className="px-5 py-2">
            <PilotDataRow label="Megrendelés száma" value={order.number} />
            <PilotDataRow label="Szerződés" value={order.contractNumber} />
            <PilotDataRow
              label="Helyszín"
              value={order.departmentName ?? undefined}
            />
            <PilotDataRow label="Időszak" value={order.period} />
            <PilotDataRow
              label="Állapot"
              value={maintenanceOrderStatusLabel[order.status]}
            />
          </div>
        </PilotCard>

        <PilotCard>
          <PilotCardHeader title="Tételek" />
          {order.items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-pilot-grey-100">
                    {["#", "Megnevezés", "Mennyiség", "Egység"].map((head) => (
                      <th
                        key={head}
                        className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-400"
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} className="border-b border-pilot-grey-50">
                      <td className="px-5 py-3 font-mono text-xs text-pilot-grey-400">
                        {item.position}
                      </td>
                      <td className="px-5 py-3 text-pilot-grey-700">
                        {item.description}
                      </td>
                      <td className="px-5 py-3 font-mono text-pilot-grey-600">
                        {item.quantity}
                      </td>
                      <td className="px-5 py-3 text-pilot-grey-600">
                        {item.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-4 text-sm italic text-pilot-grey-500">
              A megrendelésen nincs tétel.
            </p>
          )}
        </PilotCard>

        <PilotCard>
          <PilotCardHeader title="Megrendelőlap" />
          <div className="flex items-center gap-3 px-5 py-4">
            {generated ? (
              <>
                <div className="flex flex-1 items-center gap-3 rounded-lg bg-pilot-grey-50 px-4 py-3 ring-1 ring-pilot-grey-200">
                  <Icon
                    name="clipboard"
                    size={16}
                    className="text-pilot-grey-400"
                  />
                  <span className="truncate font-mono text-sm text-pilot-grey-600">
                    {generated.fileName}
                  </span>
                </div>
                <PilotButton
                  variant="secondary"
                  onClick={() => download(generated.id, generated.fileName)}
                >
                  <Icon name="download" size={13} />
                  Letöltés
                </PilotButton>
              </>
            ) : (
              <p className="text-sm italic text-pilot-grey-500">
                Nincs generált megrendelőlap.
              </p>
            )}
          </div>
        </PilotCard>

        {showUpload ? (
          <PilotCard>
            <PilotCardHeader title="Aláírt megrendelőlap feltöltése" />
            <form className="flex flex-col gap-3 px-5 py-4" onSubmit={submit}>
              <label className="flex flex-col gap-1 text-sm font-medium text-pilot-grey-700">
                Aláírt megrendelőlap (PDF)
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="cursor-pointer text-sm text-pilot-grey-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-pilot-aqua-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-pilot-aqua-700"
                />
              </label>
              <div>
                <PilotButton type="submit" disabled={!file || uploading}>
                  {uploading ? "Feltöltés…" : "Feltöltés"}
                </PilotButton>
              </div>
            </form>
          </PilotCard>
        ) : null}
      </div>
    </PilotThemeRoot>
  );
}

function VisszaLink() {
  return (
    <Link
      href="/megrendelesek"
      className="mb-3 inline-flex items-center gap-1.5 text-xs text-pilot-grey-400 hover:text-pilot-grey-700"
    >
      <Icon name="chevron-left" size={12} />
      Megrendelések
    </Link>
  );
}
