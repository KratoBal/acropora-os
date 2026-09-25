"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { serviceJobWorksheetLabel } from "@acropora/types";
import {
  Icon,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataRow,
  PilotThemeRoot,
  PilotTimeline,
  partnerStatusBadgeVariant,
} from "@acropora/ui";

import { TicketFieldsEditor } from "./ticket-fields-editor";

import { partnerApi } from "@/lib/api";
import { naploSor } from "@/lib/naplo-sor";
import { DocumentPanel } from "./document-panel";
import { Message } from "./ticket-list";

/**
 * A HIBAJEGY ADATLAPJA A PARTNER PORTÁLON -- FIGMA 9. KÖR, a Make-terv
 * `PartnerPortalScreen.tsx:626-738` átültetése.
 *
 * VIZUÁLIS VÁLTÁS A KORÁBBI KÖRHÖZ KÉPEST: az előző kör a belső, violet
 * `ServiceDetailHeader`/`ServiceDetailSplit`/`ServicePanel`/
 * `ServiceStatusBadge` keretet vette át -- ez a kör a portál egészét
 * pilot-aqua design-rendszerre viszi, a listákkal (#1117/#1119/#1120)
 * egyező mintát követve. Két új, megosztott komponens született hozzá
 * (`PilotDataRow`, `PilotTimeline`, `packages/ui/src/pilot-ui.tsx`) --
 * mindkettőt a tervezett eszköz- és munkalap-adatlap is használni fogja.
 *
 * === MI KERÜL RÁ, ÉS MI NEM (Balázs kérése, 2026-09-21) -- VÁLTOZATLAN ===
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
 * === A `DocumentPanel` EBBEN A KÖRBEN IS KIVÉTEL, ÉS SZÁNDÉKOSAN AZ ===
 *
 * Az `asset-detail.tsx` és a `worksheet-detail.tsx` is ugyanezt a komponenst
 * hívja, a saját `PANEL`/`PANEL_CIM` osztályaival (`frame.tsx`) és a
 * `globals.css` `document-*` szabályaival. Ha itt átalakítanám, mind a három
 * lap kinézete megváltozna, és a `globals.css` egy megosztott, sok helyen élő
 * szabálycsoportja mozdulna -- ez túlmutat egyetlen adatlap körén, főleg úgy,
 * hogy ez a beolvasztás AZONNAL élesre megy. A dobozon belül ezért egy
 * sorban marad a régi keret, amíg a `DocumentPanel` maga nem kap saját kört
 * -- ugyanaz a döntés, amit a korábbi kör is hozott, csak most a pilot-aqua
 * lapon belül marad egy violet doboz, nem a violet lapon belül egy violet
 * doboz. A vizuális törés emiatt LÁTHATÓ marad, de tudatosan.
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
      <PilotThemeRoot className="-mx-5 -mt-10 -mb-16 max-w-none bg-pilot-grey-50 px-8 py-6">
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </PilotThemeRoot>
    );
  if (!ticket)
    return (
      <PilotThemeRoot className="-mx-5 -mt-10 -mb-16 max-w-none bg-pilot-grey-50 px-8 py-6">
        <p className="text-sm text-pilot-grey-400">Hibajegy betöltése…</p>
      </PilotThemeRoot>
    );
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
    <PilotThemeRoot className="-mx-5 -mt-10 -mb-16 max-w-none bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <VisszaLink />
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          {ticket.jobNumber}
        </p>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-pilot-grey-900">
              {ticket.title}
            </h1>
            <div className="mt-2 flex items-center gap-2">
              <PilotBadge
                variant={partnerStatusBadgeVariant(ticket.partnerStatus)}
              >
                {ticket.partnerStatusLabel}
              </PilotBadge>
              <span className="text-xs text-pilot-grey-400">
                {ticket.departmentPath?.join(" / ") ?? "Helyszín nincs megadva"}
              </span>
            </div>
          </div>
          {ticket.partnerStatus === "COMPLETED" ? (
            <PilotButton
              variant="secondary"
              disabled={downloading}
              onClick={() => void downloadPackage()}
            >
              <Icon name="download" size={14} />
              {downloading
                ? "Dokumentumcsomag letöltése…"
                : "Dokumentumcsomag letöltése"}
            </PilotButton>
          ) : null}
        </div>
      </div>

      {packageError ? (
        <div className="px-8 pt-4">
          <p
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {packageError}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 px-8 py-6 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-5">
          <PilotCard>
            <PilotCardHeader title="Mi a probléma?" />
            <div className="space-y-3 px-5 py-4">
              {/*
                AZ ÜRES LEÍRÁS KIMONDVA. Egy hiányzó bekezdés ugyanúgy néz ki,
                mint egy betöltési hiba, és a különbséget csak az tudja, aki a
                jegyet felvitte.
              */}
              <p className="whitespace-pre-wrap text-sm leading-6 text-pilot-grey-700">
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
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Mi történt a hibajeggyel?" />
            <div className="px-5 py-4">
              {ticket.timeline.length ? (
                <PilotTimeline
                  items={ticket.timeline.map((entry) => ({
                    key: `${entry.kind}-${entry.sortKey}`,
                    text: naploSor(entry),
                    /*
                      A BELSŐ MEGJEGYZÉS NEM MEGY A PARTNER ELÉ (Balázs
                      döntése, 2026-09-21 10:5x UTC, Discord, szó szerint:
                      „a megjegyzes nem kell a nev igen"). A KOLLÉGA NEVE
                      MARAD, az időpont mellett.
                    */
                    meta: (
                      <>
                        {date.format(new Date(entry.at))}
                        {entry.kind === "status" && entry.event.actorName
                          ? ` · ${entry.event.actorName}`
                          : ""}
                        {/*
                          A TÖRÖLT CSATOLMÁNY SORA ALATT AZ ÁLL, AMIT A
                          TÖRLÉS ELVITT VOLNA: ki töltötte fel, és mikor. A
                          fájl sora addigra nincs meg, tehát ez az egyetlen
                          hely, ahol ez látszik. Régebbi bejegyzésnél `null`,
                          és olyankor nem írunk semmit: a „nem tudjuk" nem
                          ugyanaz, mint a „nem volt".
                        */}
                        {entry.kind === "document" &&
                        entry.removal.uploadedAt !== null ? (
                          <span className="mt-0.5 block">
                            Feltöltve:{" "}
                            {date.format(new Date(entry.removal.uploadedAt))}
                            {entry.removal.uploadedByName
                              ? ` · ${entry.removal.uploadedByName}`
                              : ""}
                          </span>
                        ) : null}
                      </>
                    ),
                  }))}
                />
              ) : (
                <p className="py-2 text-sm italic text-pilot-grey-500">
                  A hibajegyhez még nem rögzítettek további eseményt.
                </p>
              )}
            </div>
          </PilotCard>

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
          <PilotCard>
            <PilotCardHeader title="Munkalapok a jegy mögött" />
            <div className="px-5 py-3">
              {worksheets.length ? (
                <ul className="divide-y divide-pilot-grey-50">
                  {worksheets.map((worksheet) => (
                    <li
                      key={worksheet.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <Link
                        className="font-medium text-pilot-grey-900 hover:text-pilot-aqua-700"
                        href={`/munkalapok/${worksheet.id}`}
                      >
                        {serviceJobWorksheetLabel(worksheet)}
                      </Link>
                      <span className="text-xs text-pilot-grey-400">
                        {date.format(new Date(worksheet.createdAt))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-sm italic text-pilot-grey-500">
                  Még nincs csatolt munkalap.
                </p>
              )}
            </div>
          </PilotCard>
        </div>

        <div className="flex flex-col gap-5">
          {/*
            AZ ÜGY ADATAI: AMI A JEGYET AZONOSÍTJA A HELYSZÍNEN. A belső
            lapon ez külön doboz a jobb hasábban, ugyanezzel a három sorral
            -- a „Partner" sor kivételével, ami itt maga a bejelentkezett
            cég, tehát egy üres ismétlés lenne.
          */}
          <PilotCard>
            <PilotCardHeader title="Az ügy adatai" />
            <div className="px-5 py-4">
              <PilotDataRow
                label="Bejelentés ideje"
                value={date.format(new Date(ticket.createdAt))}
              />
              <PilotDataRow
                label="Helyszín"
                value={ticket.departmentPath?.join(" / ")}
              />
              <PilotDataRow
                label="Az ügy állapota"
                value={ticket.partnerStatusLabel}
              />
            </div>
          </PilotCard>

          <PilotCard>
            <PilotCardHeader title="Érintett eszközök" />
            <div className="px-5 py-4">
              {ticket.assets.length ? (
                <ul className="divide-y divide-pilot-grey-50">
                  {ticket.assets.map((asset) => (
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
                          A SOR AZ ESZKÖZ ADATLAPJÁRA VISZ, és az `assetId`-vel,
                          nem a csatolás sorának azonosítójával: a kettő két
                          különböző dolog, és az utóbbi egy nem létező lapra
                          vinne.
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
                  Nincs megadva érintett eszköz.
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
      className="mb-3 inline-flex items-center gap-1.5 text-xs text-pilot-grey-400 hover:text-pilot-grey-700"
    >
      <Icon name="chevron-left" size={12} />
      Hibajegyek
    </Link>
  );
}
