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
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { worksheetsApi } from "@/lib/api/worksheets";
import { WorksheetEntries } from "../worksheet-entries";
import { WorksheetMaterialRequests } from "../worksheet-material-requests";
import { WorksheetAssetEditor } from "../worksheet-asset-editor";
import { WorksheetAssigneeEditor } from "../worksheet-assignee-editor";
import { WorksheetDocuments } from "../worksheet-documents";
import {
  formatDate,
  formatDateTime,
  worksheetStatusLabel,
  worksheetStatusPilotVariant,
} from "../worksheet-labels";
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
 * === A BAL/JOBB OSZLOP PONTOSAN A FIGMA FORRÁSÁT KÖVETI ===
 *
 * `MunkalapDetail` (506-867. sor) BAL oszlopa (576-768. sor): Munkalap
 * adatai, A munka leírása, Elvégzett munka és anyagok, Érintett eszközök,
 * Bejegyzések, Anyagigények, Csatolmányok, Verziók. JOBB oszlopa
 * (770-863. sor): Kiküldés aláírásra, Ügyfél döntésének rögzítése, A
 * kiadott munkalap.
 *
 * === AZ ÖSSZESÍTÉS ÉS A FELELŐSÖK A JOBB OSZLOP TETEJÉN ÁLL ===
 *
 * acrobot szó szerint: a tervben nem szereplő két valódi kártya
 * (Összesítés, Felelősök) "a jobb oszlopba" kerüljön, "a Munkalap adatai
 * közelébe", Felelősök "közvetlenül alá". A Figma forrásban (506-867. sor)
 * a Munkalap adatai kártya a BAL oszlop első eleme (579. sor) -- a "jobb
 * oszlop" tehát nem ugyanaz a hasáb, ahol Munkalap adatai áll. A két
 * utasítást (jobb oszlop; Munkalap adatai közelében) csak úgy lehet
 * EGYSZERRE igazzá tenni, ha "közel" nem oszlopot jelent, hanem MAGASSÁGOT:
 * Összesítés és Felelősök a JOBB oszlop LEGTETEJÉN áll, a Munkalap adatai
 * kártyával egy vonalban (az a bal oszlop teteje), Felelősök közvetlenül az
 * Összesítés alatt -- ez egyszerre elégíti ki mindkét mondatot.
 *
 * MEGJEGYZÉS A "MUNKALAP ADATAI" KÁRTYA MEZŐIRŐL: a Figma saját "Munkalap
 * adatai" kártyája tartalmaz egy "Felelősök" MEZŐT is (nevek vesszővel
 * felsorolva, 586. sor) -- ez ITT NEM ismétlődik meg, mert a valódi
 * `WorksheetAssigneeEditor` widget (szerkeszthető, jogosultság-függő) a
 * jobb oszlopban áll, és egy második, csak-olvasható felsorolás
 * ugyanarról az adatról zajt jelentene, nem információt. Hasonlóan, a
 * Figma "Tárgy" mezőjét (581. sor) a mai kód SOHA nem ismétli a Munkalap
 * adatai kártyán belül -- a tárgy a lap FEJLÉCÉBEN áll címként
 * (`worksheet-detail-page.tsx:808`), és ez itt is így marad: a kód nyer a
 * mezőlistán, a terv az elrendezésen.
 *
 * === A KIADOTT MUNKALAP NEM BONTHATÓ KÜLÖN A CSATOLMÁNYOKTÓL ===
 *
 * acrobot 3. pontja: ha "A kiadott munkalap" a `WorksheetDocuments`-en
 * belül él, ne bontsam külön komponensbe. Ellenőriztem
 * (`worksheet-documents.tsx:143` körül): TÉNYLEG ott van, egy `PilotCard`
 * blokkban a Csatolmányok kártya ELŐTT, ugyanabban a komponensben. A két
 * kártya emiatt EGYÜTT mozog -- a `WorksheetDocuments` egyetlen JSX-hívás,
 * a kettő fizikailag nem választható szét két oszlopra kódmódosítás
 * nélkül. Mivel acrobot kifejezetten kérte, hogy NE bontsam szét, a teljes
 * (kiadott munkalap + csatolmányok) egység oda kerül, ahol Figma "A
 * kiadott munkalap" kártyája áll: a JOBB oszlop legalja, a Kiküldés/Döntés
 * kártyák alatt. A Csatolmányok emiatt a JOBB oszlopban jelenik meg, nem a
 * balban, ahogy a terv saját, önálló Csatolmányok-kártyája mutatná -- ez
 * egyetlen sorban eltér a tervtől, és itt van kimondva.
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
 * === A FEJLÉC-AKCIÓK MIND MEGMARADTAK, FIGMA GOMB-STÍLUSSAL (acrobot 2.
 *     pontja) ===
 *
 * Rejtés/Visszaállítás (`canHide`), Átadás rögzítése/visszavonása
 * (`canManage`), Szerkesztés (`canManage && isDraft`, külön szerkesztő
 * oldalra visz), Kiállítás és lezárás (`canManage && isDraft`),
 * állapot-mondat nem-piszkozatnál, Folytatás új munkalapon (`canManage &&
 * isSigned`) -- mind a mai logikával, `PilotButton`-nal.
 *
 * === A MEGJEGYZÉS MINDIG LÁTHATÓ (Balázs döntése, 2026-09-25 11:09) ===
 *
 * A "Ügyfél döntésének rögzítése" kártyán a Megjegyzés mező NEM
 * feltételes (nem csak "Elutasította"-nál jelenik meg, ahogy a Figma
 * "Indoklás" mezője sugallná) -- a mai web viselkedése marad, ahogy
 * Balázs kimondta.
 */

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="mb-0.5 text-[11px] text-pilot-grey-400">{label}</p>
      <p className="text-sm text-pilot-grey-800">{value}</p>
    </div>
  );
}

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

  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <Link
          href={backToList.href}
          className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400 transition-colors hover:text-pilot-grey-700"
        >
          <Icon name="chevron-left" size={12} />
          {backToList.fromWithinApp ? "Vissza" : "Munkalapok"}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2.5">
              <h1 className="text-xl font-semibold text-pilot-grey-900">
                {current.label ?? (
                  <span className="text-base italic text-pilot-grey-400">
                    Piszkozat
                  </span>
                )}
              </h1>
              <PilotBadge variant={worksheetStatusPilotVariant(current.status)}>
                {worksheetStatusLabel[current.status]}
              </PilotBadge>
            </div>
            <p className="text-sm text-pilot-grey-500">
              {current.sentForSignatureAt
                ? `${worksheet.customer.displayName} · kiküldve aláírásra${
                    current.sentForSignatureToName
                      ? `: ${current.sentForSignatureToName}`
                      : ""
                  }`
                : worksheet.customer.displayName}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
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
            {canManage ? (
              <PilotButton
                variant="secondary"
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
            ) : null}
            {canManage && isDraft ? (
              <Link href={`/szerviz/munkalapok/${worksheet.id}/szerkesztes`}>
                <PilotButton variant="primary">
                  <Icon name="pencil" size={12} />
                  Szerkesztés
                </PilotButton>
              </Link>
            ) : null}
            {canManage && isDraft ? (
              <PilotButton
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void run(() => worksheetsApi.close(token, worksheet.id))
                }
              >
                Kiállítás és lezárás
              </PilotButton>
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
                    router.push(
                      `/szerviz/munkalapok/${created.id}/szerkesztes`,
                    );
                    return created;
                  })
                }
              >
                Folytatás új munkalapon
              </PilotButton>
            ) : null}
          </div>
        </div>
        {canManage && !isDraft ? (
          <p className="mt-2 text-xs text-pilot-grey-400">
            Ez a lap már ki van állítva (
            {worksheetStatusLabel[current.status].toLowerCase()}
            ). Kiállítani csak piszkozatot lehet.
          </p>
        ) : null}
      </div>

      <div className="px-8 pt-4">
        <ServiceOfflineNotice
          state={worksheet ? { kind: "loaded" } : { kind: "empty" }}
          pilot
        />
        {error ? (
          <Alert
            className="mb-4"
            variant="danger"
            title="Hiba"
            description={error}
          />
        ) : null}
        {/*
          KÉT SÁV, HA RELEVÁNS -- Figma szerint amber (előzmény) és teal
          (folytatás), a pilot tokenekre fordítva.
        */}
        {worksheet.continues ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-pilot-amber-50 px-4 py-3 text-sm ring-1 ring-pilot-amber-100">
            <span className="text-pilot-amber-700">
              Ez a lap egy korábbi munkalap folytatása.
            </span>
            <Link href={`/szerviz/munkalapok/${worksheet.continues.id}`}>
              <PilotButton variant="secondary">
                Előzmény megnyitása →
              </PilotButton>
            </Link>
          </div>
        ) : null}
        {worksheet.continuedBy.length ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-pilot-aqua-50 px-4 py-3 text-sm ring-1 ring-pilot-aqua-200">
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
      </div>

      <div className="grid items-start gap-6 px-8 py-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <PilotCard>
            <PilotCardHeader title="Munkalap adatai" />
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
              <Field label="Partner" value={worksheet.customer.displayName} />
              <Field
                label="Alegység"
                value={
                  worksheet.department.path?.length
                    ? worksheet.department.path.join(" / ")
                    : `${worksheet.department.code} — ${current.unitName ?? "—"}`
                }
              />
              {worksheet.serviceJob ? (
                <div>
                  <p className="mb-0.5 text-[11px] text-pilot-grey-400">
                    Hibajegy
                  </p>
                  <Link
                    href={`/szerviz/hibajegyek/${worksheet.serviceJob.id}`}
                    className="text-sm text-pilot-aqua-600 hover:text-pilot-aqua-800"
                  >
                    {worksheet.serviceJob.jobNumber}
                  </Link>
                </div>
              ) : (
                <Field label="Hibajegy" value="Nincs mögötte hibajegy" />
              )}
              <Field label="Keltezés" value={formatDate(current.issueDate)} />
              <Field
                label="Teljesítés"
                value={formatDate(current.fulfillmentDate)}
              />
              <Field label="Határidő" value={formatDate(current.dueDate)} />
              <Field label="Felvette" value={worksheet.createdByName ?? "—"} />
              <div>
                <p className="mb-0.5 text-[11px] text-pilot-grey-400">Átadás</p>
                <p
                  className="text-sm text-pilot-grey-800"
                  data-testid="munkalap-atadas"
                >
                  {worksheet.handedOverAt
                    ? `${formatDateTime(worksheet.handedOverAt)}${
                        worksheet.handedOverByName
                          ? ` · ${worksheet.handedOverByName}`
                          : ""
                      }`
                    : "Átadás nincs rögzítve"}
                </p>
              </div>
              <Field
                label="Verzió"
                value={`${current.version}. verzió${
                  worksheet.versions.length > 1
                    ? ` · összesen ${worksheet.versions.length}`
                    : ""
                }`}
              />
            </div>
          </PilotCard>

          {current.description ? (
            <PilotCard>
              <PilotCardHeader title="A munka leírása" />
              <div className="p-5">
                <p className="whitespace-pre-line text-sm leading-relaxed text-pilot-grey-700">
                  {current.description}
                </p>
              </div>
            </PilotCard>
          ) : null}

          <PilotCard>
            <PilotCardHeader
              title="Elvégzett munka és anyagok"
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
            {current.lines.length === 0 ? (
              <p className="px-5 py-6 text-sm italic text-pilot-grey-300">
                Nincs tétel. Tétel nélküli munkalap nem zárható le.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-pilot-grey-100">
                      {[
                        "#",
                        "Megnevezés",
                        "Mennyiség",
                        "Egység",
                        "Munkaóra",
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
                    {current.lines.map((line) => (
                      <tr
                        key={line.id}
                        className="border-b border-pilot-grey-50"
                      >
                        <td className="px-5 py-2.5 text-xs text-pilot-grey-400">
                          {line.position}
                        </td>
                        <td className="px-5 py-2.5 text-pilot-grey-800">
                          <div className="font-medium">{line.description}</div>
                          {line.detail ? (
                            <div className="text-xs text-pilot-grey-400">
                              {line.detail}
                            </div>
                          ) : null}
                          {line.assetNumber ? (
                            <div className="font-mono text-xs text-pilot-grey-400">
                              {line.assetNumber}
                            </div>
                          ) : null}
                          {line.partnerInternalCode ? (
                            <div className="text-xs text-pilot-grey-400">
                              Partner belső kódja:{" "}
                              <span className="font-mono">
                                {line.partnerInternalCode}
                              </span>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-2.5 font-mono text-pilot-grey-600">
                          {line.quantity}
                        </td>
                        <td className="px-5 py-2.5 text-pilot-grey-500">
                          {line.unit}
                        </td>
                        <td className="px-5 py-2.5 font-mono text-pilot-grey-600">
                          {line.kind === "LABOR" ? line.laborHours : "–"}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-pilot-grey-50">
                      <td
                        className="px-5 py-2.5 text-sm font-semibold text-pilot-grey-800"
                        colSpan={4}
                      >
                        Összesítés
                      </td>
                      <td className="px-5 py-2.5 font-mono text-sm font-semibold text-pilot-grey-800">
                        {osszMunkaorak} ó
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </PilotCard>

          <WorksheetAssetEditor
            worksheetId={worksheet.id}
            token={token}
            departmentId={worksheet.department.id}
            assets={worksheet.assets}
            canManage={canManage}
            onSaved={setWorksheet}
          />

          <WorksheetEntries worksheetId={worksheet.id} canWrite={canManage} />

          <WorksheetMaterialRequests
            worksheetId={worksheet.id}
            canWrite={canManage}
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
            ÖSSZESÍTÉS ÉS FELELŐSÖK A JOBB OSZLOP TETEJÉN -- a fájl fejlécében
            megindokolva: a terv ezt a két kártyát nem adja önállóan, acrobot
            döntése szerint itt, a Munkalap adatai kártyával egy magasságban
            állnak.
          */}
          <PilotCard>
            <PilotCardHeader title="Összesítés" />
            <div className="p-5">
              <Field label="Összes munkaóra" value={`${osszMunkaorak} óra`} />
            </div>
          </PilotCard>

          <WorksheetAssigneeEditor
            worksheetId={worksheet.id}
            token={token}
            assignees={worksheet.assignees}
            canManage={canManage}
            onSaved={setWorksheet}
          />

          {canManage &&
          current.status === "AWAITING_SIGNATURE" &&
          current.sentForSignatureAt === null ? (
            <PilotCard>
              <PilotCardHeader title="Kiküldés aláírásra" />
              <div className="flex flex-col gap-3 p-5">
                <p className="text-xs text-pilot-grey-400">
                  A lap ki van állítva, de még nem küldtük ki. Amíg nem megy ki,
                  az ügyfél a partnerportálon sem tudja aláírni.
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
                  Elküldöm aláírásra
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

          {/*
            A KIADOTT MUNKALAP -- a fájl fejlécében megindokolva, miért áll
            itt a Csatolmányokkal EGYÜTT: a WorksheetDocuments egy hívás,
            nem bontható a két Figma-kártya közé.
          */}
          <WorksheetDocuments
            worksheetId={worksheet.id}
            token={token}
            canView={canView}
          />
        </div>
      </div>
    </PilotThemeRoot>
  );
}
