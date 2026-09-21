"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { serviceJobWorksheetLabel } from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { naploSor } from "@/lib/naplo-sor";
import { DocumentPanel } from "./document-panel";
import { Empty, Message } from "./ticket-list";

/**
 * A HIBAJEGY ADATLAPJA A PARTNER PORTÁLON.
 *
 * === MI KERÜL RÁ, ÉS MI NEM (Balázs kérése, 2026-09-21) ===
 *
 * Szó szerint: „sot: ugyanaz legyen a hibajegy es a munkalap oldal is", és
 * „csak ott megtudja csinalni azt amihez jogosultsaga van". A tartalom tehát a
 * belső lapé (`apps/web/.../service-job-detail-page.tsx`), a kezelői műveletek
 * viszont nem kerülnek át.
 *
 * === AMI A BELSŐ LAPON VAN, ÉS ITT NINCS ===
 *
 * A léptetés („Következő lépés"), a delegálás, a helyszín és az eszközök
 * szerkesztése, a munkalap csatolása és leválasztása. Mind a belső lapon
 * `canManage` mögött áll.
 *
 * ÉS AZ INDOK ITT UGYANAZ A RÉS, AMIT AZ ESZKÖZ-ADATLAPNÁL MÉRTEM: a
 * `PARTNER_SERVICE` szerep `[SERVICE_VIEW, SERVICE_MANAGE]` (auth.ts:388),
 * vagyis a partner fiókjának MA VAN joga ezekhez a végpontokhoz. Nem azért
 * hiányoznak, mert nincs rá jog, hanem mert MA SZÁNDÉKOSAN NEM KÍNÁLJUK őket.
 * A különbség nem szőrszálhasogatás: egy hamis indok túléli azt a feltételt,
 * ami létrehozta, és a következő olvasó a jogosultságok között keresné, miért
 * nincs itt gomb. A rés a pull request törzsében ki van mondva.
 *
 * === AMIT VISZONT KÍNÁLUNK ===
 *
 * A fájl- és fénykép-csatolás marad: a partner a saját jegyéhez ma is csatol,
 * és ez a képesség a korábbi köreinkben épült meg.
 */
