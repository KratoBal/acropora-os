import type { TiltottKodParos } from "./medusa-vetitesi-szuro.js";

/**
 * A VETITESI SZURO LISTAJA -- GENERALT, DE VERZIOKOVETETT.
 *
 * === MIERT ITT, ES NEM KULSO FAJLBAN (acrobot dontese, 2026-09-10) ===
 *
 * Ez a 84 sor nem katalogus-adat, hanem egy DONTES rogzitese: azt mondja meg,
 * mit NEM viszunk ki a boltba. Egy elnemitasi lista a klasszikus helye annak,
 * hogy valami orokre csendben marad, es az egyetlen ellenszere az, hogy
 * LATSZIK, ki tette bele es mikor. Ezt csak a verziokovetes adja meg.
 *
 * A kulso fajl ara az lett volna, ami ma egesz nap a legdragabb hibafajta:
 * hianyzo fajl eseten a szuro CSENDBEN nem szur.
 *
 * === MINDEN SORON OTT AZ OK ES A MERES DATUMA, ES EZ NEM DISZ ===
 *
 * A tiltas nalunk ALLAPOT, nem tulajdonsag: a forras javulhat. Egy sor, ami
 * csak az azonositokat tartalmazza, fel ev mulva megfejthetetlen, es senki nem
 * meri majd kivenni, mert nem tudja, miert kerult be. A datum az, ami valakit
 * ratesz, hogy ujramerje.
 *
 * A tipus KOTELEZOVE teszi mind a kettot: egy indok es datum nelkuli sor le
 * sem fordul. Igy a szabaly nem megallapodas, hanem szerkezet.
 *
 * === A LISTA EREJE NEM EGYENLETES, ES EZ ITT ALL, NEM A KARTYAN ===
 *
 * A 84 sorbol 10 all SZERKEZETI tenyen (7 marka-utkozes ket kitoltott,
 * kulonbozo markaval; 3 nev-alapu marka-utkozes kezi szolistabol). A tobbi 74
 * egy BEALLITOTT kuszobon: Jaccard 0.4, ket pozitiv es harom negativ peldaval
 * validalva. Husz sor 0.30 folott all, negy pontosan 0.38-on -- egy 0.05-os
 * kuszob-mozdulat husz sort mozditana at.
 *
 * EZERT HASZNALJA A SZURO A LISTAT, ES NEM SZAMOLJA UJRA: egy lefagyasztott
 * lista auditalhato, egy ujraszamolas nem -- ugyanaz a kod holnap mas halmazt
 * adna, es senki nem venne eszre.
 *
 * Forras: polip merese, 2026-09-10 (39cbcfed). A parja a 73 elemu KIZAROLISTA,
 * amit a szuro NEM erint: ott sem a helyes ertek, sem az nem dontheto el, hogy
 * hibas-e egyaltalan.
 */
