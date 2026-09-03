"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FormField,
  PageHeader,
  Skeleton,
  Textarea,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ServiceJobDetail,
  type ServiceJobStatusValue,
  type ServiceJobTimelineEntry,
  type WorksheetAttachableItem,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { worksheetsApi } from "@/lib/api/worksheets";
import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import { PartnerPicker } from "./partner-picker";
import {
  serviceJobNoteDescription,
  serviceJobStatusLabel,
  serviceJobStatusVariant,
} from "./service-job-labels";

/**
 * EGY NAPLÓSOR SZÖVEGE.
 *
 * Külön függvény, mert a naplónak HÁROM forrása van, és a három sor egy
 * mondatban olvasható. A szöveg nem a komponensben áll, hogy a mondat
 * felépítése tesztelhető legyen anélkül, hogy fel kellene rajzolni az oldalt.
 */
function timelineLine(entry: ServiceJobTimelineEntry): string {
  if (entry.kind === "status") {
    const to = serviceJobStatusLabel[entry.event.toStatus];
    if (entry.event.fromStatus === null) return `A hibajegy létrejött (${to}).`;
    const from = serviceJobStatusLabel[entry.event.fromStatus];
    return `${from} → ${to}`;
  }
  if (entry.kind === "worksheet")
    return `Munkalap a jegy alatt: ${entry.worksheet.number ?? "piszkozat"}`;
  return `Eszköz a jegyen: ${entry.asset.assetNumber} (${entry.asset.assetName})`;
}

/**
 * A HIBAJEGY RÉSZLETLAPJA: A JEGY, ÉS AMI TÖRTÉNT VELE.
 *
 * EZ SZERKEZET, NEM TERV. A legegyszerűbb alak, ami a menetet végigviszi:
 * lista, részlet, lépés. Hogy a képernyő végül hogyan nézzen ki, az nem itt
 * dől el - de amíg nincs semmi, addig nincs miről beszélni.
 *
 * A NAPLÓ HÁROM FORRÁSBÓL ÁLL ÖSSZE (állapotváltás, munkalap, eszköz), de az
 * összefésülés NEM itt történik: a szerver adja vissza már egy időrendben. A
 * sorrend szabály, és a mobil nem is éri el a közös csomagot - ott a fésülés
 * újraíródna, két kliens, két sorrend, és a különbség néma. A kliens rajzol.
 */
