"use client";

import type { WorksheetSelectablePartner } from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { worksheetsApi } from "@/lib/api/worksheets";

/**
 * PARTNER-VÁLASZTÓ A HIBAJEGYHEZ, KÖZÖS, KÉT KÉPERNYŐNEK.
 *
 * A HALMAZ 2026-09-03 ÓTA MÁS, ÉS EZ BALÁZS DÖNTÉSE (09:32, Discord, szó
 * szerint: „nem lehet hibajegyet nyitni nem szervizpartnerre"). A választó a
 * `selectable-partners` végpontból dolgozik -- ugyanabból, amiből a munkalap --,
 * nem a vevő-listából.
 *
 * MIÉRT SZÁMÍT: a vevő-lista a tükör-sorokat KIZÁRJA (`partner: null`), a
 * munkalapok viszont ÉPP azokon állnak. A két halmaz szerkezetileg diszjunkt
 * volt, tehát a felületen felvitt jegyhez SOHA egyetlen munkalap sem volt
 * csatolható -- és a felhasználó ezt csak a csatolásnál tudta meg, egy
 * elutasításból.
 *
 * ÉS AZÉRT LETT LEGÖRDÜLŐ, MERT A KERESÉS INDOKA MEGSZŰNT. A korábbi változat
 * azért keresett és nem listázott, mert a vevő-lista LAPOZOTT (egy oldal
 * legfeljebb százat ad), és egy legördülő csendben levágta volna a többit. A
 * `selectable-partners` NEM lapozott: a teljes listát adja, rendezve. Egy
 * megtartott kereső itt már csak a régi indok maradványa lenne.
 *
 * AZ AKTÍV-SZŰRÉS NEM A HÍVÓÉ. A `selectablePartnerWhere` már a szerveren szűr
 * (szerviz, aktív, nem törölt, van munkalap-rövidítése, van tükör-sora), és
 * saját állítása is van rá. Ha itt is szűrnénk, az úgy nézne ki, mintha a
 * szerver nem tenné -- és a következő olvasó a szervert „javítaná" hozzá.
 */
export function PartnerPicker({
  id,
  value,
  onPick,
  onClear,
  emptyLabel = "Válassz partnert",
}: {
  id: string;
  /**
   * A KIVALASZTOTT PARTNER, HA A HIVO VEZERELNI AKARJA A MEZOT.
   *
   * ELHAGYHATO, ES AZ ALAPERTELMEZES A REGI VISELKEDES: ha nincs megadva, a
   * mezo vezereletlen marad (`defaultValue=""`), ahogy a ket eredeti hivonal
   * eddig is. Ott a valaszto egy MOST keletkezo jegyhez vagy laphoz valaszt,
   * tehat nincs korabbi ertek, amit mutatnia kellene.
   *
   * A FELHASZNALO-SZERKESZTONEL VISZONT VAN: egy mar vevohoz kotott fiok
   * lapjan a vezereletlen mezo "Valassz partnert" felirattal allna, vagyis azt
   * mondana, hogy nincs kotes -- holott van. Ez nem kenyelmi kulonbseg, hanem
   * egy hamis allitas a kepernyon.
   */
  value?: string;
  onPick: (partner: WorksheetSelectablePartner) => void;
  /**
   * AZ URES ERTEK VALASZTASA -- KULON, ES SZANDEKOSAN OPCIONALISAN.
   *
   * Az `onPick` ma CSAK akkor sul el, ha talalt partnert, tehat az ures opcio
   * valasztasa a ket eredeti hivonal NEM csinal semmit. Ez ott helyes: egy uj
   * jegy urlapjan nincs mit torolni.
   *
   * Ahol a mezo egy MEGLEVO kotest mutat, ott az ures opcio maga a muvelet (a
   * kotes megszuntetese), es azt ki KELL tudni valasztani. Uj agkent all, nem
   * az `onPick` kiszelesitesekent: egy `partner | null` parameter a ket
   * eredeti hivo viselkedeset is megvaltoztatta volna, csendben.
   */
  onClear?: () => void;
  emptyLabel?: string;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const [partners, setPartners] = useState<WorksheetSelectablePartner[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    worksheetsApi
      .selectablePartners(token, controller.signal)
      .then((response) => {
        setPartners(response.items);
        setLoaded(true);
      })
      // A LISTA HIBÁJA NEM ÁLLÍTJA MEG A KÉPERNYŐT, de a `loaded` sem billen
      // át: egy hibába futott betöltés NEM ugyanaz, mint egy üres lista, és a
      // két állapot két különböző mondatot érdemel.
      .catch(() => undefined);
    return () => controller.abort();
  }, [token]);

  if (loaded && partners.length === 0) {
    /**
     * A HIÁNY IS ÁLLÍTÁS, ÉS MEGNEVEZI A FELTÉTELT. Egy üres legördülő
     * önmagában úgy nézne ki, mint egy betöltési hiba -- és a felhasználó nem
     * tudná, hogy a partner nem hiányzik, hanem nem felel meg.
     */
    return (
      <p className="text-sm text-slate-500">
        Nincs kiválasztható szervizpartner. Egy partner akkor jelenik meg itt,
        ha szerviz partnerként aktív, és fel van véve a munkalap-rövidítése.
      </p>
    );
  }

  return (
    <select
      id={id}
      className="rounded border px-2 py-1 text-sm"
      {...(value === undefined ? { defaultValue: "" } : { value })}
      onChange={(event) => {
        const picked = partners.find(
          (partner) => partner.customerId === event.target.value,
        );
        if (picked) onPick(picked);
        else onClear?.();
      }}
    >
      <option value="">{emptyLabel}</option>
      {partners.map((partner) => (
        <option key={partner.customerId} value={partner.customerId}>
          {partner.name} ({partner.partnerCode})
        </option>
      ))}
    </select>
  );
}
