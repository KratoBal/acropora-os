"use client";

import {
  Alert,
  Button,
  FormField,
  Input,
  Select,
  Skeleton,
  Textarea,
} from "@acropora/ui";
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
import {
  ServiceBackLink,
  ServiceContextRow,
  ServiceDetailHeader,
  ServiceDetailSplit,
  ServicePanel,
  ServicePanelHeading,
} from "@/components/service/service-detail-chrome";
import { ServiceStatusBadge } from "@/components/service/service-list-chrome";
import { sv } from "@/components/service/service-theme";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { useReturnTo } from "@/components/navigation-history";
import { worksheetsApi } from "@/lib/api/worksheets";
import { WorksheetEntries } from "./worksheet-entries";
import { WorksheetAssetEditor } from "./worksheet-asset-editor";
import { WorksheetAssigneeEditor } from "./worksheet-assignee-editor";
import { WorksheetDocuments } from "./worksheet-documents";
import {
  formatDate,
  formatDateTime,
  worksheetLabelOrDraft,
  worksheetStatusLabel,
  worksheetStatusTone,
} from "./worksheet-labels";

export function WorksheetDetailPage({ worksheetId }: { worksheetId: string }) {
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

  const [worksheet, setWorksheet] = useState<WorksheetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState({
    decision: "ACCEPTED" as WorksheetSignatureDecision,
    signerName: "",
    /**
     * KIT VALASZTOTTAK a lap partnerenek munkatarsai kozul. Ures sztring =
     * "egyik sem", vagyis a nevet az iroda irja be -- es a lap ezt KIMONDJA.
     */
    signerUserId: "",
    /** Az alairokod. CSAK a listarol valasztott agon kell. */
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

  /**
   * AKI ALAIRHATJA A LAPOT: a lap partnerenek nyilvantartott munkatarsai.
   *
   * KULON LEKERDEZES, es a hibaja NEM allitja meg a lapot: az alairas egy
   * szakasz a sok kozul, es egy be nem tolt lista miatt a lap tobbi resze
   * (tetelek, verziok, naplo) ugyanugy olvashato marad. Ami viszont NEM
   * torenik meg: nem esik vissza ures listara csendben -- olyankor a valaszto
   * "egyik sem" agra all, ami LATSZIK.
   */
  const [signers, setSigners] = useState<WorksheetSignerListResponse | null>(
    null,
  );
  useEffect(() => {
    if (!token || !worksheetId) return;
    const controller = new AbortController();
    worksheetsApi
      .signers(token, worksheetId, controller.signal)
      .then(setSigners)
      .catch(() => undefined);
    return () => controller.abort();
  }, [token, worksheetId]);

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
      <div className="space-y-3" aria-label="Munkalap betöltése">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );

  if (!worksheet)
    /*
      A SAV IDE IS KELL, ES EPP IDE A LEGINKABB.

      Ez az az ag, ami HIDEG betoltesnel kapcsolat nelkul lefut -- es eddig a
      felhasznalo csak annyit latott, hogy "nem tolthetó be / Ismeretlen hiba".
      A savot a fo visszateres hordozta, ami ide SOHA nem jut el: a `state`
      ternary `empty` fele HOLT ag volt, es a `Nincs internet. Ezert nem tudtuk
      betolteni az adatokat.` mondat -- amit epp erre az esetre irtunk -- sosem
      jelent meg.

      Nautilus merte ezt a sajat reszletlapjan (20188), es ugyanigy oldotta meg:
      a savot a korai agak FOLE kell emelni, kulonben egy allitas rola nem
      halott teszt, hanem nem letezo allapot.
    */
    return (
      <>
        <ServiceOfflineNotice state={{ kind: "empty" }} />
        <Alert
          variant="danger"
          title="A munkalap nem tölthető be"
          description={error ?? "Ismeretlen hiba."}
        />
      </>
    );

  const current = worksheet.currentVersion;
  const isDraft = current.status === "DRAFT";
  const isSigned = current.status === "SIGNED";

  /**
   * A HASABOK TARTALMA KULON ALL, MERT KET HELYEN KELL. A `ServiceDetailSplit`
   * ket oszlopot kap, es egy 600 soros JSX-kifejezesbe agyazva a ketto hatara
   * olvashatatlan lenne -- ez a valtozat megmondja, mi melyik oszlopba tartozik.
   */
  const lineRows = (
    <section className={sv.panel}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-[22px] py-[18px]">
        <h2 className="text-[16px] font-bold text-ink">
          Elvégzett munka és anyagok
        </h2>
        {canManage && isDraft ? (
          <Link href={`/szerviz/munkalapok/${worksheet.id}/szerkesztes`}>
            <Button variant="secondary">Tételek szerkesztése</Button>
          </Link>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead>
            <tr>
              <th className={sv.tableHead}>#</th>
              <th className={sv.tableHead}>Megnevezés</th>
              <th className={`${sv.tableHead} text-right`}>Mennyiség</th>
              <th className={sv.tableHead}>Egység</th>
              {/*
                AZ EGYSÉGÁR, AZ ÁFA ÉS A NETTÓ OSZLOP 2026-09-17-ÉN KIKERÜLT.
                Balázs döntése ("B"): a nettó, bruttó és áfa mezők sehol nem
                jelennek meg. Az ADAT megmarad, és ár továbbra is rendelhető
                egy tételhez -- csak nem látszik, és a hiánya nem állít meg
                semmit (#809, beolvadt).
              */}
            </tr>
          </thead>
          <tbody>
            {current.lines.map((line) => (
              <tr key={line.id} className={sv.tableRow}>
                <td className={`${sv.tableCell} ${sv.rowMeta}`}>
                  {line.position}
                </td>
                <td className={sv.tableCell}>
                  <div className="text-[13px] font-semibold text-ink">
                    {line.description}
                  </div>
                  {line.detail ? (
                    <div className={sv.rowMeta}>{line.detail}</div>
                  ) : null}
                  {line.assetNumber ? (
                    <div className={`font-mono ${sv.rowMeta}`}>
                      {line.assetNumber}
                    </div>
                  ) : null}
                  {/* AZ UGYFEL SAJAT KODJA, csak ha van, es FELIRATTAL. A
                      felette allo eszkozszam a MIENK, ez pedig az ugyfele:
                      ket csupasz kod egymas alatt pont azt a keveredest
                      hozna, ami ellen a mezo kulon nevet kapott. */}
                  {line.inventoryNumber ? (
                    <div className={sv.rowMeta}>
                      Leltári szám:{" "}
                      <span className="font-mono">{line.inventoryNumber}</span>
                    </div>
                  ) : null}
                </td>
                <td
                  className={`${sv.tableCell} text-right tabular-nums text-ink`}
                >
                  {line.quantity}
                </td>
                <td className={`${sv.tableCell} text-ink`}>{line.unit}</td>
              </tr>
            ))}
            {current.lines.length === 0 ? (
              <tr>
                <td className={`${sv.tableCell} ${sv.rowMeta}`} colSpan={4}>
                  Nincs tétel. Tétel nélküli munkalap nem zárható le.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );

  const signatureForm =
    canManage && current.status === "AWAITING_SIGNATURE" ? (
      <ServicePanel>
        <ServicePanelHeading title="Ügyfél döntésének rögzítése" />
        <p className="-mt-3 mb-4 text-xs text-muted">
          Ez a belső rögzítés. Az e-mailes aláírás-lánc külön szelet, itt most
          az ügyfél döntését jegyezzük fel.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <FormField label="Döntés">
            <Select
              aria-label="Döntés"
              value={signature.decision}
              onChange={(event) =>
                setSignature((current) => ({
                  ...current,
                  decision: event.target.value as WorksheetSignatureDecision,
                }))
              }
            >
              <option value="ACCEPTED">Elfogadta</option>
              <option value="REJECTED">Elutasította</option>
            </Select>
          </FormField>
          {/*
            AZ ALAIRO A LISTAROL VALASZTHATO (Balazs, 2026-09-04), es a
            szabad szoveg az "egyik sem" ag -- amit a lap KIMOND.

            A LISTA UGYANABBOL A VEGPONTBOL JON, mint a telefonon, es az
            `emptyReason` is: ket kulonbozo ok van arra, hogy ures, es a
            teendojuk MAS.
          */}
          <FormField label="Aláíró" className="md:col-span-2">
            <Select
              aria-label="Aláíró"
              value={signature.signerUserId}
              onChange={(event) =>
                setSignature((current) => ({
                  ...current,
                  signerUserId: event.target.value,
                }))
              }
            >
              <option value="">Egyik sem (a nevet beírom)</option>
              {signers?.items.map((jelolt) => (
                <option key={jelolt.id} value={jelolt.id}>
                  {jelolt.name}
                </option>
              ))}
            </Select>
            {signers?.emptyReason ? (
              <p className="pt-1 text-xs text-muted">{signers.emptyReason}</p>
            ) : null}
          </FormField>
          {/*
            A KOD A VALASZTAS UTAN JON ELO, es az "egyik sem" agon NINCS --
            ott a lap maga mondja ki, hogy nem a partner nyilvantartott
            munkatarsa irta ala.
          */}
          {signature.signerUserId !== "" ? (
            <FormField label="Aláírókód" className="md:col-span-2">
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                aria-label="Aláírókód"
                value={signature.signatureCode}
                onChange={(event) =>
                  setSignature((current) => ({
                    ...current,
                    signatureCode: event.target.value,
                  }))
                }
              />
              <p className="pt-1 text-xs text-muted">
                Négy számjegy. Az ügyfél munkatársa adja meg.
              </p>
            </FormField>
          ) : null}
          {signature.signerUserId === "" ? (
            <FormField label="Aláíró neve" className="md:col-span-2">
              <Input
                aria-label="Aláíró neve"
                value={signature.signerName}
                onChange={(event) =>
                  setSignature((current) => ({
                    ...current,
                    signerName: event.target.value,
                  }))
                }
              />
              <p className="pt-1 text-xs text-muted">
                A lapon látszani fog, hogy a nevet te írtad be, és nem a partner
                nyilvántartott munkatársa írta alá.
              </p>
            </FormField>
          ) : null}
          <FormField label="Megjegyzés" className="md:col-span-3">
            <Textarea
              aria-label="Aláírás megjegyzése"
              rows={2}
              value={signature.note}
              onChange={(event) =>
                setSignature((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
            />
          </FormField>
        </div>
        <Button
          className="mt-4"
          /**
           * A NEV CSAK AZ "EGYIK SEM" AGON KOTELEZO, a KOD pedig CSAK a
           * valasztott agon. A ket ag ket kulon mezot kovetel, es egyik sem
           * kovetel a masikeval.
           */
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
                /**
                 * CSAK AZ EGYIK MEZO MEGY FEL. Ha mind a ketto ott allna, a
                 * szerver ket kulonbozo allitast kapna arrol, ki irta ala.
                 */
                ...(signature.signerUserId
                  ? {
                      signerUserId: signature.signerUserId,
                      signatureCode: signature.signatureCode.trim(),
                    }
                  : { signerName: signature.signerName.trim() }),
                note: signature.note.trim() ? signature.note.trim() : null,
              }),
            )
          }
        >
          Döntés rögzítése
        </Button>
      </ServicePanel>
    ) : null;

  const versionRows = (
    <section className={sv.panel}>
      <div className="border-b border-line px-[22px] py-[18px]">
        <h2 className="text-[16px] font-bold text-ink">Verziók</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr>
              <th className={sv.tableHead}>Verzió</th>
              <th className={sv.tableHead}>Állapot</th>
              <th className={sv.tableHead}>Készítette</th>
              <th className={sv.tableHead}>Lezárta</th>
              <th className={sv.tableHead}>Indoklás</th>
              <th className={sv.tableHead}>Aláírás</th>
            </tr>
          </thead>
          <tbody>
            {worksheet.versions.map((version) => (
              <tr key={version.id} className={sv.tableRow}>
                <td className={`${sv.tableCell} text-ink`}>
                  {version.label ?? `${version.version}. verzió`}
                </td>
                <td className={sv.tableCell}>
                  <ServiceStatusBadge
                    tone={worksheetStatusTone(version.status)}
                  >
                    {worksheetStatusLabel[version.status]}
                  </ServiceStatusBadge>
                </td>
                <td className={`${sv.tableCell} text-ink`}>
                  {version.createdByName ?? "—"}
                  <div className={sv.rowMeta}>
                    {formatDateTime(version.createdAt)}
                  </div>
                </td>
                <td className={`${sv.tableCell} text-ink`}>
                  {version.closedByName ?? "—"}
                  <div className={sv.rowMeta}>
                    {formatDateTime(version.closedAt)}
                  </div>
                </td>
                <td
                  className={`${sv.tableCell} max-w-xs whitespace-pre-line text-ink`}
                >
                  {version.changeReason ?? "—"}
                </td>
                <td className={`${sv.tableCell} text-ink`}>
                  {version.signature ? (
                    <>
                      {`${version.signature.signerName} (${
                        version.signature.decision === "ACCEPTED"
                          ? "elfogadta"
                          : "elutasította"
                      })`}
                      {/*
                        A JELZES A SZERVERTOL JON, a TAROLT allapotbol -- nem
                        abbol, hogy a nev "ugy nez ki", mintha ugyfele lenne.
                        Harom eset van: listarol valasztott (nincs mondat), a
                        nevet beirtak (a lap kimondja), es a 2026-09-04 elotti
                        sorok (azokrol nem allitunk semmit).
                      */}
                      {version.signature.signerNotice ? (
                        <span className={`block pt-1 ${sv.rowMeta}`}>
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
    </section>
  );

  /**
   * AZ OSSZESITES A JOBB HASABBAN, ES NEM A TABLAZAT LABABAN.
   *
   * A prototipus itt hozza elore: a vegosszeg az, amiert az iroda megnyitja a
   * lapot, es a tablazat lababan addig nem latszik, amig valaki vegig nem
   * gordul a teteleken. A tablazat lableceben ezert MAR NEM all -- ket helyen
   * allo osszeg kesobb elcsuszna, es a masodikat senki nem javitana.
   */
  /*
    AZ "ÖSSZESÍTÉS" PANEL 2026-09-17-ÉN KIKERÜLT, mert mind a három sora ár volt
    (nettó, ÁFA, bruttó) -- Balázs döntése ("B") szerint azok sehol nem
    jelennek meg.

    ÜRES PANELT NEM HAGYOK A LAPON: egy fejléc tartalom nélkül azt mondja a
    nézőnek, hogy valami elromlott, holott döntés történt.

    ÉS A HELYE NEM MARAD ÜRESEN SOKÁIG: a #806-tal megjött az összesített
    MUNKAÓRA (`current.laborHours`), és Balázs ugyanabban a kérésében ezt kérte
    a lap végére. Az a következő szelet, szándékosan külön PR-ben -- az
    ár-elrejtés ELVESZ innen, a munkaóra HOZZÁAD, és a kettő egy PR-ben
    visszavonhatatlanul összeállna.
  */
  const summary = null;

  const facts = (
    <ServicePanel>
      <ServicePanelHeading title="Munkalap adatai" />
      <ServiceContextRow icon="building" label="Partner">
        {worksheet.customer.displayName}
      </ServiceContextRow>
      <ServiceContextRow icon="location" label="Alegység">
        {/*
          A TELJES UT, HA A SZERVER KULDI. A level neve onmagaban nem mondja
          meg, melyik agrol van szo: a kod es a nev csak TESTVEREK kozott
          egyedi, tehat ket tavoli ag alatt ugyanaz a "Biodóm (BIO)"
          megengedett. Balazs merte vissza 2026-09-16-an: itt `NMD —
          Nagymedence` allt, es abbol nem derult ki, melyik medence.

          A VISSZAESES A REGI ALAK, nem ures sor: a mezo elhagyhato, es egy
          regebbi valasz (vagy egy sorba tett, offline mentett lap) nem
          hordozza. Olyankor ugyanaz latszik, mint eddig.
        */}
        {worksheet.department.path?.length
          ? worksheet.department.path.join(" / ")
          : `${worksheet.department.code} — ${current.unitName ?? "—"}`}
      </ServiceContextRow>
      <ServiceContextRow icon="ticket" label="Hibajegy">
        {/*
          A HIÁNY IS ÁLLÍTÁS, ezért nem gondolatjel áll itt, mint a többi
          üres mezőnél: a lap keletkezhet hibajegy nélkül, és az nem
          hiányzó ADAT, hanem a folyamat egyik rendes állapota. Egy „—"
          azt sugallná, hogy valamit nem töltöttek ki.

          ÉS AMIÉRT ITT VAN EGYÁLTALÁN: hibajegy nélkül a lap nem
          zárható le - a felhasználó eddig csak azt látta, hogy nem megy,
          azt nem, hogy mi hiányzik hozzá.
        */}
        {worksheet.serviceJob ? (
          <Link
            href={`/szerviz/hibajegyek/${worksheet.serviceJob.id}`}
            className="hover:text-brand-700"
          >
            {worksheet.serviceJob.jobNumber}
          </Link>
        ) : (
          <span className="font-normal text-muted">Nincs mögötte hibajegy</span>
        )}
      </ServiceContextRow>
      <ServiceContextRow icon="clock" label="Keltezés">
        {formatDate(current.issueDate)}
      </ServiceContextRow>
      <ServiceContextRow icon="checkCircle" label="Teljesítés">
        {formatDate(current.fulfillmentDate)}
      </ServiceContextRow>
      <ServiceContextRow icon="clock" label="Határidő">
        {formatDate(current.dueDate)}
      </ServiceContextRow>
      <ServiceContextRow icon="users" label="Felvette">
        {worksheet.createdByName ?? "—"}
      </ServiceContextRow>
      {/* A SORSZAM A FEJLECBEN ALL, ITT A HANYADIK. Korabban a cimke allt itt
          is, es a fejlecben is -- ugyanaz a szoveg ketszer egy lapon nem
          megerosites, hanem zaj, es a kerdesre ("hanyadik verzio ez, es hany
          van osszesen") egyik sem valaszol. */}
      <ServiceContextRow icon="sheet" label="Verzió">
        {`${current.version}. verzió`}
        {worksheet.versions.length > 1
          ? ` · összesen ${worksheet.versions.length}`
          : ""}
      </ServiceContextRow>
    </ServicePanel>
  );

  return (
    <div>
      {/*
        IDE CSAK BETOLTOTT LAPPAL JUTUNK EL: a `!worksheet` ag fentebb kilep.
        Ezert `loaded` all itt allandoan, es NEM ternary -- egy ternary itt azt
        allitana, hogy a masik ag is elofordulhat, es egy rola szolo allitas
        orokre zold maradna. Az ures eset a KORAI agon all, sajat savval.
      */}
      <ServiceOfflineNotice state={{ kind: "loaded" }} />
      <ServiceBackLink href={backToList.href}>
        {backToList.fromWithinApp ? "Vissza" : "Munkalapok"}
      </ServiceBackLink>
      <ServiceDetailHeader
        eyebrow={worksheetLabelOrDraft(current.label)}
        title={current.subject}
        badge={
          <ServiceStatusBadge tone={worksheetStatusTone(current.status)}>
            {worksheetStatusLabel[current.status]}
          </ServiceStatusBadge>
        }
        sub={worksheet.customer.displayName}
        actions={
          <>
            {canManage && isDraft ? (
              <Link href={`/szerviz/munkalapok/${worksheet.id}/szerkesztes`}>
                <Button variant="secondary">Szerkesztés</Button>
              </Link>
            ) : null}
            {canManage && isDraft ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() => worksheetsApi.close(token, worksheet.id))
                }
              >
                Lezárás
              </Button>
            ) : null}
            {/* A signed sheet is final: the way onward is a new sheet, not a
                new version of this one. The button stands where the edit
                button would be, because that is where somebody looks when
                they want to carry on. */}
            {canManage && isSigned ? (
              <Button
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
              </Button>
            ) : null}
          </>
        }
      />
      {error ? (
        <Alert
          className="mb-5"
          variant="danger"
          title="Hiba"
          description={error}
        />
      ) : null}

      {/* Both ends of the chain, and the one pointing FORWARD is the reason
          this exists: whoever opens the old sheet has to be able to find where
          the work went, not just the other way round. */}
      {worksheet.continues ? (
        <Alert
          className="mb-5"
          variant="info"
          title="Ez a lap egy korábbi munkalap folytatása"
          description={
            worksheet.continues.number ?? "A korábbi lap még piszkozat."
          }
          action={
            <Link href={`/szerviz/munkalapok/${worksheet.continues.id}`}>
              <Button variant="secondary">Előzmény megnyitása</Button>
            </Link>
          }
        />
      ) : null}
      {worksheet.continuedBy.length ? (
        <Alert
          className="mb-5"
          variant="info"
          title="Ennek a lapnak van folytatása"
          description={worksheet.continuedBy
            .map((link) => link.number ?? "piszkozat")
            .join(", ")}
          action={
            <Link href={`/szerviz/munkalapok/${worksheet.continuedBy[0]!.id}`}>
              <Button variant="secondary">Folytatás megnyitása</Button>
            </Link>
          }
        />
      ) : null}

      <ServiceDetailSplit
        main={
          <>
            {current.description ? (
              <ServicePanel>
                <ServicePanelHeading title="A munka leírása" />
                <p className="whitespace-pre-line text-sm leading-[1.8] text-[#555062]">
                  {current.description}
                </p>
              </ServicePanel>
            ) : null}
            {lineRows}
            {signatureForm}
            {/*
              A MUNKANAPLO. Ugyanazok a funkciok, mint a telefonon (Balazs kerese,
              2026-09-03: "Ugyanezek a funkciok kellene a webes feluletre is"), es
              ugyanabbol a vegpontbol -- a ket felulet nem tud elcsuszni egymastol.

              A LAP ALLAPOTA NEM SZAMIT: alairt lapra is lehet bejegyzest irni. A
              naplo arrol szol, MI TORTENT, es a tiltas NEMAN veszitene el egy
              jegyzetet; az engedes LATSZIK, mert a bejegyzesen ott az idopont.
            */}
            <WorksheetEntries worksheetId={worksheet.id} canWrite={canManage} />
            {versionRows}
          </>
        }
        side={
          <>
            {summary}
            {facts}
            <WorksheetAssigneeEditor
              worksheetId={worksheet.id}
              token={token}
              assignees={worksheet.assignees}
              canManage={canManage}
              onSaved={setWorksheet}
            />
            {/*
              AZ ESZKOZOK A FELELOSOK ALATT, ES UGYANABBAN AZ ALAKBAN.

              A KETTO UGYANAZ A FAJTA ADAT: a MUNKALAP azonossagahoz tartozik,
              nem a verziohoz -- lezart lapon is javithato, es a
              verzio-eltéresben nem jelenik meg. Ket kulonbozo helyre teve a
              kezelo az egyiket megtalalna, a masikat nem.

              ES AMIT EZ A DOBOZ ELOSZOR MUTAT MEG: magat a listat. A csatolt
              eszkozok 2026-09-15 ota bekerultek az adatbazisba, es SEHOL nem
              latszottak -- meg a sajat lapjukon sem.
            */}
            <WorksheetAssetEditor
              worksheetId={worksheet.id}
              token={token}
              departmentId={worksheet.department.id}
              assets={worksheet.assets}
              canManage={canManage}
              onSaved={setWorksheet}
            />
            {/*
              A CSATOLMANYOK AZ ESZKOZOK ALATT.

              A MEGNEZES `service.view` alatt all, nem `service.manage` alatt:
              aki a lapot latja, a hozza tartozo fenykepeket is lathatja. A
              helyszini kep MUNKAUTASITAS, nem szerkesztes.

              ES AMIT EZ A DOBOZ ELOSZOR MUTAT MEG: magat a listat. A telefonrol
              feltoltott fenykepek eddig SEHOL nem latszottak a weben -- a lapon
              a "documents" szo egyszer sem fordult elo.
            */}
            <WorksheetDocuments
              worksheetId={worksheet.id}
              token={token}
              canView={canView}
            />
          </>
        }
      />
    </div>
  );
}