export const TILTOTT_KOD_PAROSOK: readonly TiltottKodParos[] = [
  {
    sku: "xenia",
    ertek: "acant_lord",
    indok:
      'NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0 | az ertek gazdaja: Acanthastrea lordhowensis (3 fejes frag) -"Red Premium"',
    mert: "2026-09-10",
  },
  {
    sku: "Mithrax_sculptus",
    ertek: "Alpheus_bellulus",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0 | az ertek gazdaja: Alpheus bellulus (Tigris pisztolyrák) - szimbionta",
    mert: "2026-09-10",
  },
  {
    sku: "zoa01",
    ertek: "rhodact_indoL",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0 | az ertek gazdaja: Rhodactis indosinensis - Green Hairy Mushroom L méret",
    mert: "2026-09-10",
  },
  {
    sku: "96232",
    ertek: "962",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Gobiodon histrio",
    mert: "2026-09-10",
  },
  {
    sku: "32100",
    ertek: "166",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.1 | az ertek gazdaja: Amphiprion nigripes (Maldív bohóchal)",
    mert: "2026-09-10",
  },
  {
    sku: "4260246927295",
    ertek: "7290100772959",
    indok:
      'MARKA-UTKOZES: forras brand="Nyos", celpont brand="RedSea" | az ertek gazdaja: RedSea - No3:Po4-X nitrát-foszfát kontroll 1000ml',
    mert: "2026-09-10",
  },
  {
    sku: "4032517970046",
    ertek: "710270148523",
    indok:
      'MARKA-UTKOZES: forras brand="Grotech", celpont brand="Arka" | az ertek gazdaja: Arka MyReef Studio Okostelefonra csiptethető lencse-szett',
    mert: "2026-09-10",
  },
  {
    sku: "0710270148660",
    ertek: "5060078020015",
    indok:
      'MARKA-UTKOZES: forras brand="Microbe-Lift", celpont brand="D-D" | az ertek gazdaja: D-D Aquascape kétkomponensű korallragasztó - szürke',
    mert: "2026-09-10",
  },
  {
    sku: "32646",
    ertek: "646",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Canthigaster valentini (Valentin gömbhal)",
    mert: "2026-09-10",
  },
  {
    sku: "blenniella-",
    ertek: "sal_seg",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.13 | az ertek gazdaja: Salarias segmentatus (Sávos / fésűsfogú nyálkáshal)",
    mert: "2026-09-10",
  },
  {
    sku: "9675320",
    ertek: "951",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.11 | az ertek gazdaja: Centropyge bispinosa (Lila törpe császárhal)",
    mert: "2026-09-10",
  },
  {
    sku: "190941",
    ertek: "653341197429",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.27 | az ertek gazdaja: Ecotech Marine Vortech MP60QD prémium áramoltató (34.000 l/h)",
    mert: "2026-09-10",
  },
  {
    sku: "96753",
    ertek: "951",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.13 | az ertek gazdaja: Centropyge bispinosa (Lila törpe császárhal)",
    mert: "2026-09-10",
  },
  {
    sku: "95343",
    ertek: "953",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.29 | az ertek gazdaja: Cirrhilabrus aurantidorsalis (narancshátú ajakoshal)",
    mert: "2026-09-10",
  },
  {
    sku: "765429",
    ertek: "639",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.29 | az ertek gazdaja: Ecsenius bicolor (Kétszínű nyálkáshal)",
    mert: "2026-09-10",
  },
  {
    sku: "6387",
    ertek: "631",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Synchiropus marmoratus ( Márványos mandarinhal)",
    mert: "2026-09-10",
  },
  {
    sku: "Pictichromis_paccagnellae",
    ertek: "654",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0 | az ertek gazdaja: Gramma loreto",
    mert: "2026-09-10",
  },
  {
    sku: "354tris",
    ertek: "354",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Halichoeres leucoxanthus (Sárgahátú ajakos)",
    mert: "2026-09-10",
  },
  {
    sku: "ETM-MP052",
    ertek: "653341197429",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.27 | az ertek gazdaja: Ecotech Marine Vortech MP60QD prémium áramoltató (34.000 l/h)",
    mert: "2026-09-10",
  },
  {
    sku: "0710270148110",
    ertek: "5902026739733",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.08 | az ertek gazdaja: Aquaforest AF Gel Fix - korallragasztó 2x20g",
    mert: "2026-09-10",
  },
  {
    sku: "76542",
    ertek: "639",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Ecsenius bicolor (Kétszínű nyálkáshal)",
    mert: "2026-09-10",
  },
  {
    sku: "4012030379625",
    ertek: "9780201379624",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.17 | az ertek gazdaja: Modern Reef C+ (Complex Carbons) 1000ml - Szénkomplex",
    mert: "2026-09-10",
  },
  {
    sku: "cilio_cad",
    ertek: "calc_lea",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.14 | az ertek gazdaja: Calcinus leavimanus (Kékszemű remeterák)",
    mert: "2026-09-10",
  },
  {
    sku: "halicoheres_iridis",
    ertek: "353",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Halichoeres chrysus (Sárga ajakoshal)",
    mert: "2026-09-10",
  },
  {
    sku: "anampses_meleagrides",
    ertek: "953",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.14 | az ertek gazdaja: Cirrhilabrus aurantidorsalis (narancshátú ajakoshal)",
    mert: "2026-09-10",
  },
  {
    sku: "Macropharyngodon-bipartitus",
    ertek: "953",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.14 | az ertek gazdaja: Cirrhilabrus aurantidorsalis (narancshátú ajakoshal)",
    mert: "2026-09-10",
  },
  {
    sku: "9873125480",
    ertek: "098731092401",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.36 | az ertek gazdaja: Ocean Nutrition Formula TWO Flake - lemezes tengeri haleledel 71gr",
    mert: "2026-09-10",
  },
  {
    sku: "gemma",
    ertek: "xanth",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.29 | az ertek gazdaja: Zebrasoma xanthurum (Vörös-tengeri doktorhal)",
    mert: "2026-09-10",
  },
  {
    sku: "22153",
    ertek: "9794901579789",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.22 | az ertek gazdaja: Modern Reef - Polypop 100ml - koralltáp",
    mert: "2026-09-10",
  },
  {
    sku: "solorensis",
    ertek: "953",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Cirrhilabrus aurantidorsalis (narancshátú ajakoshal)",
    mert: "2026-09-10",
  },
  {
    sku: "Naso_elegans",
    ertek: "pyroferus",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.13 | az ertek gazdaja: Acanthurus pyroferus (Csokoládé doktorhal)",
    mert: "2026-09-10",
  },
  {
    sku: "mac_meleagris",
    ertek: "953",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0 | az ertek gazdaja: Cirrhilabrus aurantidorsalis (narancshátú ajakoshal)",
    mert: "2026-09-10",
  },
  {
    sku: "4005258004912",
    ertek: "4001942084666",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.14 | az ertek gazdaja: Hobby Filter Wool - Perlonvatta 500g",
    mert: "2026-09-10",
  },
  {
    sku: "4005258001805",
    ertek: "4001942084666",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.14 | az ertek gazdaja: Hobby Filter Wool - Perlonvatta 500g",
    mert: "2026-09-10",
  },
  {
    sku: "22152",
    ertek: "9794901579789",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.38 | az ertek gazdaja: Modern Reef - Polypop 100ml - koralltáp",
    mert: "2026-09-10",
  },
  {
    sku: "22151",
    ertek: "9794901579789",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.22 | az ertek gazdaja: Modern Reef - Polypop 100ml - koralltáp",
    mert: "2026-09-10",
  },
  {
    sku: "22150",
    ertek: "9794901579789",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.38 | az ertek gazdaja: Modern Reef - Polypop 100ml - koralltáp",
    mert: "2026-09-10",
  },
  {
    sku: "cyprinocirrhites_polyactis",
    ertek: "967",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.17 | az ertek gazdaja: Cirrhitichthys oxycephalus (korallcsősz)",
    mert: "2026-09-10",
  },
  {
    sku: "pseudochromis_fridmani",
    ertek: "654",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0 | az ertek gazdaja: Gramma loreto",
    mert: "2026-09-10",
  },
  {
    sku: "zebrasoma_flav",
    ertek: "xanth",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.25 | az ertek gazdaja: Zebrasoma xanthurum (Vörös-tengeri doktorhal)",
    mert: "2026-09-10",
  },
  {
    sku: "9770208379674",
    ertek: "9794901579789",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.18 | az ertek gazdaja: Modern Reef - Polypop 100ml - koralltáp",
    mert: "2026-09-10",
  },
  {
    sku: "forci_fla",
    ertek: "895",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.17 | az ertek gazdaja: Chelmon rostratus  (Csipeszhal)",
    mert: "2026-09-10",
  },
  {
    sku: "4260735742071",
    ertek: "GlasrosenStop",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.27 | az ertek gazdaja: AquaLight Glasrosenstop - Üvegrózsa írtó szer",
    mert: "2026-09-10",
  },
  {
    sku: "4032517970039",
    ertek: "D_glasses",
    indok:
      "NEV-ALAPU MARKA-UTKOZES (kezi utoellenorzessel talalva): Grotech Coral Glasses - sárga filterrel elátott szemüveg vs D-D Coral View Glasses - narancs filterrel elátott szemüveg | az ertek gazdaja: D-D Coral View Glasses - narancs filterrel elátott szemüveg",
    mert: "2026-09-10",
  },
  {
    sku: "724994195534",
    ertek: "4032517949967",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.13 | az ertek gazdaja: Grotech ReefSpy - akváriumbetekintő 20cm",
    mert: "2026-09-10",
  },
  {
    sku: "Astraea",
    ertek: "Tectus_fenestratus",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.17 | az ertek gazdaja: Tectus fenestratus (Algaevő csiga)",
    mert: "2026-09-10",
  },
  {
    sku: "Macropharyngodon-ornatus",
    ertek: "953",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.13 | az ertek gazdaja: Cirrhilabrus aurantidorsalis (narancshátú ajakoshal)",
    mert: "2026-09-10",
  },
  {
    sku: "triton_Sr10x10",
    ertek: "triton_Sr1000",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Triton Strontium 1000 ml",
    mert: "2026-09-10",
  },
  {
    sku: "Ophiolepis_incra",
    ertek: "Ophiolepis_superba",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0 | az ertek gazdaja: Ophiolepis superba",
    mert: "2026-09-10",
  },
  {
    sku: "pag_cad",
    ertek: "calc_lea",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.14 | az ertek gazdaja: Calcinus leavimanus (Kékszemű remeterák)",
    mert: "2026-09-10",
  },
  {
    sku: "Rhy_dur",
    ertek: "Lys_wur",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.14 | az ertek gazdaja: Lysmata wurdemanni (Üvegrózsaevő garnéla)",
    mert: "2026-09-10",
  },
  {
    sku: "Lys_kuek",
    ertek: "Lys_wur",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.29 | az ertek gazdaja: Lysmata wurdemanni (Üvegrózsaevő garnéla)",
    mert: "2026-09-10",
  },
  {
    sku: "82180",
    ertek: "Oase_optimax800",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.11 | az ertek gazdaja: Oase OptiMax 800 Szivattyú",
    mert: "2026-09-10",
  },
  {
    sku: "4260216219528",
    ertek: "81226",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.11 | az ertek gazdaja: Dupla Marin Coralit - aljzat 20 kg (1-3mm)",
    mert: "2026-09-10",
  },
  {
    sku: "4025901144208",
    ertek: "Grotech_tec4ng",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.25 | az ertek gazdaja: Grotech TEC 4 NG - 4 csatornás nyomelemadagoló",
    mert: "2026-09-10",
  },
  {
    sku: "4025901144192",
    ertek: "Grotech_tec4ng",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.25 | az ertek gazdaja: Grotech TEC 4 NG - 4 csatornás nyomelemadagoló",
    mert: "2026-09-10",
  },
  {
    sku: "4025901144215",
    ertek: "Grotech_tec4ng",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.25 | az ertek gazdaja: Grotech TEC 4 NG - 4 csatornás nyomelemadagoló",
    mert: "2026-09-10",
  },
  {
    sku: "4025901135084",
    ertek: "Grotech_tec4ng",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.25 | az ertek gazdaja: Grotech TEC 4 NG - 4 csatornás nyomelemadagoló",
    mert: "2026-09-10",
  },
  {
    sku: "9770208379598",
    ertek: "9794901579789",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.22 | az ertek gazdaja: Modern Reef - Polypop 100ml - koralltáp",
    mert: "2026-09-10",
  },
  {
    sku: "9770208379581",
    ertek: "9794901579789",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.38 | az ertek gazdaja: Modern Reef - Polypop 100ml - koralltáp",
    mert: "2026-09-10",
  },
  {
    sku: "centropyge_heraldi_",
    ertek: "649",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.29 | az ertek gazdaja: Centropyge acanthops (Afrikai törpe császárhal)",
    mert: "2026-09-10",
  },
  {
    sku: "coris_aygula",
    ertek: "353",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0 | az ertek gazdaja: Halichoeres chrysus (Sárga ajakoshal)",
    mert: "2026-09-10",
  },
  {
    sku: "anampses_caeruleopuncatus",
    ertek: "953",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.14 | az ertek gazdaja: Cirrhilabrus aurantidorsalis (narancshátú ajakoshal)",
    mert: "2026-09-10",
  },
  {
    sku: "4005258004929",
    ertek: "4001942084666",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Hobby Filter Wool - Perlonvatta 500g",
    mert: "2026-09-10",
  },
  {
    sku: "4260223813351",
    ertek: "5060078020091",
    indok:
      "NEV-ALAPU MARKA-UTKOZES (kezi utoellenorzessel talalva): Aqualight Refraktometer - sótartalom mérő vs D-D - H2Ocean refraktometer - sótartalom mérő | az ertek gazdaja: D-D - H2Ocean refraktometer - sótartalom mérő",
    mert: "2026-09-10",
  },
  {
    sku: "Pseudanthias-Flavoguttatus",
    ertek: "Pseudanthias_bima",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Pseudanthias bimaculatus (Kétfoltos anthias)",
    mert: "2026-09-10",
  },
  {
    sku: "Ecsenius-stigmatura",
    ertek: "639",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.14 | az ertek gazdaja: Ecsenius bicolor (Kétszínű nyálkáshal)",
    mert: "2026-09-10",
  },
  {
    sku: "Macropharyngodon-meleagris",
    ertek: "953",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.14 | az ertek gazdaja: Cirrhilabrus aurantidorsalis (narancshátú ajakoshal)",
    mert: "2026-09-10",
  },
  {
    sku: "Gramma-melacara",
    ertek: "654",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Gramma loreto",
    mert: "2026-09-10",
  },
  {
    sku: "Ai16HDreefBlack",
    ertek: "0653341191120",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.27 | az ertek gazdaja: Aqua Illumination Prime 16 HD Freshwater - édesvízi LED lámpa (55W) - Fehér",
    mert: "2026-09-10",
  },
  {
    sku: "9770208379673",
    ertek: "9794901579789",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.18 | az ertek gazdaja: Modern Reef - Polypop 100ml - koralltáp",
    mert: "2026-09-10",
  },
  {
    sku: "2785242336411",
    ertek: "9794901579789",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Modern Reef - Polypop 100ml - koralltáp",
    mert: "2026-09-10",
  },
  {
    sku: "9873125490",
    ertek: "098731092401",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.36 | az ertek gazdaja: Ocean Nutrition Formula TWO Flake - lemezes tengeri haleledel 71gr",
    mert: "2026-09-10",
  },
  {
    sku: "5903814433963",
    ertek: "4260119453937",
    indok:
      'MARKA-UTKOZES: forras brand="Reef Factory", celpont brand="Fauna Marin" | az ertek gazdaja: Fauna Marin ICP-OES tesztcsomag S (1db)',
    mert: "2026-09-10",
  },
  {
    sku: "9873109410",
    ertek: "5060139356275",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.33 | az ertek gazdaja: Vitalis Anemone Pellets 4mm - koralleledel",
    mert: "2026-09-10",
  },
  {
    sku: "9390109844522",
    ertek: "9780201379624",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.3 | az ertek gazdaja: Modern Reef C+ (Complex Carbons) 1000ml - Szénkomplex",
    mert: "2026-09-10",
  },
  {
    sku: "9280208369579",
    ertek: "9780201379624",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.27 | az ertek gazdaja: Modern Reef C+ (Complex Carbons) 1000ml - Szénkomplex",
    mert: "2026-09-10",
  },
  {
    sku: "grotechip",
    ertek: "GlasrosenStop",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.38 | az ertek gazdaja: AquaLight Glasrosenstop - Üvegrózsa írtó szer",
    mert: "2026-09-10",
  },
  {
    sku: "4032517003072",
    ertek: "4260507580023",
    indok:
      "NEV-ALAPU MARKA-UTKOZES (kezi utoellenorzessel talalva): Grotech Zeolith 1000ml - foszfát és nitrátmegkötő zeolit mix vs Korallen-zucht Zeovit - foszfát és nitrátmegkötő zeolit mix 1000ml | az ertek gazdaja: Korallen-zucht Zeovit - foszfát és nitrátmegkötő zeolit mix 1000ml",
    mert: "2026-09-10",
  },
  {
    sku: "5060097030446",
    ertek: "5060097030910",
    indok:
      'MARKA-UTKOZES: forras brand="Calanus", celpont brand="First Bite" | az ertek gazdaja: First Bite Veggie Pellets S-es méret rövid LEJÁRATÚ',
    mert: "2026-09-10",
  },
  {
    sku: "6971764810294",
    ertek: "5902026739733",
    indok:
      'MARKA-UTKOZES: forras brand="Maxspect", celpont brand="Aquaforest" | az ertek gazdaja: Aquaforest AF Gel Fix - korallragasztó 2x20g',
    mert: "2026-09-10",
  },
  {
    sku: "6971164810393",
    ertek: "5902026739733",
    indok:
      'MARKA-UTKOZES: forras brand="Maxspect", celpont brand="Aquaforest" | az ertek gazdaja: Aquaforest AF Gel Fix - korallragasztó 2x20g',
    mert: "2026-09-10",
  },
  {
    sku: "pseudpink",
    ertek: "356",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.17 | az ertek gazdaja: Pseudocheilinus hexataenia (Hatsávos ajakoshal / Disznócska)",
    mert: "2026-09-10",
  },
  {
    sku: "0710270148684",
    ertek: "5902026739733",
    indok:
      "NEV-HASONLOSAG A KUSZOB (0.4) ALATT: Jaccard=0.09 | az ertek gazdaja: Aquaforest AF Gel Fix - korallragasztó 2x20g",
    mert: "2026-09-10",
  },
];
