"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  Button,
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
  assetEventLabel,
  assetStatusLabel,
  assetStatusTone,
  type AssetQrCode,
} from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { DocumentPanel } from "./document-panel";
import { Message, Empty } from "./ticket-list";

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
 * === AZ ELRENDEZÉS A BELSŐ RENDSZERÉ, A KÖZÖS KERETRE ÁLLVA (2026-09-24) ===
 *
 * Balázs kérése, 2026-09-21 14:25:28 UTC: az ügyfél „ugyanolyan elrendezesben
 * es desigban lassa" a lapot, mint mi az app.acropora.hu oldalon. Murena
 * #1041-e (`ticket-portal-visual-parity`) átköltöztette a
 * `ServiceDetailHeader`/`ServicePanel`/`ServiceDataItem` keretet
 * `apps/web`-ből `packages/ui`-ba -- ez a lap ugyanazokat a komponenseket
 * használja, nem egy saját, párhuzamos Tailwind-közelítést.
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
      <section className="flex flex-col gap-4">
        <VisszaLink />
        <Message tone="error" text={error} retry={load} />
      </section>
    );
  if (!asset)
    return <p className="text-[13px] text-muted">Eszköz betöltése…</p>;

  return (
    <section className="flex flex-col gap-4">
      <VisszaLink />
      <ServiceDetailHeader
        eyebrow="ESZKÖZ"
        title={asset.name}
        badge={
          <ServiceStatusBadge tone={assetStatusTone[asset.status]}>
            {assetStatusLabel[asset.status]}
          </ServiceStatusBadge>
        }
        sub={
          asset.partnerInternalCode
            ? `${asset.assetNumber} · ${asset.partnerInternalCode}`
            : asset.assetNumber
        }
      />

      <ServiceDetailSplit
        main={
          <>
            <ServicePanel>
              <ServiceDataGrid>
                <ServiceDataItem label="Helyszín">
                  {asset.unit?.path.join(" / ") ?? "Nincs megadva"}
                </ServiceDataItem>
                <ServiceDataItem label="Cím">
                  {asset.address?.formatted ?? "Nincs megadva"}
                </ServiceDataItem>
                <ServiceDataItem label="Gyártó">
                  {asset.manufacturer ?? "Nincs megadva"}
                </ServiceDataItem>
                <ServiceDataItem label="Teljesítmény">
                  {asset.performance
                    ? `${asset.performance}${
                        asset.performanceUnit
                          ? ` ${asset.performanceUnit.code}`
                          : ""
                      }`
                    : "Nincs megadva"}
                </ServiceDataItem>
                <ServiceDataItem label="Telepítés">
                  {datum(asset.installedAt)}
                </ServiceDataItem>
                <ServiceDataItem label="Garancia lejárata">
                  {datum(asset.warrantyExpiresAt)}
                </ServiceDataItem>
                <ServiceDataItem label="Karbantartási intervallum">
                  {asset.serviceIntervalDays
                    ? `${asset.serviceIntervalDays} nap`
                    : "Nincs megadva"}
                </ServiceDataItem>
                <ServiceDataItem label="Utolsó karbantartás">
                  {datum(asset.lastServicedAt)}
                </ServiceDataItem>
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
                  alatt. A lap saját szokása a hiányra a "Nincs megadva", és
                  minden testvér sor ezt használja.
                */}
                <ServiceDataItem label="Matricakód">
                  {asset.labelCode ?? "Nincs megadva"}
                </ServiceDataItem>
              </ServiceDataGrid>
            </ServicePanel>

            {/*
              A DOKUMENTUMOK ES A FENYKEPEK UGYANAZON A PANELEN allnak,
              ugyanugy, mint a hibajegyen: a panel a kepeket csempekent
              rajzolja, a tobbit nevvel. A bajtokat a SAJAT hivasunk hozza
              (blob + object URL), mert a bongeszo `<img>` eleme nem kuld
              Authorization fejlecet.

              A `DocumentPanel` KIVETEL, ES SZANDEKOSAN AZ: a
              `worksheet-detail.tsx` es a `ticket-detail.tsx` is ugyanezt a
              komponenst hivja, a sajat `PANEL`/`PANEL_CIM` osztalyaival. Ha
              itt atalakitanam, mind a harom lap kulseje megvaltozna -- ez
              tulmutat ezen a koron, amig a `DocumentPanel` maga nem kap
              sajat kort (lasd `ticket-detail.tsx` fejleceben ugyanezt a
              megjegyzest).
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

            <ServicePanel>
              <ServicePanelHeading title="Előzmények" />
              {asset.events.length ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {asset.events.map((esemeny) => (
                    <li
                      key={esemeny.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-dusk-200 pb-2 last:border-0 last:pb-0"
                    >
                      <strong className="text-[13px] font-semibold text-ink">
                        {assetEventLabel[esemeny.type]}
                      </strong>
                      <span className="text-[12px] text-muted">
                        {new Date(esemeny.occurredAt).toLocaleString("hu-HU")}
                        {esemeny.actor ? ` · ${esemeny.actor.displayName}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty
                  title="Nincs előzmény"
                  text="Ehhez az eszközhöz még nem rögzítettünk eseményt."
                />
              )}
            </ServicePanel>
          </>
        }
        side={
          /*
            A QR-KÁRTYA CSAK MEGJELENÍT ÉS LETÖLTHETŐVÉ TESZ, NEM CSERÉL --
            lásd a komponens fejlécében a vonatkozó szakaszt. Ha az eszköznek
            nincs QR-kódja (a lekérdezés elhasalt vagy `null`-t adott), a
            kártya nem jelenik meg -- egy üres QR-doboz rosszabb lenne a
            hiányánál.
          */
          qr ? (
            <ServicePanel>
              <ServicePanelHeading title="QR-azonosító" />
              <p className="mt-1 mb-4 text-[13px] leading-[1.5] text-muted">
                A matrica leolvasása az Acropora OS mobilalkalmazásban nyitja
                meg ezt az eszközt.
              </p>
              <div
                className="mx-auto aspect-square max-w-[220px] overflow-hidden rounded-xl border border-line bg-white p-3"
                aria-label={`${asset.assetNumber} QR-kódja`}
                dangerouslySetInnerHTML={{ __html: qr.svg }}
              />
              <div className="mt-4">
                <Button onClick={downloadQr}>
                  <ServiceIcon name="sheet" className="mr-1.5 size-4" />
                  QR letöltése (SVG)
                </Button>
              </div>
            </ServicePanel>
          ) : null
        }
      />
    </section>
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
      className="text-[13px] text-muted no-underline hover:text-ink"
      href="/eszkozok"
    >
      ← Eszközök
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