export function ServiceJobDetailPage({ jobId }: { jobId: string }) {
  const { session } = useAuth();
  const [job, setJob] = useState<ServiceJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [stepping, setStepping] = useState(false);
  const [note, setNote] = useState("");
  const [attachable, setAttachable] = useState<WorksheetAttachableItem[]>([]);
  const [chosenSheet, setChosenSheet] = useState("");
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [sheetToDetach, setSheetToDetach] = useState<string | null>(null);
  const [partnerError, setPartnerError] = useState<string | null>(null);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const token = session?.token ?? "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setJob(await serviceJobsApi.detail(token, jobId, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A hibajegy nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, jobId, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /**
   * A VALASZTO-LISTA KULON TOLTODIK, es a hibaja NEM allitja meg az oldalt: a
   * jegy elolvasasahoz nincs szukseg ra. Ha nem jon meg, a csatolo doboz marad
   * ures - a naplo, a lepesek es a lapok attol meg olvashatok.
   */
  /**
   * PARTNER NELKUL NEM KERJUK LE, es ez nem takarekossag: a lista a jegy
   * partnerere szukul, tehat partner nelkul nincs mire szukiteni. Egy ures
   * valaszto ott ugy nezne ki, mintha nem lenne mit csatolni -- holott a
   * csatolas amugy is elutasitana, sajat mondattal.
   */
  const jobCustomerId = job?.customerId ?? null;
  useEffect(() => {
    if (!canManage || jobCustomerId === null) return;
    const controller = new AbortController();
    worksheetsApi
      .attachable(token, jobCustomerId, controller.signal)
      .then((response) => setAttachable(response.items))
      .catch(() => undefined);
    return () => controller.abort();
  }, [canManage, jobCustomerId, token]);

  /**
   * A LÉPÉS UTÁN ÚJRATÖLTÜNK, nem a válaszból építünk.
   *
   * A `move` csak nyugtát ad. Ha a képernyőt abból raknánk össze, a napló új
   * sora hiányozna róla - és épp az a sor a bizonyíték, hogy a lépés megtörtént.
   */
  const step = async (to: ServiceJobStatusValue) => {
    setStepping(true);
    setStepError(null);
    try {
      await serviceJobsApi.move(token, jobId, {
        to,
        note: note.trim() || null,
      });
      /**
       * A MEZO CSAK SIKERES LEPES UTAN URUL. Ha a hivas elbukik (halozat,
       * utkozes, elutasitas), a felhasznalo begepelt szovege ottmarad -- egy
       * elveszett indokot ujra le kellene irni, es a masodik nekifutas
       * rovidebb lenne, mint az elso.
       */
      setNote("");
      await load();
    } catch (cause) {
      setStepError(
        cause instanceof Error ? cause.message : "A lépés nem sikerült.",
      );
    } finally {
      setStepping(false);
    }
  };

  /**
   * A VALASZTO-LISTA UJRAKERESE, EGY HELYEN.
   *
   * A `?? ""` NEM JO ALAK IDE: ures azonositoval a vegpont elhasalna (a
   * parameter kotelezo), a hivo `catch` aga pedig elnyelne -- a lista csendben
   * regi maradna. Partner nelkul ezert NEM kerunk, es a lista sem valtozik: az
   * az allapot amugy sem all elo, mert csatolni sem lehet partner nelkul.
   */
  const refreshAttachable = async () => {
    if (jobCustomerId === null) return;
    const response = await worksheetsApi.attachable(token, jobCustomerId);
    setAttachable(response.items);
  };

  /**
   * A PARTNER POTLASA -- A FELVITEL VISSZAUTJA.
   *
   * A felvitel nem koveteli meg a partnert; a csatolas viszont igen. Enelkul a
   * gomb nelkul egy partner nelkul megnyitott jegy BENT RAGADNA: soha nem tudna
   * lapot fogadni, es a feluleten nem lenne kiut.
   */
  const setPartner = async (customerId: string) => {
    setPartnerError(null);
    try {
      await serviceJobsApi.setPartner(token, jobId, customerId);
      await load();
    } catch (cause) {
      setPartnerError(
        cause instanceof Error
          ? cause.message
          : "A partner beállítása nem sikerült.",
      );
    }
  };

  const detach = async (worksheetId: string) => {
    setSheetToDetach(null);
    setAttaching(true);
    setAttachError(null);
    try {
      await serviceJobsApi.detachWorksheet(token, jobId, worksheetId);
      // A LEVALASZTOTT LAP UJRA SZABAD, tehat a valaszto-listaba is
      // visszakerul -- mindkettot ujra kell kerni.
      await Promise.all([load(), refreshAttachable()]);
    } catch (cause) {
      setAttachError(
        cause instanceof Error ? cause.message : "A leválasztás nem sikerült.",
      );
    } finally {
      setAttaching(false);
    }
  };

  const attach = async () => {
    if (!chosenSheet) return;
    setAttaching(true);
    setAttachError(null);
    try {
      await serviceJobsApi.attachWorksheet(token, jobId, chosenSheet);
      setChosenSheet("");
      // UJRATOLTUNK MINDKETTOT: a jegy naploja es a valaszto-lista is
      // megvaltozott - a csatolt lap onnantol nem szabad.
      await Promise.all([load(), refreshAttachable()]);
    } catch (cause) {
      setAttachError(
        cause instanceof Error ? cause.message : "A csatolás nem sikerült.",
      );
    } finally {
      setAttaching(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a hibajegyekhez"
        description="service.view jogosultság szükséges."
      />
    );

  if (loading && !job)
    return (
      <div className="space-y-3" aria-label="Hibajegy betöltése">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );

  if (error)
    return (
      <Alert
        variant="danger"
        title="Betöltési hiba"
        description={error}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Újrapróbálás
          </Button>
        }
      />
    );

  if (!job) return null;

  // A MUNKALAP-SZAKASZ A NAPLÓBÓL SZŰR, nem külön listából: a végpont egy
  // időrendet ad, és ez a doboz csak MÁS NÉZETE ugyanannak. Egy második lista
  // a válaszban két helyen tartaná ugyanazt az adatot.
  const worksheets = job.timeline.flatMap((entry) =>
    entry.kind === "worksheet" ? [entry.worksheet] : [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Hibajegy"
        title={`${job.jobNumber} - ${job.title}`}
        description={job.customerName ?? "Partner nincs megadva"}
        actions={
          <Link href="/szerviz/hibajegyek">
            <Button variant="secondary">Vissza a listára</Button>
          </Link>
        }
      />

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={serviceJobStatusVariant(job.partnerStatus)}>
            {serviceJobStatusLabel[job.status]}
          </Badge>
          <span className="text-xs text-slate-500">
            A partner ezt látja: {job.partnerStatusLabel}
          </span>
          <span className="text-xs text-slate-500">
            Létrehozva: {formatDateTime(job.createdAt)}
          </span>
        </div>
        {job.description ? (
          <p className="whitespace-pre-wrap text-sm">{job.description}</p>
        ) : null}
      </Card>

      {canManage ? (
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Következő lépés</h2>
          {stepError ? (
            <Alert
              variant="danger"
              title="A lépés nem ment"
              description={stepError}
            />
          ) : null}
          {job.allowedSteps.length ? (
            <>
              <FormField
                label="Megjegyzés"
                description={serviceJobNoteDescription(job.allowedSteps)}
              >
                <Textarea
                  aria-label="Megjegyzés a lépéshez"
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={2000}
                />
              </FormField>
              {/*
                EGYETLEN GOMB SEM VAR SZOVEGRE. A megjegyzes minden atmenetnel
                elhagyhato (Balazs dontese, 2026-09-03), tehat a `disabled`
                egyedul a folyamatban levo hivasrol szol.
              */}
              <div className="flex flex-wrap gap-2">
                {job.allowedSteps.map((to) => (
                  <Button
                    key={to}
                    variant="secondary"
                    disabled={stepping}
                    onClick={() => void step(to)}
                  >
                    {serviceJobStatusLabel[to]}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            /* A LEZÁRT JEGYEN NEM ÜRES A DOBOZ, hanem meg van mondva, miért.
               Egy eltűnt gombsor úgy néz ki, mint egy betöltési hiba. */
            <p className="text-sm text-slate-500">
              Ez a hibajegy lezárult, nincs több lépése.
            </p>
          )}
        </Card>
      ) : null}

      {/*
        A HIANY MELLE A KIUT. Egy partner nelkuli jegy ma nem tud lapot fogadni,
        es enelkul a doboz nelkul ezt csak a csatolasnal tudna meg a felhasznalo
        -- egy masik kepernyon, es kiut nelkul.
      */}
      {canManage && job.customerName === null ? (
        <Card className="space-y-2 p-4">
          <label className="block text-sm font-semibold" htmlFor="jegy-partner">
            Partner beállítása
          </label>
          <p className="text-xs text-slate-500">
            Ehhez a hibajegyhez még nincs partner, ezért munkalapot sem lehet
            alá csatolni.
          </p>
          {partnerError ? (
            <Alert
              variant="danger"
              title="Nem sikerült"
              description={partnerError}
            />
          ) : null}
          <PartnerPicker
            id="jegy-partner"
            onPick={(picked) => void setPartner(picked.customerId)}
          />
        </Card>
      ) : null}

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">Ami történt</h2>
        {job.timeline.length ? (
          <ol className="space-y-2" aria-label="A hibajegy naplója">
            {job.timeline.map((entry) => (
              <li
                key={`${entry.kind}-${entry.sortKey}`}
                className="border-b pb-2 text-sm last:border-0"
              >
                <div>{timelineLine(entry)}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {formatDateTime(entry.at)}
                  {entry.kind === "status" && entry.event.actorName
                    ? ` · ${entry.event.actorName}`
                    : ""}
                </div>
                {entry.kind === "status" && entry.event.note ? (
                  <div className="mt-1 whitespace-pre-wrap text-sm">
                    {entry.event.note}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            title="Nincs bejegyzés"
            description="Ezen a jegyen még nem történt semmi."
          />
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">Munkalapok a jegy mögött</h2>
        {worksheets.length ? (
          <ul className="space-y-1 text-sm">
            {worksheets.map((worksheet) => (
              <li key={worksheet.id}>
                <Link
                  href={`/szerviz/munkalapok/${worksheet.id}`}
                  className="font-medium hover:text-teal-700"
                >
                  {worksheet.number ?? "Piszkozat"}
                </Link>
                <span className="ml-2 text-xs text-slate-500">
                  {worksheet.handedOverAt
                    ? `Átadva: ${formatDateTime(worksheet.handedOverAt)}`
                    : "Még nálunk van"}
                </span>
                {/* A VISSZAUT OTT ALL, AHOL A HIBA LATSZIK: a lap mellett,
                    nem egy kulon felulet menujeben. Aki eszreveszi, hogy rossz
                    lapot csatolt, ugyanabban a sorban tudja levenni. */}
                {canManage ? (
                  <button
                    type="button"
                    className="ml-2 text-xs text-slate-500 underline hover:text-teal-700"
                    disabled={attaching}
                    onClick={() => setSheetToDetach(worksheet.id)}
                  >
                    Leválasztás
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            Ehhez a jegyhez még nem tartozik munkalap.
          </p>
        )}

        {/*
          A CSATOLAS A JEGY OLDALAN VAN, mert a folyamat is innen nez ki igy: a
          szerelo helyben felveszi a lapot, atadja, es a jegy NALUNK szuletik meg
          utolag - a felelos akkor veszi hozza a mar meglevo lapot.

          A VALASZTO CSAK A SZABAD LAPOKAT KINALJA (amik alatt nincs jegy), es
          semmilyen allapot szerint nem szur: a lezart lap is csatolhato, mert a
          lezaras a DOKUMENTUMROL szol, a csatolas a BESOROLASROL.
        */}
        {canManage ? (
          <div className="space-y-2 border-t pt-3">
            <label
              className="block text-sm font-semibold"
              htmlFor="csatolando-munkalap"
            >
              Meglévő munkalap csatolása
            </label>
            {attachError ? (
              <Alert
                variant="danger"
                title="A csatolás nem ment"
                description={attachError}
              />
            ) : null}
            {attachable.length ? (
              <div className="flex flex-wrap gap-2">
                <select
                  id="csatolando-munkalap"
                  className="rounded border px-2 py-1 text-sm"
                  value={chosenSheet}
                  onChange={(event) => setChosenSheet(event.target.value)}
                >
                  <option value="">Válassz munkalapot</option>
                  {attachable.map((sheet) => (
                    <option key={sheet.id} value={sheet.id}>
                      {sheet.number ?? "Piszkozat"} - {sheet.customerName} -{" "}
                      {sheet.subject}
                    </option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  disabled={!chosenSheet || attaching}
                  onClick={() => void attach()}
                >
                  Csatolás
                </Button>
              </div>
            ) : (
              /* A HIANY IS ALLITAS: egy eltunt valaszto ugy nezne ki, mint egy
                 betoltesi hiba.

                 ES A MONDAT MINDKET FELTETELT MEGNEVEZI. A lista MA ket dologra
                 szur: a lap legyen szabad, ES a jegy partnereé. A regi mondat
                 csak az elsot mondta ki, tehat a szuro bevezetese utan hamis
                 lenne: lehet szabad lap boven, csak MAS partnere. Egy mondat,
                 ami ket kulonbozo allapotbol is elohivhato, a kettot osszemossa
                 -- es a felhasznalo azt hinne, egyaltalan nincs szabad lap. */
              <p className="text-sm text-slate-500">
                Ehhez a partnerhez nincs olyan munkalap, ami még egyik
                hibajegyhez sem tartozik.
              </p>
            )}
          </div>
        ) : null}
      </Card>
      {/*
        A KERDES HAROM RESZE, ES A HARMADIK ITT NEM UDVARIASSAG: a levalasztas
        VISSZAFORDITHATO, es ezt ki kell mondani. Egy kerdes, ami nem mondja
        meg, van-e visszaut, ugyanugy megijeszt egy artalmatlan lepesnel, mint
        egy veglegesnel -- es akkor a kovetkezo kerdest mar nem olvassa el senki.
      */}
      <ConfirmDialog
        open={sheetToDetach !== null}
        title="Leválasztod ezt a munkalapot a hibajegyről?"
        consequence="A lap kikerül a jegy alól, és a jegy naplójából is eltűnik a sora."
        recovery="Visszatehető: a lap újra szabaddá válik, és ugyanitt bármikor visszacsatolható."
        confirmLabel="Leválasztás"
        busy={attaching}
        onConfirm={() => {
          if (sheetToDetach !== null) void detach(sheetToDetach);
        }}
        onCancel={() => setSheetToDetach(null)}
      />
    </div>
  );
}
