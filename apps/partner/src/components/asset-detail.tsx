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
  PilotThemeRoot,
  PilotTimeline,
  pilotBadgeVariantForTone,
} from "@acropora/ui";
import {
  assetEventLabel,
  assetStatusLabel,
  assetStatusTone,
  type AssetQrCode,
} from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { DocumentPanel } from "./document-panel";
import { Message } from "./ticket-list";

/**
 * AZ ESZKÖZ ADATLAPJA A PARTNER PORTÁLON.
 *
 * === MI KERÜL RÁ, ÉS MI NEM (Balázs kérése, 2026-09-21) ===
 *
 * Szó szerint: „ha rakattint akkor ugfyanaz jojjon be mint az app oldalon, csak
 * ne tudjon szerkeszteni". A tartalom tehát a belső lapé
 * (`apps/web/.../asset-detail-page.tsx`), a műveletek viszont nem.
 *
 * === A NÉGY MŰVELET, AMI NINCS ITT, ÉS AZ INDOK PONTOSAN ===
 *
 * Szerkesztés, QR-csere, kivezetés, végleges törlés.
 *
 * AMIT A LAP INDOKKÉNT MOND, AZ CSAK AZ EGYIKRE IGAZ, ÉS EZT MÉRTEM:
 * a `PARTNER_SERVICE` szerep `[SERVICE_VIEW, SERVICE_MANAGE]` (auth.ts:388),
 * a szerkesztés (`PATCH /service/assets/:id`) és a QR-csere
 * (`POST :id/qr/rotate`) viszont `SERVICE_MANAGE` alatt áll -- vagyis a partner
 * fiókjának MA VAN joga hozzájuk. Egyedül a törlés áll külön jog alatt
 * (`SERVICE_ASSET_DELETE`), a kivezetésnek pedig nincs saját végpontja: az
 * `archivedAt` a szerkesztés része.
 *
 * === EZ NEM JOGOSULTSÁG-FÜGGŐ MEGJELENÍTÉS, LEZÁRT DÖNTÉS (acrobot, 2026-09-24 09:43) ===
 *
 * Balázs 2026-09-21-i két mondata ("ne tudjon szerkeszteni" + "csak ott ahol
 * jogosultsága van") ELSŐ OLVASATRA jogosultság-alapú megjelenítést
 * sugallhat -- DE a `PARTNER_SERVICE` szerepnek MA MEGVAN a `SERVICE_MANAGE`
 * joga, tehát egy jogosultság-alapú megjelenítés MA szerkesztést, QR-cserét
 * és kivezetést adna a partnernek, amit ő nem kért. A helyes olvasat: ez a
 * négy művelet AKKOR IS hiányzik, ha a hívó `SERVICE_MANAGE` joggal bír -- a
 * kód FELTÉTEL NÉLKÜL nem hívja ezeket a végpontokat, nem egy jogosultság-ág
 * mögé rejtve. A `portal-wiring.spec.ts` négy állítása pontosan ezt méri.
 * Belső megjegyzés emiatt semmilyen formában nem jelenik meg.
 *
 * === AZ ELRENDEZÉS -- FIGMA 9. KÖR, PILOT-AQUA (2026-09-25) ===
 *
 * Balázs kérése, 2026-09-21 14:25:28 UTC: az ügyfél „ugyanolyan elrendezesben
 * es desigban lassa" a lapot, mint mi az app.acropora.hu oldalon. Az előző
 * kör a belső, violet `ServiceDetailHeader`/`ServicePanel`/`ServiceDataItem`
 * keretet vette át -- ez a kör a portál egészét pilot-aqua design-
 * rendszerre viszi, a hibajegy-adatlappal (#1127) egyező mintát követve:
 * `PilotCard`/`PilotDataRow`/`PilotTimeline` (`packages/ui/src/pilot-ui.tsx`),
 * a `PartnerPortalScreen.tsx:892-971` átültetése.
 *
 * A TARTALOM VÁLTOZATLAN. Ugyanaz a kilenc adatsor, ugyanabban a sorrendben,
 * ugyanazokkal a hívásokkal -- csak a KERET cserélt.
 *
 * === A QR-KÁRTYA, MEGJELENÍTÉS ÉS LETÖLTÉS, CSERE NÉLKÜL (2026-09-24) ===
 *
 * A `GET :id/qr` végpont `SERVICE_VIEW`-t kér, nem `SERVICE_MANAGE`-et
 * (`service-assets.controller.ts`) -- minden partner lekérheti, aki ma is
 * látja az eszközt. A `POST :id/qr/rotate` (a csere) viszont a fent
 * kifejtett, Balázs által kifejezetten kizárt négy művelet egyike, és AZ
 * MARAD KIZÁRVA: ez a kártya csak a MÁR KIADOTT matricát mutatja és teszi
 * letölthetővé, nem cserél.
 *
 * === AMIT VISZONT KÍNÁLUNK ===
 *
 * A dokumentum-feltöltés marad: a szerveren `SERVICE_MANAGE` alatt áll, a
 * partner viseli ezt a jogot, és a feladatlap kizárt-listáján NEM szerepel. A
 * partner a hibajegyéhez ma is csatol fájlt; ez ugyanaz a képesség, más lapon.
 */
