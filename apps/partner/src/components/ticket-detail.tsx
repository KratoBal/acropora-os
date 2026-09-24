"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { partnerStatusTone, serviceJobWorksheetLabel } from "@acropora/types";
import {
  Alert,
  Button,
  ServiceContextRow,
  ServiceDetailHeader,
  ServiceDetailSplit,
  ServiceIcon,
  ServicePanel,
  ServicePanelHeading,
  ServiceStatusBadge,
} from "@acropora/ui";

import { TicketFieldsEditor } from "./ticket-fields-editor";

import { partnerApi } from "@/lib/api";
import { naploSor } from "@/lib/naplo-sor";
import { DocumentPanel } from "./document-panel";
import { Empty, Message } from "./ticket-list";

/**
 * A HIBAJEGY ADATLAPJA A PARTNER PORTÁLON, a `service-job-detail-page.tsx`
 * mintája szerint (Balázs kérése, 2026-09-21, megerősítve 2026-09-24 07:28
 * UTC). A KERET csere -- fejléc, kéthasábos elrendezés, panelek -- de a
 * TARTALOM-SZŰKÍTÉS, amit az alábbi két szakasz ír le, VÁLTOZATLAN marad.
 *
 * === MI KERÜL RÁ, ÉS MI NEM (Balázs kérése, 2026-09-21) ===
 *
 * Szó szerint: „sot: ugyanaz legyen a hibajegy es a munkalap oldal is", és
 * „csak ott megtudja csinalni azt amihez jogosultsaga van". A tartalom tehát a
 * belső lapé, a kezelői műveletek viszont nem kerülnek át.
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
 * EZT A SZŰKÍTÉST NEM EGY ÚJ, DINAMIKUS JOGOSULTSÁG-RENDSZER VÉGZI --
 * `apps/partner`-ben MA nincs `hasPermission()`-féle futásidejű ellenőrzés
 * (mérve: nulla találat). A fenti négy művelet egyszerűen NINCS a JSX-ben,
 * ugyanúgy, ahogy eddig sem volt; ez a szerkesztés a KERETET cseréli, a
 * kézzel meghozott, dokumentált döntést nem.
 *
 * === AMIT VISZONT KÍNÁLUNK ===
 *
 * A fájl- és fénykép-csatolás marad: a partner a saját jegyéhez ma is csatol,
 * és ez a képesség a korábbi köreinkben épült meg. Ez a lap POZITÍV
 * KONTROLLJA: ha a szűkítés implementációja hibásan MINDENT elrejtene, ez a
 * `DocumentPanel` is eltűnne, és az alábbi teszt erre külön állítást tartalmaz.
 *
 * === A `DocumentPanel` KIVÉTEL, ÉS SZÁNDÉKOSAN AZ ===
 *
 * Az `asset-detail.tsx` (nautilus) és a `worksheet-detail.tsx` is ugyanezt a
 * komponenst hívja, a saját `PANEL`/`PANEL_CIM` osztályaival (`frame.tsx`).
 * Ha itt átalakítanám, mind a három lap kinézete megváltozna -- ez túlmutat
 * a hibajegy-lapok körén. A dobozon belül ezért egy sorban marad a régi
 * keret, amíg a `DocumentPanel` maga nem kap saját kört.
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
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </section>
    );
  if (!ticket) return <p className="text-xs text-muted">Hibajegy betöltése…</p>;
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
      <VisszaLink />
      <ServiceDetailHeader
        eyebrow={ticket.jobNumber}
        title={ticket.title}
        badge={
          <ServiceStatusBadge tone={partnerStatusTone(ticket.partnerStatus)}>
            {ticket.partnerStatusLabel}
          </ServiceStatusBadge>
        }
        sub={ticket.departmentPath?.join(" / ") ?? "Helyszín nincs megadva"}
        actions={
          ticket.partnerStatus === "COMPLETED" ? (
            <Button
              variant="secondary"
              disabled={downloading}
              onClick={() => void downloadPackage()}
            >
              {downloading
                ? "Dokumentumcsomag letöltése…"
                : "Dokumentumcsomag letöltése"}
            </Button>
          ) : null
        }
      />

      {packageError ? (
        <div className="mb-5">
          <Alert
            variant="danger"
            title="Letöltési hiba"
            description={packageError}
          />
        </div>
      ) : null}

      <ServiceDetailSplit
        main={
          <>
            <ServicePanel className="space-y-3">
              <ServicePanelHeading title="Mi a probléma?" />
              {/*
                AZ ÜRES LEÍRÁS KIMONDVA. Egy hiányzó bekezdés ugyanúgy néz ki,
                mint egy betöltési hiba, és a különbséget csak az tudja, aki a
                jegyet felvitte.
              */}
              <p className="whitespace-pre-wrap text-sm leading-6 text-dusk-700">
                {ticket.description ||
                  "A hibajegyhez nem rögzítettek részletes leírást."}
              </p>
              {/*
                CSAK AMIG NINCS MUNKALAP. Amint elindult a munka, a bejelentés
                szövege ahhoz a munkához tartozik, és nem változhat a háta
                mögött. A `worksheets` ugyanaz a lista, amit a lap alján a
                munkalap-doboz is mutat -- nem egy második szűrés ugyanarra.
              */}
              {worksheets.length === 0 ? (
                <TicketFieldsEditor
                  ticketId={ticket.id}
                  title={ticket.title}
                  description={ticket.description}
                  onSaved={() => load()}
                />
              ) : null}
            </ServicePanel>

            <ServicePanel className="space-y-3">
              <ServicePanelHeading title="Mi történt a hibajeggyel?" />
              {ticket.timeline.length ? (
                <ol className="space-y-2" aria-label="A hibajegy naplója">
                  {ticket.timeline.map((entry) => (
                    <li
                      key={`${entry.kind}-${entry.sortKey}`}
                      className="border-b pb-2 text-sm last:border-0"
                    >
                      <div>{naploSor(entry)}</div>
                      <div className="mt-0.5 text-xs text-dusk-500">
                        {date.format(new Date(entry.at))}
                        {entry.kind === "status" && entry.event.actorName
                          ? ` · ${entry.event.actorName}`
                          : ""}
                      </div>
                      {/*
                        A TÖRÖLT CSATOLMÁNY SORA ALATT AZ ÁLL, AMIT A TÖRLÉS
                        ELVITT VOLNA: ki töltötte fel, és mikor. A fájl sora
                        addigra nincs meg, tehát ez az egyetlen hely, ahol ez
                        látszik. Régebbi bejegyzésnél `null`, és olyankor nem
                        írunk semmit: a „nem tudjuk" nem ugyanaz, mint a
                        „nem volt".
                      */}
                      {entry.kind === "document" &&
                      entry.removal.uploadedAt !== null ? (
                        <div className="mt-0.5 text-xs text-dusk-500">
                          Feltöltve:{" "}
                          {date.format(new Date(entry.removal.uploadedAt))}
                          {entry.removal.uploadedByName
                            ? ` · ${entry.removal.uploadedByName}`
                            : ""}
                        </div>
                      ) : null}
                      {/*
                        A BELSŐ MEGJEGYZÉS NEM MEGY A PARTNER ELÉ (Balázs
                        döntése, 2026-09-21 10:5x UTC, Discord, szó szerint:
                        „a megjegyzes nem kell a nev igen"). A KOLLÉGA NEVE
                        MARAD, a sor fölött, az időpont mellett.
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
            </ServicePanel>

            <DocumentPanel
              title="Fényképek és fájlok"
              items={documents}
              loadBlob={(documentId) =>
                partnerApi.ticketDocumentBlob(id, documentId)
              }
              upload={(file, caption) =>
                partnerApi.uploadTicketDocument(id, file, caption)
              }
              onUploaded={load}
            />

            {/*
              A MUNKALAPOK A CSATOLMÁNYOK UTÁN ÁLLNAK, ugyanabban a
              sorrendben, mint a belső lapon. Nem ízlés: a fénykép a
              BEJELENTETT hibáról szól, a munkalap arról, amit TETTÜNK vele.
            */}
            <ServicePanel className="space-y-3">
              <ServicePanelHeading title="Munkalapok a jegy mögött" />
              {worksheets.length ? (
                <ul className="space-y-2">
                  {worksheets.map((worksheet) => (
                    <li
                      key={worksheet.id}
                      className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0"
                    >
                      <Link
                        className="font-medium text-ink hover:text-brand-700"
                        href={`/munkalapok/${worksheet.id}`}
                      >
                        {serviceJobWorksheetLabel(worksheet)}
                      </Link>
                      <span className="text-xs text-dusk-500">
                        {date.format(new Date(worksheet.createdAt))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-dusk-500">
                  Ehhez a jegyhez még nem tartozik munkalap.
                </p>
              )}
            </ServicePanel>
          </>
        }
        side={
          <>
            {/*
              AZ ÜGY ADATAI: AMI A JEGYET AZONOSÍTJA A HELYSZÍNEN. A belső
              lapon ez külön doboz a jobb hasábban, ugyanezzel a három sorral
              -- a „Partner" sor kivételével, ami itt maga a bejelentkezett
              cég, tehát egy üres ismétlés lenne.
            */}
            <ServicePanel>
              <ServicePanelHeading title="Az ügy adatai" />
              <ServiceContextRow icon="clock" label="Bejelentés ideje">
                {date.format(new Date(ticket.createdAt))}
              </ServiceContextRow>
              <ServiceContextRow icon="location" label="Helyszín">
                {ticket.departmentPath?.join(" / ") ?? "Nincs megadva"}
              </ServiceContextRow>
              <ServiceContextRow icon="eye" label="Az ügy állapota">
                {ticket.partnerStatusLabel}
              </ServiceContextRow>
            </ServicePanel>

            <ServicePanel>
              <ServicePanelHeading title="Érintett eszközök" />
              {ticket.assets.length ? (
                <ul className="space-y-2">
                  {ticket.assets.map((asset) => (
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
                          A SOR AZ ESZKÖZ ADATLAPJÁRA VISZ, és az `assetId`-vel,
                          nem a csatolás sorának azonosítójával: a kettő két
                          különböző dolog, és az utóbbi egy nem létező lapra
                          vinne.
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
                  A hibajegyhez nincs eszköz megjelölve.
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
 * A VISSZAFELE VEZETO UT.
 *
 * HELYBEN ÁLL, NEM A `@acropora/ui`-BAN: a `next/link`-et használja, a
 * `@acropora/ui` viszont keretfüggetlen marad -- ugyanaz az indok, amiért az
 * `apps/web` saját `ServiceBackLink`-je sem költözött át (lásd a
 * `packages/ui/src/service-detail-chrome.tsx` fejlécében), és ugyanaz a
 * minta, amit az `asset-detail.tsx` saját `VisszaLink()`-je is követ.
 */
function VisszaLink() {
  return (
    <Link
      href="/hibajegyek"
      className="mb-[18px] inline-flex items-center gap-[7px] text-xs text-muted hover:text-brand-700"
    >
      <ServiceIcon name="arrowLeft" className="size-4" />
      Hibajegyek
    </Link>
  );
}
