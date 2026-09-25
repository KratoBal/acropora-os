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
  PilotFormField,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
  pilotBadgeVariantForTone,
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
 * A MUNKALAP ADATLAPJA A PARTNER PORTÁLON -- FIGMA 9. KÖR, a Make-terv
 * `PartnerPortalScreen.tsx:1057-1201` átültetése.
 *
 * === MI KERÜL RÁ, ÉS MI NEM (Balázs kérése, 2026-09-21) -- VÁLTOZATLAN ===
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
 * === AZ ELRENDEZÉS -- PILOT-AQUA (2026-09-25) ===
 *
 * Az előző kör a belső, violet `ServiceDetailHeader`/`ServicePanel`/
 * `ServiceDataItem`/`ServiceDetailSplit` keretet vette át -- ez a kör a
 * portál egészét pilot-aqua design-rendszerre viszi, a hibajegy- (#1127) és
 * eszköz-adatlappal (#1128) egyező mintát követve. A TARTALOM VÁLTOZATLAN:
 * ugyanazok az adatsorok, ugyanabban a sorrendben.
 *
 * === A LÁNC-SÁVOK FORMÁJA A BELSŐ ADATLAP (#1106) MINTÁJÁT KÖVETI ===
 *
 * Acrobot döntése (2026-09-25): a két lánc-figyelmeztető sáv (`continues`/
 * `continuedBy`) ne kapjon kitalált formát, hanem a belső
 * `pilot-worksheet-detail-page.tsx` már beolvadt mintáját kövesse --
 * amber sáv az előzményre, aqua sáv a folytatásra, `PilotButton` a
 * hivatkozással. EGY ELTÉRÉS SZÁNDÉKOS: a belső lap a `continuedBy` listából
 * csak az ELSŐ elemre linkel, a portál viszont MINDET felsorolta eddig is --
 * ez tartalmi képesség, nem vizuális döntés, ezért itt megmarad (a sáv
 * szövegében soroljuk fel az összes folytatást, nem csak az elsőt).
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
      <PilotThemeRoot className="-mx-5 -mt-10 -mb-16 max-w-none bg-pilot-grey-50 px-8 py-6">
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </PilotThemeRoot>
    );
  if (!worksheet)
    return (
      <PilotThemeRoot className="-mx-5 -mt-10 -mb-16 max-w-none bg-pilot-grey-50 px-8 py-6">
        <p className="text-sm text-pilot-grey-400">Munkalap betöltése…</p>
      </PilotThemeRoot>
    );
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
    <PilotThemeRoot className="-mx-5 -mt-10 -mb-16 max-w-none bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <VisszaLink />
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          {worksheet.number ?? "PISZKOZAT"}
        </p>
        <div className="flex items-start gap-3">
          <h1 className="flex-1 text-xl font-semibold text-pilot-grey-900">
            {current.subject}
          </h1>
          <PilotBadge
            variant={pilotBadgeVariantForTone(
              worksheetStatusTone(current.status),
            )}
          >
            {worksheetStatusLabel[current.status]}
          </PilotBadge>
        </div>
        <p className="mt-1 text-sm text-pilot-grey-400">
          {worksheet.department.path?.join(" / ") ?? worksheet.department.name}
        </p>

        {error ? (
          <p
            className="mt-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {/*
          A LÁNC MIND A KÉT VÉGE, ÉS AZ ELŐRE MUTATÓ AZ INDOK: aki a régi lapot
          nyitja meg, meg kell találja, hova ment a munka -- nem csak fordítva.
          A FORMA A BELSŐ ADATLAP (#1106) MINTÁJA: amber az előzményre, aqua a
          folytatásra -- lásd a fájl fejlécét.
        */}
        {worksheet.continues ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-pilot-amber-50 px-4 py-3 text-sm ring-1 ring-pilot-amber-100">
            <span className="text-pilot-amber-700">
              Ez a lap egy korábbi munkalap folytatása:{" "}
              {worksheet.continues.number ?? "a korábbi lap még piszkozat"}
            </span>
            <Link href={`/munkalapok/${worksheet.continues.id}`}>
              <PilotButton variant="secondary">
                Előzmény megnyitása →
              </PilotButton>
            </Link>
          </div>
        ) : null}
        {worksheet.continuedBy.length ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-pilot-aqua-50 px-4 py-3 text-sm ring-1 ring-pilot-aqua-200">
            {/*
              A BELSŐ SÁV CSAK AZ ELSŐ FOLYTATÁSRA LINKEL -- a portál viszont
              eddig is MINDET felsorolta, ez tartalmi képesség, nem vizuális
              döntés, ezért itt marad (lásd a fájl fejlécét).
            */}
            <span className="text-pilot-aqua-700">
              Ennek a lapnak van folytatása:{" "}
              {worksheet.continuedBy.map((lanc, index) => (
                <span key={lanc.id}>
                  {index > 0 ? ", " : ""}
                  {lanc.number ?? "piszkozat"}
                </span>
              ))}
            </span>
            <Link href={`/munkalapok/${worksheet.continuedBy[0]!.id}`}>
              <PilotButton variant="secondary">
                Folytatás megnyitása →
              </PilotButton>
            </Link>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 px-8 py-6 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-5">
          <PilotCard>
            <PilotCardHeader title="A munka leírása" />
            <div className="px-5 py-4">
              <p className="whitespace-pre-line text-sm leading-6 text-pilot-grey-600">
                {current.description ?? "Nem rögzítettek részletes leírást."}
              </p>
            </div>
          </PilotCard>

          <Tetelek lines={current.lines} />

          <PilotCard>
            <PilotCardHeader title="Aláírás" />
            <div className="px-5 py-4">
              {signature ? (
                <div className="flex items-start gap-3 rounded-lg bg-pilot-aqua-50 px-4 py-3">
                  <Icon
                    name="shield"
                    size={16}
                    className="mt-0.5 shrink-0 text-pilot-aqua-700"
                  />
                  <div>
                    <p className="text-sm font-medium text-pilot-aqua-700">
                      Aláírva: {signature.signerName}
                    </p>
                    <p className="mt-0.5 text-xs text-pilot-aqua-600">
                      {idopont(signature.signedAt)}
                    </p>
                    {signature.signerNotice ? (
                      <p className="mt-1 text-sm text-pilot-grey-500">
                        {signature.signerNotice}
                      </p>
                    ) : null}
                    {signature.note ? (
                      <p className="mt-1 whitespace-pre-line text-sm text-pilot-grey-700">
                        {signature.note}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : !alairhato ? (
                /*
                  ES NEM CSAK ELREJTJUK: MEGMONDJUK, MIERT. Egy eltuno urlap
                  ugyanugy nez ki, mint egy elromlott lap -- a partner nem tudja,
                  ra var-e valami. A ket eset KET KULON mondatot kap, mert MAS a
                  teendo: a piszkozatnal nincs mit tennie, a kiallitott lapnal
                  pedig MINK tartozunk egy lepessel.
                */
                <p className="text-sm italic text-pilot-grey-500">
                  {current.status === "AWAITING_SIGNATURE"
                    ? "Ez a munkalap még nem érkezett meg aláírásra. Amint kiküldjük, itt tudja aláírni."
                    : `Ez a munkalap most nem írható alá (${worksheetStatusLabel[current.status].toLowerCase()}).`}
                </p>
              ) : (
                <form className="flex flex-col gap-3" onSubmit={sign}>
                  <p className="text-sm text-pilot-grey-500">
                    Válassza ki az aláírót, majd adja meg a négyjegyű
                    aláírókódját.
                  </p>
                  <PilotFormField label="Aláíró" required>
                    <PilotSelect
                      value={signerUserId}
                      onChange={setSignerUserId}
                      aria-label="Aláíró"
                    >
                      <option value="">Válasszon aláírót</option>
                      {signers?.items.map((signer) => (
                        <option key={signer.id} value={signer.id}>
                          {signer.name}
                        </option>
                      ))}
                    </PilotSelect>
                  </PilotFormField>
                  <PilotFormField label="Aláírókód" required>
                    <PilotInput
                      type="text"
                      inputMode="numeric"
                      value={signatureCode}
                      onChange={(value) =>
                        setSignatureCode(value.replace(/\D/g, "").slice(0, 4))
                      }
                      placeholder="••••"
                    />
                  </PilotFormField>
                  {signers?.emptyReason ? (
                    <p className="text-sm text-pilot-grey-500">
                      {signers.emptyReason}
                    </p>
                  ) : null}
                  <div>
                    <PilotButton
                      type="submit"
                      disabled={
                        signing ||
                        !signers?.items.length ||
                        !signerUserId ||
                        signatureCode.length !== 4
                      }
                    >
                      {signing ? "Aláírás rögzítése…" : "Aláírás rögzítése"}
                    </PilotButton>
                  </div>
                </form>
              )}
            </div>
          </PilotCard>

          {/*
            A `DocumentPanel` EBBEN A KÖRBEN IS KIVETEL, ES SZANDEKOSAN AZ: az
            `asset-detail.tsx` (#1128) es a `ticket-detail.tsx` (#1127) is
            ugyanezt a komponenst hivja, a sajat `PANEL`/`PANEL_CIM`
            osztalyaival es a `globals.css` `document-*` szabalyaival. Ha itt
            atalakitanam, mindharom lap kulseje megvaltozna, es ez a
            beolvasztas AZONNAL elesre megy -- lasd `ticket-detail.tsx`
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
        </div>

        <div className="flex flex-col gap-5">
          <PilotCard>
            <PilotCardHeader title="Munkalap adatai" />
            <div className="px-5 py-2">
              <PilotDataRow
                label="Hibajegy"
                /*
                  A HIÁNY IS ÁLLÍTÁS, ezért nem gondolatjel áll itt: a lap
                  keletkezhet hibajegy nélkül, és az nem hiányzó ADAT, hanem
                  a folyamat egyik rendes állapota. Ezért nem hagyjuk a
                  `PilotDataRow` "Nincs megadva" tartalékára, hanem saját
                  szöveget adunk.
                */
                value={
                  worksheet.serviceJob ? (
                    <Link
                      className="text-pilot-aqua-700 hover:underline"
                      href={`/hibajegyek/${worksheet.serviceJob.id}`}
                    >
                      {worksheet.serviceJob.jobNumber}
                    </Link>
                  ) : (
                    "Nincs mögötte hibajegy"
                  )
                }
              />
              {/*
                ÉS AKKOR IS KIÍRJUK, HA NULLA. Egy elrejtett nulla két
                különböző állapotot mosna össze: hogy nincs munkaóra-tétel a
                lapon, és hogy a mező elromlott. A „0 óra" állítás; a
                hiányzó sor kérdés. Ezért nem a `PilotDataRow` tartalékára
                bízzuk (az a `0`-t is hiányként kezelné).
              */}
              <PilotDataRow
                label="Összes munkaóra"
                value={`${current.laborHours} óra`}
              />
              <PilotDataRow label="Keltezés" value={datum(current.issueDate)} />
              <PilotDataRow
                label="Teljesítés"
                value={datum(current.fulfillmentDate)}
              />
              <PilotDataRow label="Határidő" value={datum(current.dueDate)} />
              <PilotDataRow label="Felvette" value={worksheet.createdByName} />
              <PilotDataRow
                label="Verzió"
                value={`${current.version}. verzió`}
              />
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Érintett eszközök" />
            <div className="px-5 py-4">
              {worksheet.assets.length ? (
                <ul className="divide-y divide-pilot-grey-50">
                  {worksheet.assets.map((asset) => (
                    <li
                      key={asset.id}
                      className="flex items-center gap-2 py-2 text-sm"
                    >
                      <Icon
                        name="box"
                        size={16}
                        className="shrink-0 text-pilot-grey-300"
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
                          className="block truncate font-medium text-pilot-grey-900 hover:text-pilot-aqua-700"
                          href={`/eszkozok/${asset.assetId}`}
                        >
                          {asset.assetName}
                        </Link>
                        <span className="block text-xs text-pilot-grey-400">
                          {asset.assetNumber}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-sm italic text-pilot-grey-500">
                  A munkalaphoz nincs eszköz megjelölve.
                </p>
              )}
            </div>
          </PilotCard>
        </div>
      </div>
    </PilotThemeRoot>
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
    <PilotCard>
      <PilotCardHeader title="Elvégzett munka és anyagok" />
      {lines.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-pilot-grey-100">
                {["#", "Megnevezés", "Mennyiség", "Egység", "Munkaóra"].map(
                  (head) => (
                    <th
                      key={head}
                      className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-400"
                    >
                      {head}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-pilot-grey-50">
                  <td className="px-5 py-3 font-mono text-xs text-pilot-grey-400">
                    {line.position}
                  </td>
                  <td className="px-5 py-3">
                    <strong className="block text-pilot-grey-700">
                      {line.description}
                    </strong>
                    {line.detail ? (
                      <span className="block text-xs text-pilot-grey-400">
                        {line.detail}
                      </span>
                    ) : null}
                    {line.assetNumber ? (
                      <span className="block text-xs text-pilot-grey-400">
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
                      <span className="block text-xs text-pilot-grey-400">
                        Partner belső kódja: {line.partnerInternalCode}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 font-mono text-pilot-grey-600">
                    {line.quantity}
                  </td>
                  <td className="px-5 py-3 text-pilot-grey-600">{line.unit}</td>
                  {/*
                    A NEM-MUNKA TÉTEL GONDOLATJELET KAP, NEM NULLÁT. A szerver
                    „0"-t küld (a hiány és a nulla így nem keveredik a
                    számolásban), a LAPON viszont a nulla óra ÉRTÉKNEK
                    látszana: úgy nézne ki, mintha valaki nulla órát dolgozott
                    volna rajta.
                  */}
                  <td className="px-5 py-3 font-mono text-pilot-grey-600">
                    {line.kind === "LABOR" ? `${line.laborHours} h` : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 py-4 text-sm italic text-pilot-grey-500">
          A munkalapon még nincs tétel.
        </p>
      )}
    </PilotCard>
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
    <PilotCard>
      <PilotCardHeader title="Verziók" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-pilot-grey-100">
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
                  className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-400"
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id} className="border-b border-pilot-grey-50">
                <td className="px-5 py-3 font-mono text-xs text-pilot-grey-600">
                  {version.label ?? `${version.version}. verzió`}
                </td>
                <td className="px-5 py-3">
                  <PilotBadge
                    variant={pilotBadgeVariantForTone(
                      worksheetStatusTone(version.status),
                    )}
                  >
                    {worksheetStatusLabel[version.status]}
                  </PilotBadge>
                </td>
                <td className="px-5 py-3 text-pilot-grey-600">
                  {version.createdByName ?? "—"}
                  <span className="block text-xs text-pilot-grey-400">
                    {idopont(version.createdAt)}
                  </span>
                </td>
                <td className="px-5 py-3 text-pilot-grey-600">
                  {version.closedByName ?? "—"}
                  <span className="block text-xs text-pilot-grey-400">
                    {idopont(version.closedAt)}
                  </span>
                </td>
                <td className="px-5 py-3 whitespace-pre-line text-pilot-grey-500">
                  {version.changeReason ?? "—"}
                </td>
                <td className="px-5 py-3 text-pilot-grey-500">
                  {version.signature ? (
                    <>
                      {version.signature.signerName}
                      <span className="block text-xs text-pilot-grey-400">
                        {version.signature.decision === "ACCEPTED"
                          ? "elfogadta"
                          : "elutasította"}
                      </span>
                      {/*
                        A JELZÉS A SZERVERTŐL JÖN, a TÁROLT állapotból -- nem
                        abból, hogy a név „úgy néz ki", mintha ügyfélé lenne.
                      */}
                      {version.signature.signerNotice ? (
                        <span className="block text-xs text-pilot-grey-400">
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
      className="mb-3 inline-flex items-center gap-1.5 text-xs text-pilot-grey-400 hover:text-pilot-grey-700"
    >
      <Icon name="chevron-left" size={12} />
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