export function AssetDetail({ id }: { id: string }) {
  const [asset, setAsset] = useState<Awaited<
    ReturnType<typeof partnerApi.asset>
  > | null>(null);
  const [documents, setDocuments] = useState<
    Awaited<ReturnType<typeof partnerApi.assetDocuments>>["items"]
  >([]);
  const [qr, setQr] = useState<AssetQrCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, documentList] = await Promise.all([
        partnerApi.asset(id),
        partnerApi.assetDocuments(id),
      ]);
      setAsset(detail);
      setDocuments(documentList.items);
      /*
        A QR KÜLÖN, SAJÁT HIBAÁGON: ha ez a hívás elhasal (pl. az eszköznek
        még nincs matricája), az adatlap többi része akkor is megjelenjen --
        egy hiányzó QR nem teszi az EGÉSZ adatlapot betölthetetlenné.
      */
      void partnerApi
        .assetQr(id)
        .then(setQr)
        .catch(() => setQr(null));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az eszköz nem tölthető be.",
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const downloadQr = () => {
    if (!qr) return;
    const blob = new Blob([qr.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${qr.assetNumber}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (error)
    return (
      <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </PilotThemeRoot>
    );
  if (!asset)
    return (
      <PilotThemeRoot className="bg-pilot-grey-50 px-8 py-6">
        <p className="text-sm text-pilot-grey-400">Eszköz betöltése…</p>
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <VisszaLink />
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          ESZKÖZ
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          {asset.name}
        </h1>
        <div className="mt-2 flex items-center gap-2">
          <PilotBadge
            variant={pilotBadgeVariantForTone(assetStatusTone[asset.status])}
          >
            {assetStatusLabel[asset.status]}
          </PilotBadge>
          <span className="font-mono text-xs text-pilot-grey-400">
            {asset.partnerInternalCode
              ? `${asset.assetNumber} · ${asset.partnerInternalCode}`
              : asset.assetNumber}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 px-8 py-6 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-5">
          <PilotCard>
            <PilotCardHeader title="Adatok" />
            <div className="px-5 py-2">
              <PilotDataRow
                label="Helyszín"
                value={asset.unit?.path.join(" / ")}
              />
              <PilotDataRow label="Cím" value={asset.address?.formatted} />
              <PilotDataRow label="Gyártó" value={asset.manufacturer} />
              <PilotDataRow
                label="Teljesítmény"
                value={
                  asset.performance
                    ? `${asset.performance}${
                        asset.performanceUnit
                          ? ` ${asset.performanceUnit.code}`
                          : ""
                      }`
                    : undefined
                }
              />
              <PilotDataRow
                label="Telepítés"
                value={datum(asset.installedAt)}
              />
              <PilotDataRow
                label="Garancia lejárata"
                value={datum(asset.warrantyExpiresAt)}
              />
              <PilotDataRow
                label="Karbantartási intervallum"
                value={
                  asset.serviceIntervalDays
                    ? `${asset.serviceIntervalDays} nap`
                    : undefined
                }
              />
              <PilotDataRow
                label="Utolsó karbantartás"
                value={datum(asset.lastServicedAt)}
              />
              {/*
                A MATRICA KÓDJA, ÉS A CÍMKE IS EZÉRT VÁLTOZOTT.

                Itt eddig a `qrToken` állt, "QR-azonosító" néven. Az a mező
                egy uuid, nem a matrica száma -- és épp a CÍMKE tette
                csábítóvá: a felhasználó a matricát hívja így. Egy jó
                tartalom rossz cím alatt ugyanaz a csapda marad, ezért a
                kettő együtt mozdult.

                A `qrToken` NEM került mellé. Nem titok, de a partnernek
                nincs jelentése, ÉS ez az a kulcs, amit a `scan/:qrToken`
                végpont elfogad. Egy képernyőről leolvasható kulcs akkor is
                fölösleges kockázat, ha ma nem tágít hatókört.

                ÉS A TARTALÉK ITT MÁS, MINT A LISTÁKON -- szándékosan. A
                listasorban a matrica hiányában az eszköz-szám marad, mert
                ott semmi más nem azonosítja a sort. Ezen a lapon az
                eszköz-szám MÁR OTT ÁLL a fejlécben, tehát ugyanaz a
                tartalék két helyen mutatná ugyanazt, két különböző cím
                alatt. A lap saját szokása a hiányra a `PilotDataRow` beépített
                "Nincs megadva" tartaléka, ugyanaz, mint minden testvér sor.
              */}
              <PilotDataRow label="Matricakód" value={asset.labelCode} />
            </div>
          </PilotCard>

          {/*
            A DOKUMENTUMOK ES A FENYKEPEK UGYANAZON A PANELEN allnak,
            ugyanugy, mint a hibajegyen: a panel a kepeket csempekent
            rajzolja, a tobbit nevvel. A bajtokat a SAJAT hivasunk hozza
            (blob + object URL), mert a bongeszo `<img>` eleme nem kuld
            Authorization fejlecet.

            A `DocumentPanel` EBBEN A KÖRBEN IS KIVETEL, ES SZANDEKOSAN AZ:
            a `worksheet-detail.tsx` es a `ticket-detail.tsx` (#1127) is
            ugyanezt a komponenst hivja, a sajat `PANEL`/`PANEL_CIM`
            osztalyaival es a `globals.css` `document-*` szabalyaival. Ha itt
            atalakitanam, mindharom lap kulseje megvaltozna, es ez a
            beolvasztas AZONNAL elesre megy -- ugyanaz a dontes, amit a
            `ticket-detail.tsx` fejleceben is kimondtam.
          */}
          <DocumentPanel
            title="Dokumentumok és fényképek"
            items={documents.map((item) => ({
              ...item,
              caption: item.caption ?? null,
            }))}
            loadBlob={(documentId) =>
              partnerApi.assetDocumentBlob(id, documentId)
            }
            upload={(file, caption) =>
              partnerApi.uploadAssetDocument(id, file, caption)
            }
            onUploaded={load}
          />

          <PilotCard>
            <PilotCardHeader title="Előzmények" />
            <div className="px-5 py-4">
              {asset.events.length ? (
                <PilotTimeline
                  items={asset.events.map((esemeny) => ({
                    key: esemeny.id,
                    text: assetEventLabel[esemeny.type],
                    meta: `${new Date(esemeny.occurredAt).toLocaleString("hu-HU")}${
                      esemeny.actor ? ` · ${esemeny.actor.displayName}` : ""
                    }`,
                  }))}
                />
              ) : (
                <p className="py-2 text-sm italic text-pilot-grey-500">
                  Ehhez az eszközhöz még nem rögzítettünk eseményt.
                </p>
              )}
            </div>
          </PilotCard>
        </div>

        <div className="flex flex-col gap-5">
          {/*
            A QR-KÁRTYA CSAK MEGJELENÍT ÉS LETÖLTHETŐVÉ TESZ, NEM CSERÉL --
            lásd a komponens fejlécében a vonatkozó szakaszt. Ha az eszköznek
            nincs QR-kódja (a lekérdezés elhasalt vagy `null`-t adott), a
            kártya nem jelenik meg -- egy üres QR-doboz rosszabb lenne a
            hiányánál.
          */}
          {qr ? (
            <PilotCard>
              <PilotCardHeader title="QR-azonosító" />
              <div className="px-5 py-4">
                <p className="mb-4 text-sm leading-6 text-pilot-grey-500">
                  A matrica leolvasása az Acropora OS mobilalkalmazásban nyitja
                  meg ezt az eszközt.
                </p>
                <div
                  className="mx-auto aspect-square max-w-[220px] overflow-hidden rounded-xl bg-white p-3 ring-1 ring-pilot-grey-200"
                  aria-label={`${asset.assetNumber} QR-kódja`}
                  dangerouslySetInnerHTML={{ __html: qr.svg }}
                />
                <div className="mt-4">
                  <PilotButton variant="secondary" onClick={downloadQr}>
                    <Icon name="download" size={14} />
                    QR letöltése (SVG)
                  </PilotButton>
                </div>
              </div>
            </PilotCard>
          ) : null}
        </div>
      </div>
    </PilotThemeRoot>
  );
}

/** A VISSZAFELE VEZETO UT.
 *
 * HELYBEN ÁLL, NEM A `@acropora/ui`-BAN: a `next/link`-et használja, a
 * `@acropora/ui` viszont keretfüggetlen marad -- ugyanaz az indok, amiért az
 * `apps/web` saját `ServiceBackLink`-je sem költözött át (lásd a
 * `packages/ui/src/service-detail-chrome.tsx` fejlécében), és ugyanaz a
 * minta, amit a `ticket-detail.tsx` saját `VisszaLink()`-je is követ.
 */
function VisszaLink() {
  return (
    <Link
      href="/eszkozok"
      className="mb-3 inline-flex items-center gap-1.5 text-xs text-pilot-grey-400 hover:text-pilot-grey-700"
    >
      <Icon name="chevron-left" size={12} />
      Eszközök
    </Link>
  );
}

/**
 * A HIÁNYZÓ DÁTUM KIMONDVA ÁLL, nem üres cellaként. Egy üres hely három
 * különböző dolgot jelenthet (nincs, nem látja, nem töltődött be), és a
 * felület ezeket egybemosná.
 */
function datum(ertek?: string): string {
  return ertek ? new Date(ertek).toLocaleDateString("hu-HU") : "Nincs megadva";
}
