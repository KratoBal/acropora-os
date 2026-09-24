import type { ServiceTone } from "@/components/service/service-theme";
import type { AssetStatus } from "@acropora/types";

/**
 * A NEGY CIMKE-SZOTAR ATKOLTOZOTT A `@acropora/types`-ba (2026-09-24), a
 * `worksheetStatusLabel` mintajara -- lasd ott a teljes indoklast. Ez a
 * fajl re-exportalja oket, hogy a meglevo `./asset-labels`-re hivatkozo
 * webes importok valtozatlanul maradjanak.
 */
export {
  assetKindLabel,
  assetStatusLabel,
  assetCriticalityLabel,
  assetEventLabel,
} from "@acropora/types";

/**
 * AZ ESZKOZALLAPOT SZINE Balazs 2026-09-15-i szerviz-designjaban.
 *
 * EZ AZ EGYETLEN HELY: eddig ugyanez a szabaly KET fuggvenyben allt, beture
 * azonos torzzsel (`asset-list-page.tsx` es `asset-detail-page.tsx`), es a
 * ketto kozul barmelyiket at lehetett volna irni ugy, hogy a masik marad.
 *
 * EGY VALTOZAS A KORABBI ALAKHOZ KEPEST, ES SZANDEKOS: a "Nem uzemel" eddig
 * amber volt (a `RETIRED`-en kivul minden nem-aktiv allapot az volt), a design
 * szerint PIROS. Ez nem szinezes: a javitas alatt allo eszkoz VART allapot, a
 * nem uzemelo pedig egy meg fel nem vett teendo, es a listan ma ugyanugy
 * nezett ki a ketto.
 *
 * ES A KET TARTALEK EPP EZERT NEM PIROS (2026-09-16). A piros indoka a fenti
 * bekezdesben all: a "nem uzemel" FEL NEM VETT TEENDO volt. A tartalek nem az
 * -- SZANDEKOS allapot, es pontosan ezert kerte Balazs a szetvalasztast: a
 * regi ertek egy kalapba tette azt, ami elromlott es senki nem foglalkozik
 * vele, meg azt, amit keszakarva tartunk tartalekban. Ha a ket uj ertek is
 * piros lenne, a szetvalasztas a LISTAN nem latszana.
 *
 * A KETTO UGYANAZT A SZINT KAPJA, es ez sem feledekenyseg: a kulonbseget a
 * FELIRAT hordozza ("Meleg" / "Hideg"), es a paletta nem hordoz olyan
 * megkulonboztetest, amit valaki eldontott volna. Egy kitalalt szin-kulonbseg
 * egy nem letezo design-dontesre hivatkozna.
 */
export const assetStatusTone: Record<AssetStatus, ServiceTone> = {
  ACTIVE: "green",
  IN_REPAIR: "amber",
  WARM_STANDBY: "blue",
  COLD_STANDBY: "blue",
  RETIRED: "neutral",
};