export function TicketDetail({ id }: { id: string }) {
  const [ticket, setTicket] = useState<Awaited<
    ReturnType<typeof partnerApi.ticket>
  > | null>(null);
  const [documents, setDocuments] = useState<
    Awaited<ReturnType<typeof partnerApi.ticketDocuments>>["items"]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, documentList] = await Promise.all([
        partnerApi.ticket(id),
        partnerApi.ticketDocuments(id),
      ]);
      setTicket(detail);
      setDocuments(documentList.items);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A hibajegy nem tölthető be.",
      );
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error)
    return (
      <section>
        <Link className="back-link" href="/hibajegyek">
          ← Hibajegyek
        </Link>
        <Message tone="error" text={error} retry={load} />
      </section>
    );
  if (!ticket) return <p className="muted">Hibajegy betöltése…</p>;
  const downloadPackage = async () => {
    setDownloading(true);
    setPackageError(null);
    try {
      const blob = await partnerApi.ticketPackageBlob(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${ticket.jobNumber}-dokumentumcsomag.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setPackageError(
        cause instanceof Error
          ? cause.message
          : "A dokumentumcsomag nem tölthető le.",
      );
    } finally {
      setDownloading(false);
    }
  };
  const date = new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "long",
    timeStyle: "short",
  });
  /*
    A MUNKALAPOK A NAPLÓBÓL JÖNNEK, nem külön mezőből: a `ServiceJobDetail` NEM
    hordoz `worksheets` listát -- a végpont egy időrendet ad, és a belső lap
    munkalap-doboza is abból szűr.
  */
  const worksheets = ticket.timeline.flatMap((entry) =>
    entry.kind === "worksheet" ? [entry.worksheet] : [],
  );
  return (
    <section>
      <Link className="back-link" href="/hibajegyek">
        ← Hibajegyek
      </Link>
      <header className="page-header detail-header">
        <div>
          <p className="eyebrow">{ticket.jobNumber}</p>
          <h1>{ticket.title}</h1>
          <p>
            {ticket.departmentPath?.join(" / ") ?? "Helyszín nincs megadva"}
          </p>
        </div>
        <span className={`status status-${ticket.partnerStatus.toLowerCase()}`}>
          {ticket.partnerStatusLabel}
        </span>
      </header>
      {ticket.partnerStatus === "COMPLETED" ? (
        <div className="download-package">
          <button
            type="button"
            onClick={() => void downloadPackage()}
            disabled={downloading}
          >
            {downloading
              ? "Dokumentumcsomag letöltése…"
              : "Dokumentumcsomag letöltése"}
          </button>
          {packageError ? (
            <p className="error-message">{packageError}</p>
          ) : null}
        </div>
      ) : null}
      <div className="detail-grid">
        <article className="panel">
          <h2>Mi a probléma?</h2>
          {/*
            AZ ÜRES LEÍRÁS KIMONDVA. Egy hiányzó bekezdés ugyanúgy néz ki, mint
            egy betöltési hiba, és a különbséget csak az tudja, aki a jegyet
            felvitte.
          */}
          <p className="preline">
            {ticket.description ||
              "A hibajegyhez nem rögzítettek részletes leírást."}
          </p>
        </article>
        {/*
          AZ ÜGY ADATAI: AMI A JEGYET AZONOSÍTJA A HELYSZÍNEN. A belső lapon ez
          külön doboz a jobb hasábban, ugyanezzel a négy sorral -- a „Partner"
          sor kivételével, ami itt maga a bejelentkezett cég, tehát egy üres
          ismétlés lenne.
        */}
        <aside className="panel">
          <h2>Az ügy adatai</h2>
          <dl>
            <div>
              <dt>Bejelentés ideje</dt>
              <dd>{date.format(new Date(ticket.createdAt))}</dd>
            </div>
            <div>
              <dt>Helyszín</dt>
              <dd>{ticket.departmentPath?.join(" / ") ?? "Nincs megadva"}</dd>
            </div>
            <div>
              <dt>Az ügy állapota</dt>
              <dd>{ticket.partnerStatusLabel}</dd>
            </div>
          </dl>
        </aside>
      </div>
      <section className="panel">
        <h2>Érintett eszközök</h2>
        {ticket.assets.length ? (
          <ul className="plain-list">
            {ticket.assets.map((asset) => (
              <li key={asset.id}>
                {/*
                  A SOR AZ ESZKÖZ ADATLAPJÁRA VISZ, és az `assetId`-vel, nem a
                  csatolás sorának azonosítójával: a kettő két különböző dolog,
                  és az utóbbi egy nem létező lapra vinne.
                */}
                <Link href={`/eszkozok/${asset.assetId}`}>
                  <strong>{asset.assetName}</strong>
                </Link>
                <span>{asset.assetNumber}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">A hibajegyhez nincs eszköz megjelölve.</p>
        )}
      </section>
      <section className="panel">
        <h2>Mi történt a hibajeggyel?</h2>
        {ticket.timeline.length ? (
          <ol className="timeline">
            {ticket.timeline.map((entry) => (
              <li key={`${entry.kind}-${entry.sortKey}`}>
                <span>{naploSor(entry)}</span>
                <time dateTime={entry.at}>
                  {date.format(new Date(entry.at))}
                  {entry.kind === "status" && entry.event.actorName
                    ? ` · ${entry.event.actorName}`
                    : ""}
                </time>
                {/*
                  A TÖRÖLT CSATOLMÁNY SORA ALATT AZ ÁLL, AMIT A TÖRLÉS ELVITT
                  VOLNA: ki töltötte fel, és mikor. A fájl sora addigra nincs
                  meg, tehát ez az egyetlen hely, ahol ez látszik. Régebbi
                  bejegyzésnél `null`, és olyankor nem írunk semmit: a „nem
                  tudjuk" nem ugyanaz, mint a „nem volt".
                */}
                {entry.kind === "document" &&
                entry.removal.uploadedAt !== null ? (
                  <time dateTime={entry.removal.uploadedAt}>
                    Feltöltve: {date.format(new Date(entry.removal.uploadedAt))}
                    {entry.removal.uploadedByName
                      ? ` · ${entry.removal.uploadedByName}`
                      : ""}
                  </time>
                ) : null}
                {/*
                  A BELSŐ MEGJEGYZÉS NEM MEGY A PARTNER ELÉ (Balázs döntése,
                  2026-09-21 10:5x UTC, Discord, szó szerint: „a megjegyzes nem
                  kell a nev igen").

                  EZ A SOR 2026-09-21 DÉLUTÁNIG KIÍRTA. Az érvem az volt, hogy
                  nem új közzététel: a partner letölthető dokumentumcsomagja MA
                  IS tartalmazza ugyanezt a megjegyzést. A mérés igaz volt, a
                  KÖVETKEZTETÉS nem -- Balázs ugyanazzal a mondattal a CSOMAGBÓL
                  is kivetette. Egy meglévő közzététel tehát nem igazol egy
                  másodikat: lehet, hogy az első sem kellett volna.

                  A KOLLÉGA NEVE MARAD, és ezt ő külön kimondta („a nev igen").
                  A sor fölött áll, az időpont mellett.
                */}
              </li>
            ))}
          </ol>
        ) : (
          <Empty
            title="Még nincs esemény"
            text="A hibajegyhez még nem rögzítettek további eseményt."
          />
        )}
      </section>
      <DocumentPanel
        title="Fényképek és fájlok"
        items={documents}
        loadBlob={(documentId) => partnerApi.ticketDocumentBlob(id, documentId)}
        upload={(file, caption) =>
          partnerApi.uploadTicketDocument(id, file, caption)
        }
        onUploaded={load}
      />
      {/*
        A MUNKALAPOK A CSATOLMÁNYOK UTÁN ÁLLNAK, ugyanabban a sorrendben, mint a
        belső lapon. Nem ízlés: a fénykép a BEJELENTETT hibáról szól, a munkalap
        arról, amit TETTÜNK vele.
      */}
      <section className="panel">
        <h2>Munkalapok a jegy mögött</h2>
        {worksheets.length ? (
          <ul className="plain-list">
            {worksheets.map((worksheet) => (
              <li key={worksheet.id}>
                <Link href={`/munkalapok/${worksheet.id}`}>
                  <strong>{serviceJobWorksheetLabel(worksheet)}</strong>
                </Link>
                <span>{date.format(new Date(worksheet.createdAt))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Ehhez a jegyhez még nem tartozik munkalap.</p>
        )}
      </section>
    </section>
  );
}
