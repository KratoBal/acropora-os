"use client";

import {
  PilotBackLink,
  backLinkLabel,
} from "@/components/pilot/pilot-back-link";
import {
  Alert,
  Icon,
  PageHeader,
  PilotDataTable,
  Skeleton,
  type PilotTableColumn,
  PAGE_GUTTER_X,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetDetail,
  type WorksheetLineDetail,
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
import { serviceJobRef } from "../service-job-ref";
import { WorksheetDelete } from "../worksheet-delete";
import { handoverNote, worksheetProgressSteps } from "../worksheet-progress";
import { PilotMoreMenu } from "@/components/pilot/pilot-more-menu";
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

type WorksheetVersionRow = WorksheetDetail["versions"][number];

export const WORKSHEET_LINE_TABLE_MIN_WIDTH = 640;
/*
  THE VERSIONS TABLE IS FULL WIDTH, BELOW THE TWO COLUMNS (picasso's screen inventory, 2026-11-25, f0b70dbd; acrobot 2026-11-25). In the
  left column its card was 760 px at 1440 but only 600 px at 1280 and 344 px at 1024 (measured on the stage), so the signature column
  was cut off with no sign that it scrolls. Full width, the card is the content area: 992 px at 1280 and 736 px at 1024 (the
  1024 px sidebar layout). The fixed columns take 630 px and the reason keeps at least 90; below 720 the table scrolls, and below
  md it is the shared card list.
*/
export const WORKSHEET_VERSION_TABLE_MIN_WIDTH = 720;

/*
  A MUNKALAP TÁBLÁI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). A munkalapot a szerelő
  telefonon nyitja, a két tábla ott kártyalista: a tétel címe a megnevezés (a hozzá tartozó
  eszköz- és partnerkód alatta), a verzióé a verzió neve. A tétel "#" oszlopa a kártyán nem kell
  (a sorrend a lista sorrendje), ezért ott rejtett. A "Megnevezés" és az "Indoklás" a rugalmas oszlop.
*/
export const WORKSHEET_LINE_COLUMNS: PilotTableColumn<WorksheetLineDetail>[] = [
  {
    id: "position",
    header: "#",
    width: "50px",
    phone: "hide",
    cell: (line) => (
      <span className="text-xs text-pilot-grey-400">{line.position}</span>
    ),
  },
  {
    id: "description",
    header: "Megnevezés",
    phone: "title",
    cell: (line) => (
      <div className="text-pilot-grey-900">
        <div className="break-words font-semibold">{line.description}</div>
        {line.detail ? (
          <div className="text-xs text-pilot-grey-500">{line.detail}</div>
        ) : null}
        {line.assetNumber ? (
          <div className="font-mono text-xs text-pilot-grey-500">
            {line.assetNumber}
          </div>
        ) : null}
        {line.partnerInternalCode ? (
          <div className="text-xs text-pilot-grey-500">
            Partner belső kódja:{" "}
            <span className="font-mono">{line.partnerInternalCode}</span>
          </div>
        ) : null}
      </div>
    ),
  },
  {
    id: "quantity",
    header: "Mennyiség",
    width: "120px",
    nowrap: true,
    cell: (line) => `${formatLaborHours(line.quantity)} ${line.unit}`,
  },
  {
    id: "workers",
    header: "Hányan",
    width: "100px",
    nowrap: true,
    cell: (line) => (line.kind === "LABOR" ? `${line.workerCount} fő` : "–"),
  },
  {
    id: "laborHours",
    header: "Munkaóra",
    width: "130px",
    nowrap: true,
    cell: (line) =>
      line.kind === "LABOR"
        ? `${formatLaborHours(line.laborHours)} munkaóra`
        : "–",
  },
];

export const WORKSHEET_VERSION_COLUMNS: PilotTableColumn<WorksheetVersionRow>[] =
  [
    {
      id: "version",
      header: "Verzió",
      width: "96px",
      cell: (version) => version.label ?? `${version.version}. verzió`,
    },
    {
      id: "status",
      header: "Állapot",
      width: "104px",
      cell: (version) => (
        <PilotBadge variant={worksheetStatusPilotVariant(version.status)}>
          {worksheetStatusLabel[version.status]}
        </PilotBadge>
      ),
    },
    {
      id: "createdBy",
      header: "Készítette",
      width: "140px",
      cell: (version) => (
        <span className="text-xs text-pilot-grey-600">
          {version.createdByName ?? "—"}
          <span className="block text-pilot-grey-400">
            {formatDateTime(version.createdAt)}
          </span>
        </span>
      ),
    },
    {
      id: "closedBy",
      header: "Lezárta",
      width: "140px",
      cell: (version) => (
        <span className="text-xs text-pilot-grey-600">
          {version.closedByName ?? "—"}
          <span className="block text-pilot-grey-400">
            {formatDateTime(version.closedAt)}
          </span>
        </span>
      ),
    },
    {
      id: "reason",
      header: "Indoklás",
      cell: (version) => (
        <span className="break-words text-xs text-pilot-grey-500">
          {version.changeReason ?? "—"}
        </span>
      ),
    },
    {
      id: "signature",
      header: "Aláírás",
      width: "150px",
      cell: (version) => (
        <span className="text-xs text-pilot-grey-600">
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
        </span>
      ),
    },
  ];

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
 *   and the customer's decision card.
 * - ABOVE BOTH COLUMNS (picasso 3.1, 2026-11-26): the progress bar and the
 *   "Következő lépés" box with ONE main button, the rest behind Továbbiak.
 *   The box replaced the design's "Helyszíni lezárás" panel (it stood at the
 *   bottom of the right column) and holds the hand-over, the close and the
 *   send for signature. The lines above the close are facts, not gates
 *   (decision E7): the close needs a draft with lines and `service.manage`,
 *   exactly as the server checks it.
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
 * Rejtés/Visszaállítás (`canHide`) and Szerkesztés (`canManage && isDraft`,
 * secondary since 3.1) stay in the header; the hand-over (`canManage`),
 * Kiállítás és lezárás (`canManage && isDraft`), the send for signature and
 * Folytatás új munkalapon (`canManage && isSigned`) are in the "Következő
 * lépés" box; the conditions are unchanged.
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
  const canDelete = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_JOB_DELETE),
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
      <PilotThemeRoot bleed className="min-h-screen bg-pilot-grey-50 p-8">
        <Skeleton className="h-72" />
      </PilotThemeRoot>
    );

  if (!worksheet)
    return (
      <PilotThemeRoot bleed className="min-h-screen bg-pilot-grey-50 p-8">
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
  const isAwaiting = current.status === "AWAITING_SIGNATURE";
  const osszMunkaorak = current.laborHours;
  const progress = worksheetProgressSteps(
    current.status,
    current.lines.length,
    Boolean(worksheet.handedOverAt),
  );
  const handover = handoverNote({
    handedOver: Boolean(worksheet.handedOverAt),
    serviceJob: worksheet.serviceJob,
  });
  // what the box says the next step is, by the state (the facts under it are facts, not gates: decision E7)
  const nextStepSentence = isDraft
    ? "Kiállítás és lezárás: utána következik az aláírás."
    : isAwaiting
      ? current.sentForSignatureAt
        ? `Aláírásra vár. Kiküldve ${formatDateTime(current.sentForSignatureAt)}${
            current.sentForSignatureToName
              ? `: ${current.sentForSignatureToName}`
              : ""
          }. Ha a levél nem érkezett meg, küldd ki újra: új levél megy, az aláírás állapota nem változik.`
        : "Aláírásra vár, de még nem küldtük ki. Amíg nem megy ki, az ügyfél a partnerportálon sem tudja aláírni."
      : isSigned
        ? (handover?.text ?? "A lap aláírva és átadva.")
        : "Az ügyfél elutasította ezt a verziót.";
  const toggleHandover = () =>
    run(() =>
      worksheetsApi.setHandedOver(token, worksheet.id, !worksheet.handedOverAt),
    );
  const continueOnNewSheet = () =>
    run(async () => {
      const created = await worksheetsApi.continueFrom(token, worksheet.id);
      router.push(`/szerviz/munkalapok/${created.id}/szerkesztes`);
      return created;
    });

  const fieldRow = (label: string, value: ReactNode) => (
    <PilotDataRow label={label} labelWidth="96px" value={value} />
  );

  return (
    <PilotThemeRoot
      bleed
      className={`flex min-h-screen flex-col gap-6 bg-pilot-grey-50 ${PAGE_GUTTER_X} py-8`}
    >
      {/*
        THE HEADER OF THE SERVICE REDESIGN (Figma 423:662): back, the sheet's
        number, the subject as the title, the display status and where the
        work is. Hiding and editing stay here; the steps (closing, sending,
        handing over, continuing) are in the "Következő lépés" box below.
      */}
      <div>
        <PilotBackLink href={backToList.href}>
          {backLinkLabel(backToList, "Munkalapok")}
        </PilotBackLink>
        <PageHeader
          eyebrow={current.label ?? "Piszkozat"}
          title={current.subject}
          meta={
            <>
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
            </>
          }
          actions={
            <>
              <ContextConversationButton
                kind="worksheet"
                objectId={worksheet.id}
              />
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
              {/* a fő gomb a Következő lépés dobozé (picasso 3.1): a szerkesztés itt másodlagos */}
              {canManage && isDraft ? (
                <Link href={`/szerviz/munkalapok/${worksheet.id}/szerkesztes`}>
                  <PilotButton variant="secondary">
                    <Icon name="pencil" size={12} />
                    Szerkesztés
                  </PilotButton>
                </Link>
              ) : null}
            </>
          }
        />
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

      {/*
        A FOLYAMATSÁV ÉS A KÖVETKEZŐ LÉPÉS (picasso képernyő-leltár 3.1; acrobot 62182, 62184). Felül a lap útja (Folyamatban, Elkészült,
        Lezárva, Átadva: a jelvény szavai, ugyanabból a forrásból, `worksheet-progress.ts`), alatta a következő lépés EGY fő gombbal, a
        többi a közös "Továbbiak" menüben (`PilotMoreMenu`), mint a hibajegynél (3.2). A "Helyszíni lezárás" doboz eddig a jobb oszlop
        legalján állt; a tartalma (a tények, az átadás, a kiállítás) ide került, és aláírásra váró lapon a kiküldés is.
      */}
      <ol
        aria-label="A munkalap útja"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {progress.map((stepItem, index) => (
          <li
            key={stepItem.key}
            aria-current={stepItem.state === "current" ? "step" : undefined}
            data-state={stepItem.state}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${
              stepItem.state === "done"
                ? "bg-pilot-aqua-50 text-pilot-aqua-700 ring-pilot-aqua-200"
                : stepItem.state === "current"
                  ? "bg-white font-semibold text-pilot-grey-900 ring-2 ring-pilot-aqua-500"
                  : stepItem.state === "rejected"
                    ? "bg-pilot-red-50 font-semibold text-pilot-red-700 ring-pilot-red-100"
                    : "bg-white text-pilot-grey-500 ring-pilot-grey-200"
            }`}
          >
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-xs ring-1 ring-current"
            >
              {stepItem.state === "done" ? "✓" : index + 1}
            </span>
            {stepItem.label}
          </li>
        ))}
      </ol>

      {canManage ? (
        <section
          aria-label="Következő lépés"
          className="rounded-xl bg-pilot-aqua-50 px-5 py-5 ring-1 ring-pilot-aqua-200"
        >
          <h2 className="text-base font-semibold text-pilot-grey-900">
            Következő lépés
          </h2>
          <p className="mt-1 text-sm text-pilot-grey-700">{nextStepSentence}</p>
          {isDraft ? (
            <ul className="mt-3 space-y-1 text-sm text-pilot-grey-800">
              <li>
                Tételek:{" "}
                {current.lines.length
                  ? `${current.lines.length} rögzítve`
                  : "még nincs"}
              </li>
              <li>
                Felelős:{" "}
                {worksheet.assignees.length ? "megadva" : "nincs kiosztva"}
              </li>
              <li>
                Átadás:{" "}
                {worksheet.handedOverAt ? "rögzítve" : "még nincs rögzítve"}
              </li>
            </ul>
          ) : null}
          {isAwaiting ? (
            <div className="mt-3 max-w-md">
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
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-start gap-2">
            {isDraft ? (
              <PilotButton
                variant="primary"
                size="regular"
                disabled={busy || current.lines.length === 0}
                aria-describedby={
                  current.lines.length === 0
                    ? "munkalap-lezaras-akadaly"
                    : undefined
                }
                onClick={() =>
                  void run(() => worksheetsApi.close(token, worksheet.id))
                }
              >
                Kiállítás és lezárás
              </PilotButton>
            ) : null}
            {isAwaiting ? (
              <PilotButton
                variant="primary"
                size="regular"
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
            ) : null}
            {isSigned && !worksheet.handedOverAt ? (
              <PilotButton
                variant="primary"
                size="regular"
                disabled={busy}
                onClick={() => void toggleHandover()}
              >
                Átadás rögzítése
              </PilotButton>
            ) : null}
            <PilotMoreMenu
              items={[
                ...(isSigned && !worksheet.handedOverAt
                  ? []
                  : [
                      {
                        key: "handover",
                        label: worksheet.handedOverAt
                          ? "Átadás visszavonása"
                          : "Átadás rögzítése",
                        disabled: busy,
                        onSelect: () => void toggleHandover(),
                      },
                    ]),
                ...(isSigned
                  ? [
                      {
                        key: "continue",
                        label: "Folytatás új munkalapon",
                        disabled: busy,
                        onSelect: () => void continueOnNewSheet(),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
          {isDraft && current.lines.length === 0 ? (
            <p
              id="munkalap-lezaras-akadaly"
              className="mt-2 text-xs text-pilot-grey-600"
            >
              Tétel nélküli munkalap nem zárható le.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_368px]">
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
                    <PilotButton variant="secondary">
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
              <PilotDataTable
                columns={WORKSHEET_LINE_COLUMNS}
                rows={current.lines}
                rowKey={(line) => line.id}
                rowTestId="worksheet-line-row"
                minWidth={WORKSHEET_LINE_TABLE_MIN_WIDTH}
              />
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
          <WorksheetEntries
            worksheetId={worksheet.id}
            canWrite={canManage && !isSigned}
          />

          {/* a lezárt (aláírt) lapon a napló és az anyagigénylés is csak olvasható (picasso 3.1), mint a felelősök és az eszközök */}
          <WorksheetMaterialRequests
            worksheetId={worksheet.id}
            canWrite={canManage && !isSigned}
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
            canRegenerate={canManage}
          />
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
                "Helyszín",
                worksheet.department.path?.length
                  ? worksheet.department.path.join(" / ")
                  : `${worksheet.department.code}: ${current.unitName ?? "—"}`,
              )}
              {fieldRow(
                worksheet.serviceJob
                  ? serviceJobRef(worksheet.serviceJob).label
                  : "Hibajegy",
                worksheet.serviceJob ? (
                  <Link
                    href={serviceJobRef(worksheet.serviceJob).href}
                    className="text-pilot-aqua-700 hover:text-pilot-aqua-800"
                  >
                    {worksheet.serviceJob.jobNumber}
                  </Link>
                ) : (
                  "Nincs mögötte hibajegy"
                ),
              )}
              {fieldRow(
                "Felelős",
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
                    : `Nincs rögzítve. ${handover?.text ?? ""}`}
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
            // a lezárt (aláírt) lapon a felelősök és az eszközök csak olvashatók (picasso 3.1/4, acrobot 2026-11-25); a szerver ma NEM tiltja
            // az írást (mérve a teszten: 200), ezt a felület kezeli, a szerveroldali tiltás külön döntés
            canManage={canManage && !isSigned}
            onSaved={setWorksheet}
          />

          <WorksheetAssetEditor
            worksheetId={worksheet.id}
            token={token}
            departmentId={worksheet.department.id}
            assets={worksheet.assets}
            canManage={canManage && !isSigned}
            onSaved={setWorksheet}
          />

          {/*
            A VÉGLEGES TÖRLÉS (a hibajegy-törlés 2. szelete; acrobot 55770): csak az ÖNÁLLÓ lapon (a jegy alatti lapot a jegy törlése viszi, vagy előbb le kell választani), a
            törlési joggal (`service.job.delete`). A gomb előnézetet kér, megerősítés után töröl; a lista a törlés után nyílik.
          */}
          {canDelete && !worksheet.serviceJob ? (
            <PilotCard>
              <PilotCardHeader title="Törlés" />
              <div className="space-y-3 px-5 py-4">
                <p className="text-xs text-pilot-grey-500">
                  Az önálló munkalap véglegesen törölhető, amíg nincs aláírva,
                  lezárva vagy átadva.
                </p>
                <WorksheetDelete
                  token={token}
                  worksheetId={worksheet.id}
                  onDeleted={() => router.push("/szerviz/munkalapok")}
                />
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

      {/* THE VERSIONS TABLE IS FULL WIDTH, below the two columns (picasso 3.1/2, acrobot 2026-11-25): in the left column it had 600 px at 1280 and 344 px at 1024, so its Aláírás column was cut off. */}
      <PilotCard>
        <PilotCardHeader title="Verziók" />
        <PilotDataTable
          columns={WORKSHEET_VERSION_COLUMNS}
          rows={worksheet.versions}
          rowKey={(version) => version.id}
          rowTestId="worksheet-version-row"
          minWidth={WORKSHEET_VERSION_TABLE_MIN_WIDTH}
        />
      </PilotCard>
    </PilotThemeRoot>
  );
}
