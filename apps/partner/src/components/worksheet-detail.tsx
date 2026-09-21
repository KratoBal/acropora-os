"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  worksheetStatusLabel,
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
 * belső lapé (`apps/web/.../worksheet-detail-page.tsx`, 886 sor), a kezelői
 * műveletek viszont nem kerülnek át.
 *
 * === AMI SZÁNDÉKOSAN NEM KERÜL ÁT, ÉS MIND A KETTŐNEK MÁS AZ INDOKA ===
 *
 * 1. A MUNKANAPLÓ (`WorksheetEntries`). Ez NEM a mi döntésünk: a végpont saját
 *    megjegyzése mondja ki, hogy „a bejegyzes a MI munkanaplonk, es Balazs nem
 *    kerte, hogy a partner lassa" (`worksheets.controller.ts`, a `:id/entries`
 *    ág fölött). Tehát ez a hiány ELDÖNTÖTT dolog, nem elmaradt munka.
 *
 * 2. A TÉTELEK SZERKESZTÉSE, A FELELŐSÖK ÉS AZ ESZKÖZÖK SZERKESZTÉSE. Ezek a
 *    belső lapon `canManage` mögött állnak, és a partner szerepe MA VISELI a
 *    `SERVICE_MANAGE` jogot (`auth.ts:388`) -- vagyis a szerver átengedné.
 *    MA SZÁNDÉKOSAN NEM KÍNÁLJUK őket; a rés a pull request törzsében ki van
 *    mondva, és külön kezelésben van.
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
        <Link className="back-link" href="/munkalapok">
          ← Munkalapok
        </Link>
        <Message tone="error" text={error} retry={load} />
      </section>
    );
  if (!worksheet) return <p className="muted">Munkalap betöltése…</p>;
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
      <Link className="back-link" href="/munkalapok">
        ← Munkalapok
      </Link>
      <header className="page-header detail-header">
        <div>
          <p className="eyebrow">{worksheet.number ?? "PISZKOZAT"}</p>
          <h1>{current.subject}</h1>
          <p>
            {worksheet.department.path?.join(" / ") ??
              worksheet.department.name}
          </p>
        </div>
        <span className="status neutral">
          {worksheetStatusLabel[current.status]}
        </span>
      </header>
      {error ? <Message tone="error" text={error} /> : null}

      {/*
        A LÁNC MIND A KÉT VÉGE, ÉS AZ ELŐRE MUTATÓ AZ INDOK: aki a régi lapot
        nyitja meg, meg kell találja, hova ment a munka -- nem csak fordítva.
      */}
      {worksheet.continues ? (
        <p className="notice">
          Ez a lap egy korábbi munkalap folytatása:{" "}
          <Link href={`/munkalapok/${worksheet.continues.id}`}>
            {worksheet.continues.number ?? "a korábbi lap még piszkozat"}
          </Link>
        </p>
      ) : null}
      {worksheet.continuedBy.length ? (
        <p className="notice">
          Ennek a lapnak van folytatása:{" "}
          {worksheet.continuedBy.map((lanc, index) => (
            <span key={lanc.id}>
              {index > 0 ? ", " : ""}
              <Link href={`/munkalapok/${lanc.id}`}>
                {lanc.number ?? "piszkozat"}
              </Link>
            </span>
          ))}
        </p>
      ) : null}

      <div className="detail-grid">
        <article className="panel">
          <h2>A munka leírása</h2>
          <p className="preline">
            {current.description ?? "Nem rögzítettek részletes leírást."}
          </p>
        </article>
        <aside className="panel">
          <h2>Munkalap adatai</h2>
          <dl>
            <div>
              <dt>Hibajegy</dt>
              <dd>
                {/*
                  A HIÁNY IS ÁLLÍTÁS, ezért nem gondolatjel áll itt: a lap
                  keletkezhet hibajegy nélkül, és az nem hiányzó ADAT, hanem a
                  folyamat egyik rendes állapota.
                */}
                {worksheet.serviceJob ? (
                  <Link href={`/hibajegyek/${worksheet.serviceJob.id}`}>
                    {worksheet.serviceJob.jobNumber}
                  </Link>
                ) : (
                  "Nincs mögötte hibajegy"
                )}
              </dd>
            </div>
            <div>
              <dt>Összes munkaóra</dt>
              {/*
                ÉS AKKOR IS KIÍRJUK, HA NULLA. Egy elrejtett nulla két
                különböző állapotot mosna össze: hogy nincs munkaóra-tétel a
                lapon, és hogy a mező elromlott. A „0 óra" állítás; a hiányzó
                sor kérdés.
              */}
              <dd>{current.laborHours} óra</dd>
            </div>
            <div>
              <dt>Keltezés</dt>
              <dd>{datum(current.issueDate)}</dd>
            </div>
            <div>
              <dt>Teljesítés</dt>
              <dd>{datum(current.fulfillmentDate)}</dd>
            </div>
            <div>
              <dt>Határidő</dt>
              <dd>{datum(current.dueDate)}</dd>
            </div>
            <div>
              <dt>Felvette</dt>
              <dd>{worksheet.createdByName ?? "Nincs megadva"}</dd>
            </div>
            <div>
              <dt>Verzió</dt>
              <dd>{`${current.version}. verzió`}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <Tetelek lines={current.lines} />

      <section className="panel">
        <h2>Érintett eszközök</h2>
        {worksheet.assets.length ? (
          <ul className="plain-list">
            {worksheet.assets.map((asset) => (
              <li key={asset.id}>
                {/*
                  AZ `assetId`-VEL, NEM A CSATOLÁS SORÁNAK AZONOSÍTÓJÁVAL. A
                  két mező mindegyike `string`, tehát a típus nem fogja meg, a
                  rossz választás pedig néma: a hivatkozás megjelenne, a lap
                  „nem található" hibát adna.
                */}
                <Link href={`/eszkozok/${asset.assetId}`}>
                  <strong>{asset.assetName}</strong>
                </Link>
                <span>{asset.assetNumber}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">A munkalaphoz nincs eszköz megjelölve.</p>
        )}
      </section>

      {signature ? (
        <article className="panel">
          <h2>Aláírva</h2>
          <p>
            {signature.signerName} · {idopont(signature.signedAt)}
          </p>
          {signature.signerNotice ? (
            <p className="muted">{signature.signerNotice}</p>
          ) : null}
          {signature.note ? <p className="preline">{signature.note}</p> : null}
        </article>
      ) : !alairhato ? (
        /*
          ES NEM CSAK ELREJTJUK: MEGMONDJUK, MIERT. Egy eltuno urlap ugyanugy
          nez ki, mint egy elromlott lap -- a partner nem tudja, ra var-e valami.
          A ket eset KET KULON mondatot kap, mert MAS a teendo: a piszkozatnal
          nincs mit tennie, a kiallitott lapnal pedig MINK tartozunk egy
          lepessel.
        */
        <p className="muted">
          {current.status === "AWAITING_SIGNATURE"
            ? "Ez a munkalap még nem érkezett meg aláírásra. Amint kiküldjük, itt tudja aláírni."
            : `Ez a munkalap most nem írható alá (${worksheetStatusLabel[current.status].toLowerCase()}).`}
        </p>
      ) : (
        <form className="form panel" onSubmit={sign}>
          <h2>Munkalap aláírása</h2>
          <p>Válassza ki az aláírót, majd adja meg a négyjegyű aláírókódját.</p>
          <label>
            Aláíró
            <select
              required
              value={signerUserId}
              onChange={(event) => setSignerUserId(event.target.value)}
            >
              <option value="">Válasszon aláírót</option>
              {signers?.items.map((signer) => (
                <option key={signer.id} value={signer.id}>
                  {signer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Aláírókód
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              value={signatureCode}
              onChange={(event) => setSignatureCode(event.target.value)}
            />
          </label>
          {signers?.emptyReason ? (
            <p className="muted">{signers.emptyReason}</p>
          ) : null}
          <button type="submit" disabled={signing || !signers?.items.length}>
            {signing ? "Aláírás rögzítése…" : "Aláírás rögzítése"}
          </button>
        </form>
      )}

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
    <section className="panel">
      <h2>Elvégzett munka és anyagok</h2>
      {lines.length ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Megnevezés</th>
                <th className="numeric">Mennyiség</th>
                <th>Egység</th>
                <th className="numeric">Munkaóra</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.position}</td>
                  <td>
                    <strong>{line.description}</strong>
                    {line.detail ? <span>{line.detail}</span> : null}
                    {line.assetNumber ? <span>{line.assetNumber}</span> : null}
                    {/*
                      AZ ÜGYFÉL SAJÁT KÓDJA FELIRATOT KAP. A fölötte álló
                      eszközszám a MIÉNK, ez pedig az övé: két csupasz kód
                      egymás alatt pont azt a keveredést hozná, ami ellen a
                      mező külön nevet kapott.
                    */}
                    {line.inventoryNumber ? (
                      <span>Leltári szám: {line.inventoryNumber}</span>
                    ) : null}
                  </td>
                  <td className="numeric">{line.quantity}</td>
                  <td>{line.unit}</td>
                  {/*
                    A NEM-MUNKA TÉTEL GONDOLATJELET KAP, NEM NULLÁT. A szerver
                    „0"-t küld (a hiány és a nulla így nem keveredik a
                    számolásban), a LAPON viszont a nulla óra ÉRTÉKNEK
                    látszana: úgy nézne ki, mintha valaki nulla órát dolgozott
                    volna rajta.
                  */}
                  <td className="numeric">
                    {line.kind === "LABOR" ? line.laborHours : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">A munkalapon még nincs tétel.</p>
      )}
    </section>
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
    <section className="panel">
      <h2>Verziók</h2>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Verzió</th>
              <th>Állapot</th>
              <th>Készítette</th>
              <th>Lezárta</th>
              <th>Indoklás</th>
              <th>Aláírás</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id}>
                <td>{version.label ?? `${version.version}. verzió`}</td>
                <td>{worksheetStatusLabel[version.status]}</td>
                <td>
                  {version.createdByName ?? "—"}
                  <span>{idopont(version.createdAt)}</span>
                </td>
                <td>
                  {version.closedByName ?? "—"}
                  <span>{idopont(version.closedAt)}</span>
                </td>
                <td className="preline">{version.changeReason ?? "—"}</td>
                <td>
                  {version.signature ? (
                    <>
                      {version.signature.signerName}
                      <span>
                        {version.signature.decision === "ACCEPTED"
                          ? "elfogadta"
                          : "elutasította"}
                      </span>
                      {/*
                        A JELZÉS A SZERVERTŐL JÖN, a TÁROLT állapotból -- nem
                        abból, hogy a név „úgy néz ki", mintha ügyfélé lenne.
                      */}
                      {version.signature.signerNotice ? (
                        <span>{version.signature.signerNotice}</span>
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
