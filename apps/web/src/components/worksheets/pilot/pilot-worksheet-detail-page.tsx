"use client";

import { Alert, Icon, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetDetail,
  type WorksheetSignatureDecision,
  type WorksheetSignerListResponse,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { ContextConversationButton } from "@/components/messages/context-conversation-button";
import { worksheetsApi } from "@/lib/api/worksheets";
import { WorksheetEntries } from "../worksheet-entries";
import { WorksheetMaterialRequests } from "../worksheet-material-requests";
import { WorksheetAssetEditor } from "../worksheet-asset-editor";
import { WorksheetAssigneeEditor } from "../worksheet-assignee-editor";
import { WorksheetDocuments } from "../worksheet-documents";
import {
  formatDate,
  formatDateTime,
  formatLaborHours,
  worksheetDisplayLabel,
  worksheetDisplayPilotVariant,
  worksheetStatusLabel,
  worksheetStatusPilotVariant,
} from "../worksheet-labels";
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataRow,
  PilotFormField,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- MUNKALAP ADATLAP (8. kör, 2/3 rész).
 *
 * Brief: `exchange/figma-leiras-8-kor-munkalapok-2026-09-25.md`, forrás:
 * `exchange/figma-munkalapok-make-8/src/MunkalapokScreen.tsx`
 * (`MunkalapDetail`, 506-867. sor).
 *
 * === A SZABÁLY, UGYANAZ MINT AZ 1/3-BAN: A ZIP AD ELRENDEZÉST ÉS
 *     KINÉZETET, A MEZŐK/FELTÉTELEK/FEJLÉC-AKCIÓK A MAI KÓDBÓL ===
 *
 * acrobot döntése (2026-09-25 11:43): a bal/jobb oszlopfelosztást a terv
 * adja (mint az Eszközök körnél), a kártyák tartalma és feltételei a mai
 * `worksheet-detail-page.tsx`-ből jönnek.
 *
 * === THE SERVICE REDESIGN (Figma 423:662, Balázs, 2026-10-04) ===
 *
 * The page follows the redesign's two columns, every existing action kept.
 *
 * - LEFT: A munka leírása, Tételek (no price: quantity, how many people,
 *   hours, and the total), the work log (`WorksheetEntries`), the material
 *   requests, the issued sheet with the attachments, and the versions.
 * - RIGHT: Összesítés, Munkalap adatai (now with the assignees' names, as
 *   the design lists them), the assignees' editor, the affected assets,
 *   "Helyszíni lezárás", and the two signature cards.
 * - "HELYSZÍNI LEZÁRÁS" holds the hand-over and the close, which used to sit
 *   in the header. The lines above its buttons are facts, not gates
 *   (decision E7): the close needs a draft and `service.manage`, nothing
 *   else, exactly as the server checks it.
 * - THE ISSUED SHEET AND THE ATTACHMENTS still move together (one
 *   component, see below); the design's place for files is the left column,
 *   so both are there now.
 * - "2 fő dolgozott" is left out (decision E8).
 *
 * === AZ ÖT BEÁGYAZOTT WIDGET KERETE FIGMA-STÍLUST KAPOTT, A BELSEJE NEM
 *     (acrobot 4. pontja) ===
 *
 * `WorksheetEntries`, `WorksheetMaterialRequests`, `WorksheetAssetEditor`,
 * `WorksheetAssigneeEditor`, `WorksheetDocuments` -- mind az öt saját
 * fájljában lett átírva: a korábbi `Card`/`ServicePanel` keret helyett
 * `PilotCard`/`PilotCardHeader`, a belső tartalom (táblák, gombok,
 * feltöltés) VÁLTOZATLAN. Ez ELTÉR az Eszközök/Hibajegyek körök
 * precedensétől (ott a beágyazott alrendszerek TELJES kinézete
 * változatlan maradt) -- ez a kör szándékosan tágabb utasítást kapott.
 * Mivel a régi (nem-pilot) `worksheet-detail-page.tsx` ugyanezeket a
 * fájlokat importálja, az az oldal (útvonal nélkül marad, mint a
 * társai) mostantól szintén Figma-keretes widgeteket mutatna, HA valaha
 * routolnák -- ma nem routolt, tehát ez nem látszik sehol.
 *
 * === EVERY ACTION STAYS, SOME MOVED ===
 *
 * Rejtés/Visszaállítás (`canHide`), Szerkesztés (`canManage && isDraft`) and
 * Folytatás új munkalapon (`canManage && isSigned`) stay in the header; the
 * hand-over (`canManage`) and Kiállítás és lezárás (`canManage && isDraft`)
 * are in "Helyszíni lezárás"; the conditions are unchanged.
 *
 * === A MEGJEGYZÉS MINDIG LÁTHATÓ (Balázs döntése, 2026-09-25 11:09) ===
 *
 * A "Ügyfél döntésének rögzítése" kártyán a Megjegyzés mező NEM
 * feltételes (nem csak "Elutasította"-nál jelenik meg, ahogy a Figma
 * "Indoklás" mezője sugallná) -- a mai web viselkedése marad, ahogy
 * Balázs kimondta.
 */

export function PilotWorksheetDetailPage({
  worksheetId,
}: {
  worksheetId: string;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const backToList = useReturnTo("/szerviz/munkalapok");
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const canHide = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_HIDE),
  );

  const [worksheet, setWorksheet] = useState<WorksheetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState({
    decision: "ACCEPTED" as WorksheetSignatureDecision,
    signerName: "",
    signerUserId: "",
    signatureCode: "",
    note: "",
  });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setWorksheet(await worksheetsApi.detail(token, worksheetId, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A munkalap nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, token, worksheetId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const [sendToUserId, setSendToUserId] = useState("");
  const [signers, setSigners] = useState<WorksheetSignerListResponse | null>(
    null,
  );
  useEffect(() => {
    if (!canView || !worksheetId) return;
    const controller = new AbortController();
    worksheetsApi
      .signers(token, worksheetId, controller.signal)
      .then(setSigners)
      .catch(() => undefined);
    return () => controller.abort();
  }, [canView, token, worksheetId]);

  const run = async (action: () => Promise<WorksheetDetail>) => {
    setBusy(true);
    setError(null);
    try {
      setWorksheet(await action());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a munkalapokhoz"
        description="service.view jogosultság szükséges."
      />
    );

  if (loading && !worksheet)
    return (
      <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50 p-8">
        <Skeleton className="h-72" />
      </PilotThemeRoot>
    );

  if (!worksheet)
    return (
      <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50 p-8">
        <ServiceOfflineNotice state={{ kind: "empty" }} pilot />
        <Alert
          variant="danger"
          title="A munkalap nem tölthető be"
          description={error ?? "Ismeretlen hiba."}
        />
      </PilotThemeRoot>
    );

  const current = worksheet.currentVersion;
  const isDraft = current.status === "DRAFT";
  const isSigned = current.status === "SIGNED";
  const osszMunkaorak = current.laborHours;

  const fieldRow = (label: string, value: ReactNode) => (
    <PilotDataRow label={label} labelWidth="96px" value={value} />
  );

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col gap-6 bg-pilot-grey-50 px-8 py-8">
      {/*
        THE HEADER OF THE SERVICE REDESIGN (Figma 423:662): back, the sheet's
        number, the subject as the title, the display status and where the
        work is. Hiding and continuing stay here; handing over and closing
        moved to the "Helyszíni lezárás" panel, where the design puts them.
      */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={backToList.href}
            className="text-sm text-pilot-aqua-700 transition-colors hover:text-pilot-aqua-800"
          >
            <span aria-hidden="true">← </span>
            {backToList.fromWithinApp ? "Vissza" : "Munkalapok"}
          </Link>
          <p className="mt-4 font-mono text-sm text-pilot-grey-500">
            {current.label ?? "Piszkozat"}
          </p>
          <h1 className="mt-1 break-words text-3xl font-semibold text-pilot-grey-900">
            {current.subject}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <PilotBadge
              variant={worksheetDisplayPilotVariant(
                current.status,
                current.lines.length,
              )}
            >
              {worksheetDisplayLabel(current.status, current.lines.length)}
            </PilotBadge>
            <span className="break-words text-sm text-pilot-grey-500">
              {worksheet.customer.displayName}
              {worksheet.department.path?.length
                ? ` · ${worksheet.department.path.join(" / ")}`
                : ""}
              {current.sentForSignatureAt
                ? ` · kiküldve aláírásra${
                    current.sentForSignatureToName
                      ? `: ${current.sentForSignatureToName}`
                      : ""
                  }`
                : ""}
            </span>
            {worksheet.hidden ? (
              <PilotBadge variant="amber">Rejtett</PilotBadge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ContextConversationButton kind="worksheet" objectId={worksheet.id} />
          {canHide ? (
            <PilotButton
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  worksheetsApi.setHidden(
                    token,
                    worksheet.id,
                    !worksheet.hidden,
                  ),
                )
              }
            >
              {worksheet.hidden ? "Visszaállítás" : "Elrejtés"}
            </PilotButton>
          ) : null}
          {canManage && isDraft ? (
            <Link href={`/szerviz/munkalapok/${worksheet.id}/szerkesztes`}>
              <PilotButton variant="primary">
                <Icon name="pencil" size={12} />
                Szerkesztés
              </PilotButton>
            </Link>
          ) : null}
          {canManage && isSigned ? (
            <PilotButton
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const created = await worksheetsApi.continueFrom(
                    token,
                    worksheet.id,
                  );
                  router.push(`/szerviz/munkalapok/${created.id}/szerkesztes`);
                  return created;
                })
              }
            >
              Folytatás új munkalapon
            </PilotButton>
          ) : null}
        </div>
      </div>

      <ServiceOfflineNotice
        state={worksheet ? { kind: "loaded" } : { kind: "empty" }}
        pilot
      />
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}
      {worksheet.continues ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-pilot-amber-50 px-4 py-3 text-sm ring-1 ring-pilot-amber-100">
          <span className="text-pilot-amber-700">
            Ez a lap egy korábbi munkalap folytatása.
          </span>
          <Link href={`/szerviz/munkalapok/${worksheet.continues.id}`}>
            <PilotButton variant="secondary">Előzmény megnyitása →</PilotButton>
          </Link>
        </div>
      ) : null}
      {worksheet.continuedBy.length ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-pilot-aqua-50 px-4 py-3 text-sm ring-1 ring-pilot-aqua-200">
          <span className="text-pilot-aqua-700">
            Ennek a lapnak van folytatása.
          </span>
          <Link href={`/szerviz/munkalapok/${worksheet.continuedBy[0]!.id}`}>
            <PilotButton variant="secondary">
              Folytatás megnyitása →
            </PilotButton>
          </Link>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_368px]">
        <div className="flex min-w-0 flex-col gap-5">
          <PilotCard>
            <PilotCardHeader title="A munka leírása" />
            <div className="p-5">
              {current.description ? (
                <p className="whitespace-pre-line break-words text-sm leading-relaxed text-pilot-grey-800">
                  {current.description}
                </p>
              ) : (
                <p className="text-sm italic text-pilot-grey-400">
                  A munkához nem írtak leírást.
                </p>
              )}
            </div>
          </PilotCard>

          {/*
            TÉTELEK, ÁR NÉLKÜL. The price stays the office's (Balázs,
            2026-09-17: net, gross and VAT are shown nowhere here); the sheet
            shows what was done, how much, by how many, and the hours.
          */}
          <PilotCard>
            <PilotCardHeader
              title="Tételek"
              action={
                canManage && isDraft ? (
                  <Link
                    href={`/szerviz/munkalapok/${worksheet.id}/szerkesztes`}
                  >
                    <PilotButton variant="primary">
                      <Icon name="pencil" size={12} />
                      Tételek szerkesztése
                    </PilotButton>
                  </Link>
                ) : undefined
              }
            />
            <p className="px-5 pt-3 text-xs text-pilot-grey-500">
              A szerelő a munkát és a mennyiséget rögzíti; az ár az irodáé.
            </p>
            {current.lines.length === 0 ? (
              <p className="px-5 py-6 text-sm italic text-pilot-grey-400">
                Nincs tétel. Tétel nélküli munkalap nem zárható le.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-pilot-grey-100">
                      {[
                        "#",
                        "Megnevezés",
                        "Mennyiség",
                        "Hányan",
                        "Munkaóra",
                      ].map((col) => (
                        <th
                          key={col}
                          className="px-5 py-2.5 text-left text-xs font-medium text-pilot-grey-500"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {current.lines.map((line) => (
                      <tr
                        key={line.id}
                        className="border-b border-pilot-grey-50"
                      >
                        <td className="px-5 py-3 text-xs text-pilot-grey-400">
                          {line.position}
                        </td>
                        <td className="px-5 py-3 text-pilot-grey-900">
                          <div className="break-words font-semibold">
                            {line.description}
                          </div>
                          {line.detail ? (
                            <div className="text-xs text-pilot-grey-500">
                              {line.detail}
                            </div>
                          ) : null}
                          {line.assetNumber ? (
                            <div className="font-mono text-xs text-pilot-grey-500">
                              {line.assetNumber}
                            </div>
                          ) : null}
                          {line.partnerInternalCode ? (
                            <div className="text-xs text-pilot-grey-500">
                              Partner belső kódja:{" "}
                              <span className="font-mono">
                                {line.partnerInternalCode}
                              </span>
                            </div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-pilot-grey-700">
                          {formatLaborHours(line.quantity)} {line.unit}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-pilot-grey-700">
                          {line.kind === "LABOR"
                            ? `${line.workerCount} fő`
                            : "–"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-pilot-grey-700">
                          {line.kind === "LABOR"
                            ? `${formatLaborHours(line.laborHours)} munkaóra`
                            : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-pilot-grey-100 px-5 py-3">
              <span className="text-xs text-pilot-grey-600">
                Összes munkaóra
              </span>
              <span className="text-lg font-semibold text-pilot-grey-900">
                {formatLaborHours(osszMunkaorak)} óra
              </span>
            </div>
          </PilotCard>

          {/* the work log ("Munkanapló" in the design): who wrote what, when */}
          <WorksheetEntries worksheetId={worksheet.id} canWrite={canManage} />

          <WorksheetMaterialRequests
            worksheetId={worksheet.id}
            canWrite={canManage}
          />

          {/*
            A KIADOTT MUNKALAP ÉS A CSATOLMÁNYOK: one component, so they move
            together (see the file header); the redesign puts photos and
            files in the left column, under the material requests.
          */}
          <WorksheetDocuments
            worksheetId={worksheet.id}
            token={token}
            canView={canView}
          />

          <PilotCard>
            <PilotCardHeader title="Verziók" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-pilot-grey-100">
                    {[
                      "Verzió",
                      "Állapot",
                      "Készítette",
                      "Lezárta",
                      "Indoklás",
                      "Aláírás",
                    ].map((col) => (
                      <th
                        key={col}
                        className="px-5 py-2.5 text-left text-xs font-medium text-pilot-grey-400"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {worksheet.versions.map((version) => (
                    <tr
                      key={version.id}
                      className="border-b border-pilot-grey-50"
                    >
                      <td className="px-5 py-2.5 text-pilot-grey-800">
                        {version.label ?? `${version.version}. verzió`}
                      </td>
                      <td className="px-5 py-2.5">
                        <PilotBadge
                          variant={worksheetStatusPilotVariant(version.status)}
                        >
                          {worksheetStatusLabel[version.status]}
                        </PilotBadge>
                      </td>
                      <td className="px-5 py-2.5 text-xs text-pilot-grey-600">
                        {version.createdByName ?? "—"}
                        <div className="text-pilot-grey-400">
                          {formatDateTime(version.createdAt)}
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-xs text-pilot-grey-600">
                        {version.closedByName ?? "—"}
                        <div className="text-pilot-grey-400">
                          {formatDateTime(version.closedAt)}
                        </div>
                      </td>
                      <td className="max-w-[160px] truncate px-5 py-2.5 text-xs text-pilot-grey-500">
                        {version.changeReason ?? "—"}
                      </td>
                      <td className="px-5 py-2.5 text-xs text-pilot-grey-600">
                        {version.signature ? (
                          <>
                            {`${version.signature.signerName} (${
                              version.signature.decision === "ACCEPTED"
                                ? "elfogadta"
                                : "elutasította"
                            })`}
                            {version.signature.signerNotice ? (
                              <span className="mt-0.5 block text-pilot-grey-400">
                                {version.signature.signerNotice}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PilotCard>
        </div>

        <div className="flex flex-col gap-5">
          {/*
            ÖSSZESÍTÉS: the hours and the line count. The design's "2 fő
            dolgozott" is left out (decision E8): the assignees are not the
            people who worked, and the sheet has no other count of them.
          */}
          <PilotCard>
            <PilotCardHeader title="Összesítés" />
            <div className="p-5">
              <p className="text-xs text-pilot-grey-500">Összes munkaóra</p>
              <p className="mt-1 text-3xl font-semibold text-pilot-grey-900">
                {formatLaborHours(osszMunkaorak)} óra
              </p>
              <p className="mt-2 text-xs text-pilot-grey-500">
                {current.lines.length} tétel
              </p>
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Munkalap adatai" />
            <div className="px-5 py-2">
              {fieldRow("Partner", worksheet.customer.displayName)}
              {fieldRow(
                "Alegység",
                worksheet.department.path?.length
                  ? worksheet.department.path.join(" / ")
                  : `${worksheet.department.code} — ${current.unitName ?? "—"}`,
              )}
              {fieldRow(
                "Hibajegy",
                worksheet.serviceJob ? (
                  <Link
                    href={`/szerviz/hibajegyek/${worksheet.serviceJob.id}`}
                    className="text-pilot-aqua-700 hover:text-pilot-aqua-800"
                  >
                    {worksheet.serviceJob.jobNumber}
                  </Link>
                ) : (
                  "Nincs mögötte hibajegy"
                ),
              )}
              {fieldRow(
                "Felelősök",
                worksheet.assignees.length
                  ? worksheet.assignees.map((person) => person.name).join(", ")
                  : "Nincs kiosztva",
              )}
              {fieldRow("Keltezés", formatDate(current.issueDate))}
              {fieldRow("Teljesítés", formatDate(current.fulfillmentDate))}
              {fieldRow("Határidő", formatDate(current.dueDate))}
              {fieldRow("Felvette", worksheet.createdByName ?? "—")}
              {fieldRow(
                "Átadás",
                <span data-testid="munkalap-atadas">
                  {worksheet.handedOverAt
                    ? `${formatDateTime(worksheet.handedOverAt)}${
                        worksheet.handedOverByName
                          ? ` · ${worksheet.handedOverByName}`
                          : ""
                      }`
                    : "Átadás nincs rögzítve"}
                </span>,
              )}
              {fieldRow(
                "Verzió",
                `${current.version}. verzió${
                  worksheet.versions.length > 1
                    ? ` · összesen ${worksheet.versions.length}`
                    : ""
                }`,
              )}
            </div>
          </PilotCard>

          <WorksheetAssigneeEditor
            worksheetId={worksheet.id}
            token={token}
            assignees={worksheet.assignees}
            canManage={canManage}
            onSaved={setWorksheet}
          />

          <WorksheetAssetEditor
            worksheetId={worksheet.id}
            token={token}
            departmentId={worksheet.department.id}
            assets={worksheet.assets}
            canManage={canManage}
            onSaved={setWorksheet}
          />

          {/*
            HELYSZÍNI LEZÁRÁS (Figma 423:662): handing over and closing, kept
            next to each other. The facts above the buttons are facts, not
            gates (decision E7): closing needs a draft and the permission,
            exactly as the server checks, and the hand-over does not block it.
          */}
          {canManage ? (
            <section
              aria-label="Helyszíni lezárás"
              className="rounded-xl bg-pilot-aqua-50 px-5 py-5 ring-1 ring-pilot-aqua-200"
            >
              <h2 className="text-base font-semibold text-pilot-grey-900">
                Helyszíni lezárás
              </h2>
              <p className="mt-1 text-xs text-pilot-grey-600">
                {isDraft
                  ? "A lezárás után következik az aláírás."
                  : `Ez a lap már ki van állítva (${worksheetStatusLabel[
                      current.status
                    ].toLowerCase()}). Kiállítani csak piszkozatot lehet.`}
              </p>
              <ul className="mt-3 space-y-1 text-sm text-pilot-grey-800">
                <li>
                  Tételek:{" "}
                  {current.lines.length
                    ? `${current.lines.length} rögzítve`
                    : "még nincs"}
                </li>
                <li>
                  Felelősök:{" "}
                  {worksheet.assignees.length ? "megadva" : "nincs kiosztva"}
                </li>
                <li>
                  Átadás:{" "}
                  {worksheet.handedOverAt ? "rögzítve" : "még nincs rögzítve"}
                </li>
              </ul>
              <div className="mt-4 flex flex-col gap-2">
                <PilotButton
                  variant="secondary"
                  size="regular"
                  fullWidth
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      worksheetsApi.setHandedOver(
                        token,
                        worksheet.id,
                        !worksheet.handedOverAt,
                      ),
                    )
                  }
                >
                  {worksheet.handedOverAt
                    ? "Átadás visszavonása"
                    : "Átadás rögzítése"}
                </PilotButton>
                {isDraft ? (
                  <PilotButton
                    variant="primary"
                    size="regular"
                    fullWidth
                    disabled={busy}
                    onClick={() =>
                      void run(() => worksheetsApi.close(token, worksheet.id))
                    }
                  >
                    Kiállítás és lezárás
                  </PilotButton>
                ) : null}
              </div>
            </section>
          ) : null}
          {/* the block stays after the first send: a mail that did not arrive
              can be sent again (see `worksheet-detail-page.tsx`) */}
          {canManage && current.status === "AWAITING_SIGNATURE" ? (
            <PilotCard>
              <PilotCardHeader
                title={
                  current.sentForSignatureAt
                    ? "Újraküldés aláírásra"
                    : "Kiküldés aláírásra"
                }
              />
              <div className="flex flex-col gap-3 p-5">
                <p className="text-xs text-pilot-grey-400">
                  {current.sentForSignatureAt
                    ? `Kiküldve ${formatDateTime(current.sentForSignatureAt)}${
                        current.sentForSignatureToName
                          ? `: ${current.sentForSignatureToName}`
                          : ""
                      }. Ha a levél nem érkezett meg, küldd ki újra: új levél megy, az aláírás állapota nem változik.`
                    : "A lap ki van állítva, de még nem küldtük ki. Amíg nem megy ki, az ügyfél a partnerportálon sem tudja aláírni."}
                </p>
                <PilotFormField label="Kinek küldjük ki">
                  <PilotSelect
                    value={sendToUserId}
                    onChange={setSendToUserId}
                    aria-label="Kinek küldjük ki"
                  >
                    <option value="">Válassz aláírót</option>
                    {signers?.items.map((jelolt) => (
                      <option key={jelolt.id} value={jelolt.id}>
                        {jelolt.name}
                      </option>
                    ))}
                  </PilotSelect>
                  {signers?.emptyReason ? (
                    <p className="mt-1 text-xs text-pilot-grey-400">
                      {signers.emptyReason}
                    </p>
                  ) : null}
                </PilotFormField>
                <PilotButton
                  variant="primary"
                  disabled={busy || sendToUserId === ""}
                  onClick={() =>
                    void run(() =>
                      worksheetsApi.sendForSignature(
                        token,
                        worksheet.id,
                        sendToUserId,
                      ),
                    )
                  }
                >
                  {current.sentForSignatureAt
                    ? "Újraküldöm"
                    : "Elküldöm aláírásra"}
                </PilotButton>
              </div>
            </PilotCard>
          ) : null}

          {canManage && current.status === "AWAITING_SIGNATURE" ? (
            <PilotCard>
              <PilotCardHeader title="Ügyfél döntésének rögzítése" />
              <div className="flex flex-col gap-3 p-5">
                <p className="text-xs text-pilot-grey-400">
                  Ez a belső rögzítés. Az e-mailes aláírás-lánc külön szelet,
                  itt most az ügyfél döntését jegyezzük fel.
                </p>
                <PilotFormField label="Döntés">
                  <PilotSelect
                    value={signature.decision}
                    onChange={(value) =>
                      setSignature((current) => ({
                        ...current,
                        decision: value as WorksheetSignatureDecision,
                      }))
                    }
                    aria-label="Döntés"
                  >
                    <option value="ACCEPTED">Elfogadta</option>
                    <option value="REJECTED">Elutasította</option>
                  </PilotSelect>
                </PilotFormField>
                <PilotFormField
                  label="Aláíró"
                  help="Ha a listáról választasz, kód kell hozzá; ha nem, a nevet te írod be."
                >
                  <PilotSelect
                    value={signature.signerUserId}
                    onChange={(value) =>
                      setSignature((current) => ({
                        ...current,
                        signerUserId: value,
                      }))
                    }
                    aria-label="Aláíró"
                  >
                    <option value="">Egyik sem (a nevet beírom)</option>
                    {signers?.items.map((jelolt) => (
                      <option key={jelolt.id} value={jelolt.id}>
                        {jelolt.name}
                      </option>
                    ))}
                  </PilotSelect>
                  {signers?.emptyReason ? (
                    <p className="mt-1 text-xs text-pilot-grey-400">
                      {signers.emptyReason}
                    </p>
                  ) : null}
                </PilotFormField>
                {signature.signerUserId !== "" ? (
                  <PilotFormField
                    label="Aláírókód"
                    help="Négy számjegy. Az ügyfél munkatársa adja meg."
                  >
                    <PilotInput
                      type="password"
                      inputMode="numeric"
                      value={signature.signatureCode}
                      onChange={(value) =>
                        setSignature((current) => ({
                          ...current,
                          signatureCode: value,
                        }))
                      }
                      aria-label="Aláírókód"
                    />
                  </PilotFormField>
                ) : null}
                {signature.signerUserId === "" ? (
                  <PilotFormField
                    label="Aláíró neve"
                    help="A lapon látszani fog, hogy a nevet te írtad be, és nem a partner nyilvántartott munkatársa írta alá."
                  >
                    <PilotInput
                      value={signature.signerName}
                      onChange={(value) =>
                        setSignature((current) => ({
                          ...current,
                          signerName: value,
                        }))
                      }
                      aria-label="Aláíró neve"
                    />
                  </PilotFormField>
                ) : null}
                {/*
                  A MEGJEGYZÉS MINDIG LÁTHATÓ, NEM CSAK ELUTASÍTÁSNÁL --
                  Balázs döntése, 2026-09-25 11:09, a fájl fejlécében
                  bővebben. A Figma "Indoklás" mezője feltételes lett volna,
                  a mai web viselkedése marad.
                */}
                <PilotFormField label="Megjegyzés">
                  <textarea
                    rows={2}
                    aria-label="Aláírás megjegyzése"
                    value={signature.note}
                    onChange={(event) =>
                      setSignature((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    className="w-full resize-none rounded-md px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                  />
                </PilotFormField>
                <PilotButton
                  variant="primary"
                  disabled={
                    busy ||
                    (signature.signerUserId === ""
                      ? signature.signerName.trim().length < 2
                      : signature.signatureCode.trim().length !== 4)
                  }
                  onClick={() =>
                    void run(() =>
                      worksheetsApi.sign(token, worksheet.id, {
                        decision: signature.decision,
                        ...(signature.signerUserId
                          ? {
                              signerUserId: signature.signerUserId,
                              signatureCode: signature.signatureCode.trim(),
                            }
                          : { signerName: signature.signerName.trim() }),
                        note: signature.note.trim()
                          ? signature.note.trim()
                          : null,
                      }),
                    )
                  }
                >
                  Döntés rögzítése
                </PilotButton>
              </div>
            </PilotCard>
          ) : null}
        </div>
      </div>
    </PilotThemeRoot>
  );
}
