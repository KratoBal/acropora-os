"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ServiceDataGrid,
  ServiceDataItem,
  ServiceDetailHeader,
  ServiceDetailSplit,
  ServiceIcon,
  ServicePanel,
  ServicePanelHeading,
  ServiceStatusBadge,
} from "@acropora/ui";
import {
  worksheetStatusLabel,
  worksheetStatusTone,
  type WorksheetDetail as Munkalap,
  type WorksheetLineDetail,
  type WorksheetVersionSummary,
} from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { DocumentPanel } from "./document-panel";
import { Message } from "./ticket-list";

/**
 * A MUNKALAP ADATLAPJA A PARTNER PORTÁLON.
 *
 * === MI KERÜL RÁ, ÉS MI NEM (Balázs kérése, 2026-09-21) ===
 *
 * Szó szerint: „sot: ugyanaz legyen a hibajegy es a munkalap oldal is", és
 * „csak ott megtudja csinalni azt amihez jogosultsaga van". A tartalom tehát a
 * belső lapé (`apps/web/.../worksheet-detail-page.tsx`), a kezelői
 * műveletek viszont nem kerülnek át.
 *
 * === AMI SZÁNDÉKOSAN NEM KERÜL ÁT, ÉS MIND A KETTŐNEK MÁS AZ INDOKA ===
 *
 * 1. A MUNKANAPLÓ (`WorksheetEntries`). Ez NEM a mi döntésünk: a végpont saját
 *    megjegyzése mondja ki, hogy „a bejegyzes a MI munkanaplonk, es Balazs nem
 *    kerte, hogy a partner lassa" (`worksheets.controller.ts`, a `:id/entries`
 *    ág fölött). Tehát ez a hiány ELDÖNTÖTT dolog, nem elmaradt munka.
 *
 * 2. A TÉTELEK SZERKESZTÉSE, A FELELŐSÖK ÉS AZ ESZKÖZÖK SZERKESZTÉSE, AZ
 *    ANYAGIGÉNYLÉS. Ezek a belső lapon `canManage` mögött állnak, és a
 *    partner szerepe MA VISELI a `SERVICE_MANAGE` jogot (`auth.ts:388`) --
 *    vagyis a szerver átengedné. EZ NEM JOGOSULTSÁG-FÜGGŐ MEGJELENÍTÉS, LEZÁRT
 *    DÖNTÉS: lásd az `asset-detail.tsx` fejlécében a pontos indoklást (a
 *    `PARTNER_SERVICE` szerep MA `SERVICE_MANAGE`-et is visel, tehát egy
 *    jogosultság-alapú megjelenítés MA szerkesztést adna a partnernek, amit ő
 *    nem kért). A `portal-wiring.spec.ts` erre nevesített állítást tartalmaz.
 *
 * === AZ ÖSSZEGEK SEHOL NEM JELENNEK MEG, ÉS EZ SEM ITT DŐLT EL ===
 *
 * A válasz hordozza a nettó, áfa és bruttó mezőket, a BELSŐ lapról viszont
 * 2026-09-17-én kikerültek, Balázs döntésére: „a nettó, bruttó és áfa mezők
 * sehol nem jelennek meg" (#809). A portál tehát nem azért hagyja el őket,
 * mert partneri felület, hanem mert sehol nem jelennek meg.
 *
 * === AMIT VISZONT KÍNÁLUNK ===
 *
 * Az aláírás (ha a partner az aláíró) és a fájl-csatolás. Mind a kettő a
 * korábbi köreinkben épült meg.
 *
 * === AZ ELRENDEZÉS A BELSŐ RENDSZERÉ, A KÖZÖS KERETRE ÁLLVA (2026-09-24) ===
 *
 * Murena #1041-e (`ticket-portal-visual-parity`) átköltöztette a
 * `ServiceDetailHeader`/`ServicePanel`/`ServiceDataItem`/`ServiceDetailSplit`
 * keretet `apps/web`-ből `packages/ui`-ba. Ez a lap ugyanazokat a
 * komponenseket használja, mint az `asset-detail.tsx` és a
 * `ticket-detail.tsx` -- nem egy saját, párhuzamos Tailwind-közelítést.
 * A TARTALOM VÁLTOZATLAN: ugyanazok az adatsorok, ugyanabban a sorrendben.
 */
