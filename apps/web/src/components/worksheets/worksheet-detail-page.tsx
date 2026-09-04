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
import { useReturnTo } from "@/components/navigation-history";
import { worksheetsApi } from "@/lib/api/worksheets";
import { WorksheetEntries } from "./worksheet-entries";
import { WorksheetAssigneeEditor } from "./worksheet-assignee-editor";
import {
  formatAmount,
  MISSING_AMOUNT,
  formatDate,
  formatDateTime,
  worksheetLabelOrDraft,
  worksheetStatusLabel,
  worksheetStatusVariant,
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
    return (
      <Alert
        variant="danger"
        title="A munkalap nem tölthető be"
        description={error ?? "Ismeretlen hiba."}
      />
    );

  const current = worksheet.currentVersion;
  const isDraft = current.status === "DRAFT";
  const isSigned = current.status === "SIGNED";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Szerviz / Munkalap"
        title={worksheetLabelOrDraft(current.label)}
        description={current.subject}
        actions={
          <div className="flex gap-2">
            <Link href={backToList.href}>
              <Button variant="secondary">
                {backToList.fromWithinApp ? "Vissza" : "Vissza a listához"}
              </Button>
            </Link>
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
          </div>
        }
      />
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}

      {/* Both ends of the chain, and the one pointing FORWARD is the reason
          this exists: whoever opens the old sheet has to be able to find where
          the work went, not just the other way round. */}
      {worksheet.continues ? (
        <Alert
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

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={worksheetStatusVariant(current.status)}>
              {worksheetStatusLabel[current.status]}
            </Badge>
            <span className="text-sm text-slate-500">
              {worksheet.versions.length} verzió
            </span>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Partner</dt>
              <dd className="font-medium">{worksheet.customer.displayName}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Alegység</dt>
              <dd className="font-medium">
                {worksheet.department.code} — {current.unitName ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Keltezés</dt>
              <dd>{formatDate(current.issueDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Teljesítés</dt>
              <dd>{formatDate(current.fulfillmentDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Határidő</dt>
              <dd>{formatDate(current.dueDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Felvette</dt>
              <dd>{worksheet.createdByName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Hibajegy</dt>
              {/*
                A HIÁNY IS ÁLLÍTÁS, ezért nem gondolatjel áll itt, mint a többi
                üres mezőnél: a lap keletkezhet hibajegy nélkül, és az nem
                hiányzó ADAT, hanem a folyamat egyik rendes állapota. Egy „—"
                azt sugallná, hogy valamit nem töltöttek ki.

                ÉS AMIÉRT ITT VAN EGYÁLTALÁN: hibajegy nélkül a lap nem
                zárható le - a felhasználó eddig csak azt látta, hogy nem megy,
                azt nem, hogy mi hiányzik hozzá.
              */}
              <dd className="font-medium">
                {worksheet.serviceJob ? (
                  <Link
                    href={`/szerviz/hibajegyek/${worksheet.serviceJob.id}`}
                    className="hover:text-teal-700"
                  >
                    {worksheet.serviceJob.jobNumber}
                  </Link>
                ) : (
                  <span className="font-normal text-slate-500">
                    Nincs mögötte hibajegy
                  </span>
                )}
              </dd>
            </div>
          </dl>
          {current.description ? (
            <p className="whitespace-pre-line text-sm text-slate-700">
              {current.description}
            </p>
          ) : null}
        </Card>

        <WorksheetAssigneeEditor
          worksheetId={worksheet.id}
          token={token}
          assignees={worksheet.assignees}
          canManage={canManage}
          onSaved={setWorksheet}
        />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">#</th>
              <th>Megnevezés</th>
              <th className="text-right">Mennyiség</th>
              <th>Egység</th>
              <th className="text-right">Egységár</th>
              <th className="text-right">ÁFA %</th>
              <th className="p-3 text-right">Nettó</th>
            </tr>
          </thead>
          <tbody>
            {current.lines.map((line) => (
              <tr key={line.id} className="border-b last:border-0">
                <td className="p-3">{line.position}</td>
                <td>
                  <div className="font-medium">{line.description}</div>
                  {line.detail ? (
                    <div className="text-xs text-slate-500">{line.detail}</div>
                  ) : null}
                  {line.assetNumber ? (
                    <div className="font-mono text-xs text-slate-500">
                      {line.assetNumber}
                    </div>
                  ) : null}
                  {/* AZ UGYFEL SAJAT KODJA, csak ha van, es FELIRATTAL. A
                      felette allo eszkozszam a MIENK, ez pedig az ugyfele:
                      ket csupasz kod egymas alatt pont azt a keveredest
                      hozna, ami ellen a mezo kulon nevet kapott. */}
                  {line.inventoryNumber ? (
                    <div className="text-xs text-slate-500">
                      Leltári szám:{" "}
                      <span className="font-mono">{line.inventoryNumber}</span>
                    </div>
                  ) : null}
                </td>
                <td className="text-right tabular-nums">{line.quantity}</td>
                <td>{line.unit}</td>
                <td className="text-right tabular-nums">
                  {formatAmount(line.unitNet, current.currency)}
                </td>
                <td className="text-right tabular-nums">
                  {line.vatRatePercent ?? MISSING_AMOUNT}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {formatAmount(line.netAmount, current.currency)}
                </td>
              </tr>
            ))}
            {current.lines.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500" colSpan={7}>
                  Nincs tétel. Tétel nélküli munkalap nem zárható le.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot className="border-t bg-slate-50 text-sm">
            <tr>
              <td className="p-3" colSpan={6}>
                Nettó / ÁFA / Bruttó
              </td>
              <td className="p-3 text-right tabular-nums">
                {formatAmount(current.netAmount, current.currency)} /{" "}
                {formatAmount(current.vatAmount, current.currency)} /{" "}
                <strong>
                  {formatAmount(current.grossAmount, current.currency)}
                </strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>

      {canManage && current.status === "AWAITING_SIGNATURE" ? (
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold text-slate-800">
            Ügyfél döntésének rögzítése
          </h2>
          <p className="text-xs text-slate-500">
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
                <p className="pt-1 text-xs text-slate-500">
                  {signers.emptyReason}
                </p>
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
                <p className="pt-1 text-xs text-slate-500">
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
                <p className="pt-1 text-xs text-slate-500">
                  A lapon látszani fog, hogy a nevet te írtad be, és nem a
                  partner nyilvántartott munkatársa írta alá.
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
            /**
             * A NEV CSAK AZ "EGYIK SEM" AGON KOTELEZO. Listarol valasztva a
             * nevet a SZERVER veszi a valasztott sorbol -- egy itteni kapu
             * olyan mezot kovetelne, ami fel sem megy.
             */
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
        </Card>
      ) : null}

      {/*
        A MUNKANAPLO. Ugyanazok a funkciok, mint a telefonon (Balazs kerese,
        2026-09-03: "Ugyanezek a funkciok kellene a webes feluletre is"), es
        ugyanabbol a vegpontbol -- a ket felulet nem tud elcsuszni egymastol.

        A LAP ALLAPOTA NEM SZAMIT: alairt lapra is lehet bejegyzest irni. A
        naplo arrol szol, MI TORTENT, es a tiltas NEMAN veszitene el egy
        jegyzetet; az engedes LATSZIK, mert a bejegyzesen ott az idopont.
      */}
      <WorksheetEntries worksheetId={worksheet.id} canWrite={canManage} />

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">Verzió</th>
              <th>Állapot</th>
              <th>Készítette</th>
              <th>Lezárta</th>
              <th>Indoklás</th>
              <th className="p-3">Aláírás</th>
            </tr>
          </thead>
          <tbody>
            {worksheet.versions.map((version) => (
              <tr key={version.id} className="border-b last:border-0">
                <td className="p-3">
                  {version.label ?? `${version.version}. verzió`}
                </td>
                <td>
                  <Badge variant={worksheetStatusVariant(version.status)}>
                    {worksheetStatusLabel[version.status]}
                  </Badge>
                </td>
                <td>
                  {version.createdByName ?? "—"}
                  <div className="text-xs text-slate-500">
                    {formatDateTime(version.createdAt)}
                  </div>
                </td>
                <td>
                  {version.closedByName ?? "—"}
                  <div className="text-xs text-slate-500">
                    {formatDateTime(version.closedAt)}
                  </div>
                </td>
                <td className="max-w-xs whitespace-pre-line">
                  {version.changeReason ?? "—"}
                </td>
                <td className="p-3">
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
                        <span className="block pt-1 text-xs text-slate-500">
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
      </Card>
    </div>
  );
}