export function WorksheetDetail({ id }: { id: string }) {
  const [worksheet, setWorksheet] = useState<Munkalap | null>(null);
  const [documents, setDocuments] = useState<
    Awaited<ReturnType<typeof partnerApi.worksheetDocuments>>["items"]
  >([]);
  const [signers, setSigners] = useState<Awaited<
    ReturnType<typeof partnerApi.worksheetSigners>
  > | null>(null);
  const [signerUserId, setSignerUserId] = useState("");
  const [signatureCode, setSignatureCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, documentList, signerList] = await Promise.all([
        partnerApi.worksheet(id),
        partnerApi.worksheetDocuments(id),
        partnerApi.worksheetSigners(id),
      ]);
      setWorksheet(detail);
      setDocuments(documentList.items);
      setSigners(signerList);
      /*
        EGY VALASZTHATO ALAIRONAL ELORE KIVALASZTJUK -- ES EZ NEM KENYELEM.

        A szerver 2026-09-21 ota a KEROre szukiti a listat (külsős partner csak
        a sajat neveben irhat ala). A valaszto igy egy elemu, es a beküldés
        `if (!signerUserId) return;` agon all: aki nem nyitja le a legordulot,
        megnyomja a gombot, ES NEM TORTENIK SEMMI -- hibauzenet nelkul.

        Egy nema no-op rosszabb, mint egy hibauzenet: a felhasznalo azt hiszi,
        a rendszer romlott el.
      */
      if (signerList.items.length === 1)
        setSignerUserId(signerList.items[0]!.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A munkalap nem tölthető be.",
      );
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function sign(event: React.FormEvent) {
    event.preventDefault();
    if (!signerUserId) return;
    setSigning(true);
    setError(null);
    try {
      await partnerApi.signWorksheet(id, signerUserId, signatureCode);
      setSignatureCode("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az aláírás nem rögzíthető.",
      );
    } finally {
      setSigning(false);
    }
  }

  if (error && !worksheet)
    return (
      <section>
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </section>
    );
  if (!worksheet)
    return <p className="text-xs text-muted">Munkalap betöltése…</p>;
  const current = worksheet.currentVersion;
  const signature = current.signature;
  /**
   * AZ ALAIRAS-URLAP KET FELTETELHEZ KOTODIK, ES 2026-09-21-IG EGYIKHEZ SEM.
   *
   * Addig az egyetlen feltetel az volt, hogy MAR ALAIRTAK-E. Vagyis az urlap
   * PISZKOZATON IS megjelent (a partner-lista nem szur allapotra), es minden
   * lezart lapon is -- akkor is, ha soha nem kuldtuk ki senkinek.
   *
   * Balazs ezt be is jelentette: "van egy nyitott munkalap, amit ala tudna irni
   * ha akarna". A szerver a piszkozatot elutasitja, tehat ott hangos hiba jon;
   * a lezart-de-ki-nem-kuldott lapot viszont ELFOGADTA.
   *
   * A KET FELTETEL UGYANAZ, AMIT A SZERVER KAPUJA NEZ (`worksheets.repository`
   * `sign` aga): kiallitott lap ES kikuldve alairasra. Ez nem ket szabaly ket
   * helyen -- a szervere a donto, ez csak azt zarja ki, hogy a felulet olyat
   * kinaljon fel, amit a szerver elutasit.
   *
   * ES A DATUMRA KAPUZ, NEM A NEVRE: a cimzett fiokja torolheto, a kikuldes
   * tenye viszont megmarad. Egy torolt cimzett nem teheti ujra
   * alairhatatlanna a lapot.
   */
  const alairhato =
    current.status === "AWAITING_SIGNATURE" &&
    current.sentForSignatureAt !== null;
  return (
    <section>
      <VisszaLink />
      <ServiceDetailHeader
        eyebrow={worksheet.number ?? "PISZKOZAT"}
        title={current.subject}
        badge={
          <ServiceStatusBadge tone={worksheetStatusTone(current.status)}>
            {worksheetStatusLabel[current.status]}
          </ServiceStatusBadge>
        }
        sub={
          worksheet.department.path?.join(" / ") ?? worksheet.department.name
        }
      />
      {error ? (
        <div className="mb-5">
          <Message tone="error" text={error} />
        </div>
      ) : null}

      {/*
        A LÁNC MIND A KÉT VÉGE, ÉS AZ ELŐRE MUTATÓ AZ INDOK: aki a régi lapot
        nyitja meg, meg kell találja, hova ment a munka -- nem csak fordítva.
      */}
      {worksheet.continues ? (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Ez a lap egy korábbi munkalap folytatása:{" "}
          <Link
            className="font-medium underline"
            href={`/munkalapok/${worksheet.continues.id}`}
          >
            {worksheet.continues.number ?? "a korábbi lap még piszkozat"}
          </Link>
        </p>
      ) : null}
      {worksheet.continuedBy.length ? (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Ennek a lapnak van folytatása:{" "}
          {worksheet.continuedBy.map((lanc, index) => (
            <span key={lanc.id}>
              {index > 0 ? ", " : ""}
              <Link
                className="font-medium underline"
                href={`/munkalapok/${lanc.id}`}
              >
                {lanc.number ?? "piszkozat"}
              </Link>
            </span>
          ))}
        </p>
      ) : null}

      <ServiceDetailSplit
        main={
          <>
            <ServicePanel>
              <ServicePanelHeading title="A munka leírása" />
              <p className="whitespace-pre-line text-sm leading-[1.7] text-dusk-700">
                {current.description ?? "Nem rögzítettek részletes leírást."}
              </p>
            </ServicePanel>

            <Tetelek lines={current.lines} />

            {signature ? (
              <ServicePanel>
                <ServicePanelHeading title="Aláírva" />
                <p className="text-sm text-ink">
                  {signature.signerName} · {idopont(signature.signedAt)}
                </p>
                {signature.signerNotice ? (
                  <p className="mt-1 text-sm text-muted">
                    {signature.signerNotice}
                  </p>
                ) : null}
                {signature.note ? (
                  <p className="mt-1 whitespace-pre-line text-sm text-ink">
                    {signature.note}
                  </p>
                ) : null}
              </ServicePanel>
            ) : !alairhato ? (
              /*
                ES NEM CSAK ELREJTJUK: MEGMONDJUK, MIERT. Egy eltuno urlap
                ugyanugy nez ki, mint egy elromlott lap -- a partner nem tudja,
                ra var-e valami. A ket eset KET KULON mondatot kap, mert MAS a
                teendo: a piszkozatnal nincs mit tennie, a kiallitott lapnal
                pedig MINK tartozunk egy lepessel.
              */
              <ServicePanel>
                <p className="text-sm text-muted">
                  {current.status === "AWAITING_SIGNATURE"
                    ? "Ez a munkalap még nem érkezett meg aláírásra. Amint kiküldjük, itt tudja aláírni."
                    : `Ez a munkalap most nem írható alá (${worksheetStatusLabel[current.status].toLowerCase()}).`}
                </p>
              </ServicePanel>
            ) : (
              <ServicePanel>
                <ServicePanelHeading title="Munkalap aláírása" />
                <form className="space-y-3" onSubmit={sign}>
                  <p className="text-sm text-muted">
                    Válassza ki az aláírót, majd adja meg a négyjegyű
                    aláírókódját.
                  </p>
                  <label className="block text-sm font-medium text-ink">
                    Aláíró
                    <select
                      required
                      value={signerUserId}
                      onChange={(event) => setSignerUserId(event.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-dusk-200 bg-white px-3 text-sm text-dusk-900"
                    >
                      <option value="">Válasszon aláírót</option>
                      {signers?.items.map((signer) => (
                        <option key={signer.id} value={signer.id}>
                          {signer.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-ink">
                    Aláírókód
                    <input
                      required
                      inputMode="numeric"
                      pattern="[0-9]{4}"
                      maxLength={4}
                      value={signatureCode}
                      onChange={(event) => setSignatureCode(event.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-dusk-200 bg-white px-3 text-sm text-dusk-900"
                    />
                  </label>
                  {signers?.emptyReason ? (
                    <p className="text-sm text-muted">{signers.emptyReason}</p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={signing || !signers?.items.length}
                    className="inline-flex h-9 items-center rounded-lg bg-dusk-900 px-4 text-sm font-semibold text-white disabled:pointer-events-none disabled:opacity-50"
                  >
                    {signing ? "Aláírás rögzítése…" : "Aláírás rögzítése"}
                  </button>
                </form>
              </ServicePanel>
            )}

            {/*
              A `DocumentPanel` KIVETEL, ES SZANDEKOSAN AZ: az `asset-detail.tsx`
              es a `ticket-detail.tsx` is ugyanezt a komponenst hivja, a sajat
              `PANEL`/`PANEL_CIM` osztalyaival. Ha itt atalakitanam, mind a
              harom lap kulseje megvaltozna -- lasd `ticket-detail.tsx`
              fejleceben ugyanezt a megjegyzest.
            */}
            <DocumentPanel
              title="Munkalap fényképei és fájljai"
              items={documents}
              loadBlob={(documentId) =>
                partnerApi.worksheetDocumentBlob(id, documentId)
              }
              upload={(file, caption) =>
                partnerApi.uploadWorksheetDocument(id, file, caption)
              }
              onUploaded={load}
            />

            <Verziok versions={worksheet.versions} />
          </>
        }
        side={
          <>
            <ServicePanel>
              <ServicePanelHeading title="Munkalap adatai" />
              <ServiceDataGrid>
                <ServiceDataItem label="Hibajegy">
                  {/*
                    A HIÁNY IS ÁLLÍTÁS, ezért nem gondolatjel áll itt: a lap
                    keletkezhet hibajegy nélkül, és az nem hiányzó ADAT, hanem
                    a folyamat egyik rendes állapota.
                  */}
                  {worksheet.serviceJob ? (
                    <Link
                      className="text-brand-700 hover:underline"
                      href={`/hibajegyek/${worksheet.serviceJob.id}`}
                    >
                      {worksheet.serviceJob.jobNumber}
                    </Link>
                  ) : (
                    "Nincs mögötte hibajegy"
                  )}
                </ServiceDataItem>
                {/*
                  ÉS AKKOR IS KIÍRJUK, HA NULLA. Egy elrejtett nulla két
                  különböző állapotot mosna össze: hogy nincs munkaóra-tétel a
                  lapon, és hogy a mező elromlott. A „0 óra" állítás; a
                  hiányzó sor kérdés.
                */}
                <ServiceDataItem label="Összes munkaóra">
                  {current.laborHours} óra
                </ServiceDataItem>
                <ServiceDataItem label="Keltezés">
                  {datum(current.issueDate)}
                </ServiceDataItem>
                <ServiceDataItem label="Teljesítés">
                  {datum(current.fulfillmentDate)}
                </ServiceDataItem>
                <ServiceDataItem label="Határidő">
                  {datum(current.dueDate)}
                </ServiceDataItem>
                <ServiceDataItem label="Felvette">
                  {worksheet.createdByName ?? "Nincs megadva"}
                </ServiceDataItem>
                <ServiceDataItem label="Verzió">
                  {`${current.version}. verzió`}
                </ServiceDataItem>
              </ServiceDataGrid>
            </ServicePanel>

            <ServicePanel>
              <ServicePanelHeading title="Érintett eszközök" />
              {worksheet.assets.length ? (
                <ul className="space-y-2">
                  {worksheet.assets.map((asset) => (
                    <li
                      key={asset.id}
                      className="flex items-center gap-2 border-b pb-2 text-sm last:border-0"
                    >
                      <ServiceIcon
                        name="box"
                        className="size-4 shrink-0 text-[#8679aa]"
                      />
                      <div className="min-w-0 flex-1">
                        {/*
                          AZ `assetId`-VEL, NEM A CSATOLÁS SORÁNAK
                          AZONOSÍTÓJÁVAL. A két mező mindegyike `string`,
                          tehát a típus nem fogja meg, a rossz választás
                          pedig néma: a hivatkozás megjelenne, a lap „nem
                          található" hibát adna.
                        */}
                        <Link
                          className="block truncate font-medium text-ink hover:text-brand-700"
                          href={`/eszkozok/${asset.assetId}`}
                        >
                          {asset.assetName}
                        </Link>
                        <span className="block text-xs text-dusk-500">
                          {asset.assetNumber}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-dusk-500">
                  A munkalaphoz nincs eszköz megjelölve.
                </p>
              )}
            </ServicePanel>
          </>
        }
      />
    </section>
  );
}

/**
 * ELVÉGZETT MUNKA ÉS ANYAGOK.
 *
 * AZ OSZLOPOK A BELSŐ LAPÉI, ÖSSZEGEK NÉLKÜL: az egységár, az áfa és a nettó
 * oszlop 2026-09-17-én onnan is kikerült (Balázs döntése, #809). Ez tehát nem
 * partneri csonkítás, hanem ugyanaz a lap.
 */
function Tetelek({ lines }: { lines: WorksheetLineDetail[] }) {
  return (
    <ServicePanel>
      <ServicePanelHeading title="Elvégzett munka és anyagok" />
      {lines.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead>
              <tr>
                {["#", "Megnevezés", "Mennyiség", "Egység", "Munkaóra"].map(
                  (head) => (
                    <th
                      key={head}
                      className="border-b border-line pb-2 pr-3 text-xs font-semibold uppercase tracking-wide text-muted"
                    >
                      {head}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.id}
                  className="border-b border-line last:border-0"
                >
                  <td className="py-2 pr-3 align-top">{line.position}</td>
                  <td className="py-2 pr-3 align-top">
                    <strong className="block text-ink">
                      {line.description}
                    </strong>
                    {line.detail ? (
                      <span className="block text-xs text-muted">
                        {line.detail}
                      </span>
                    ) : null}
                    {line.assetNumber ? (
                      <span className="block text-xs text-muted">
                        {line.assetNumber}
                      </span>
                    ) : null}
                    {/*
                      AZ ÜGYFÉL SAJÁT KÓDJA FELIRATOT KAP. A fölötte álló
                      eszközszám a MIÉNK, ez pedig az övé: két csupasz kód
                      egymás alatt pont azt a keveredést hozná, ami ellen a
                      mező külön nevet kapott.
                    */}
                    {line.partnerInternalCode ? (
                      <span className="block text-xs text-muted">
                        Partner belső kódja: {line.partnerInternalCode}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 align-top">{line.quantity}</td>
                  <td className="py-2 pr-3 align-top">{line.unit}</td>
                  {/*
                    A NEM-MUNKA TÉTEL GONDOLATJELET KAP, NEM NULLÁT. A szerver
                    „0"-t küld (a hiány és a nulla így nem keveredik a
                    számolásban), a LAPON viszont a nulla óra ÉRTÉKNEK
                    látszana: úgy nézne ki, mintha valaki nulla órát dolgozott
                    volna rajta.
                  */}
                  <td className="py-2 pr-3 align-top">
                    {line.kind === "LABOR" ? line.laborHours : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">A munkalapon még nincs tétel.</p>
      )}
    </ServicePanel>
  );
}

/**
 * VERZIÓK. Ugyanazok az oszlopok, mint a belső lapon -- összegek nélkül, mert
 * azok sehol nem jelennek meg.
 *
 * A PARTNERNEK EZ NEM BELSŐ ADAT: a saját lapja történetét mutatja, és az
 * aláírás oszlopban a SAJÁT döntését. Ha egy verziót elutasított, itt látja,
 * miért keletkezett a következő.
 */
function Verziok({ versions }: { versions: WorksheetVersionSummary[] }) {
  return (
    <ServicePanel>
      <ServicePanelHeading title="Verziók" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr>
              {[
                "Verzió",
                "Állapot",
                "Készítette",
                "Lezárta",
                "Indoklás",
                "Aláírás",
              ].map((head) => (
                <th
                  key={head}
                  className="border-b border-line pb-2 pr-3 text-xs font-semibold uppercase tracking-wide text-muted"
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr
                key={version.id}
                className="border-b border-line last:border-0"
              >
                <td className="py-2 pr-3 align-top">
                  {version.label ?? `${version.version}. verzió`}
                </td>
                <td className="py-2 pr-3 align-top">
                  {worksheetStatusLabel[version.status]}
                </td>
                <td className="py-2 pr-3 align-top">
                  {version.createdByName ?? "—"}
                  <span className="block text-xs text-muted">
                    {idopont(version.createdAt)}
                  </span>
                </td>
                <td className="py-2 pr-3 align-top">
                  {version.closedByName ?? "—"}
                  <span className="block text-xs text-muted">
                    {idopont(version.closedAt)}
                  </span>
                </td>
                <td className="py-2 pr-3 align-top whitespace-pre-line">
                  {version.changeReason ?? "—"}
                </td>
                <td className="py-2 pr-3 align-top">
                  {version.signature ? (
                    <>
                      {version.signature.signerName}
                      <span className="block text-xs text-muted">
                        {version.signature.decision === "ACCEPTED"
                          ? "elfogadta"
                          : "elutasította"}
                      </span>
                      {/*
                        A JELZÉS A SZERVERTŐL JÖN, a TÁROLT állapotból -- nem
                        abból, hogy a név „úgy néz ki", mintha ügyfélé lenne.
                      */}
                      {version.signature.signerNotice ? (
                        <span className="block text-xs text-muted">
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
    </ServicePanel>
  );
}

/** A VISSZAFELE VEZETO UT.
 *
 * HELYBEN ÁLL, NEM A `@acropora/ui`-BAN: a `next/link`-et használja, a
 * `@acropora/ui` viszont keretfüggetlen marad -- ugyanaz az indok, amiért az
 * `apps/web` saját `ServiceBackLink`-je sem költözött át (lásd a
 * `packages/ui/src/service-detail-chrome.tsx` fejlécében), és ugyanaz a
 * minta, amit a `ticket-detail.tsx` és az `asset-detail.tsx` saját
 * `VisszaLink()`-je is követ.
 */
function VisszaLink() {
  return (
    <Link
      href="/munkalapok"
      className="mb-[18px] inline-flex items-center gap-[7px] text-xs text-muted hover:text-brand-700"
    >
      <ServiceIcon name="arrowLeft" className="size-4" />
      Munkalapok
    </Link>
  );
}

/**
 * A HIÁNYZÓ DÁTUM KIMONDVA ÁLL, nem üres cellaként. Egy üres hely három
 * különböző dolgot jelenthet (nincs, nem látja, nem töltődött be).
 */
function datum(ertek: string | null): string {
  return ertek ? new Date(ertek).toLocaleDateString("hu-HU") : "Nincs megadva";
}

function idopont(ertek: string | null): string {
  return ertek
    ? new Intl.DateTimeFormat("hu-HU", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(ertek))
    : "—";
}
