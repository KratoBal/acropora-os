import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getAsset, listAssets } from "@/lib/api/assets";
import { getServiceJob, listServiceJobs } from "@/lib/api/service-jobs";
import {
  getWorksheet,
  listSelectableWorksheetPartners,
  listWorksheetDepartments,
  listWorksheets,
} from "@/lib/api/worksheets";
import { rememberAssetDetail, rememberAssets } from "@/lib/offline/asset-cache";
import { environment } from "@/config/env";
import {
  documentCacheFileName,
  kepLetoltese,
} from "@/lib/documents/document-image-file";
import { kepFajlFuggosegek } from "@/lib/documents/kep-fajl-deps";
import { atvitelOsszege } from "@/lib/offline/teljes-kep-meret";
import { formatDocumentSize } from "@/lib/documents/document-view";
import { LETOLTES_UTAN_UJRAOLVASANDO } from "@/lib/offline/helyszin-letoltes";
import { letoltHelyszin } from "@/lib/offline/helyszin-letoltes-futtato";
import {
  rememberServiceJobDetail,
  rememberServiceJobs,
} from "@/lib/offline/service-job-cache";
import { rememberWorksheet } from "@/lib/offline/worksheet-cache";
import { menthetoMasolatkent } from "@/lib/service-jobs/jegy-alak";
import type { ServiceJobDetail } from "@/lib/service-jobs/types";

/**
 * "LETOLTOM A HELYSZINT" -- GOMB, NEM VALTOKAPCSOLO.
 *
 * === BALAZS KERESE (2026-09-21, Discord) ===
 *
 * "nem tudunk az ios es android appba elhelyezni egy olyan gombot, ami letolti
 * a friss adatokat mielott offline lesz a kollega?" -- es miutan a "mai munka"
 * egyseget javasoltuk: "nem jo a mai munka. ha pl az a munka, mint most, hogy
 * lemegy a pinceba es eszkozoket aka rogziteni, akkor mielott lemegy minden
 * eszkoz adatlapjat meg kell nyitnia. ez igy hasznalhatatlan".
 *
 * === MIERT GOMB, ES NEM VALTOKAPCSOLO ===
 *
 * Egy kezi Online/Offline kapcsolo BERAGAD: aki este elfelejti visszabillenteni,
 * annal napokig nem megy fel semmi, es errol nem tud. A halozat figyelese ma
 * automatikus es szandekosan ovatos (`connectivity-state.ts`); ez a gomb azt
 * NEM erinti, csak elore lehuzza, amire a pinceben szukseg lesz.
 *
 * === MIERT A HELYSZIN AZ EGYSEG ===
 *
 * A "ram kiosztott mai munka" pont azt nem fedi le, amiert Balazs kerte: a
 * kollega eszkozoket megy ROGZITENI, tehat a helyszinen MAR ALLO eszkozoket is
 * latnia kell. Es a helyszin megtartja azt a szabalyt is, amiert eddig
 * szandekosan nem toltottunk elo semmit: egy helyszin EGY partnere, tehat
 * idegen partner adata nem kerul a keszulekre.
 *
 * === AMIT EZ A GOMB NEM IGER ===
 *
 * A hibajegy allapotanak LEPTETESE terero nelkul ezutan sem megy: a szerver a
 * LATOTT allapotra ir felteteleesen (`service-job-cache.ts` fejlece). A gomb
 * szovege ezert csak letoltesrol beszel, nem arrol, hogy mit lehet majd tenni.
 */
export function HelyszinLetolto() {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [nyitva, setNyitva] = useState(false);

  const partnerek = useQuery({
    queryKey: ["helyszin-letolto-partnerek"],
    queryFn: listSelectableWorksheetPartners,
    enabled: nyitva,
  });
  const helyszinek = useQuery({
    queryKey: ["helyszin-letolto-helyszinek", customerId],
    queryFn: () => listWorksheetDepartments(customerId),
    enabled: nyitva && Boolean(customerId),
  });

  const valasztott = helyszinek.data?.items?.find(
    (item) => item.id === departmentId,
  );

  const letoltes = useMutation({
    mutationFn: async () => {
      if (!valasztott) throw new Error("Nincs kiválasztott helyszín.");
      /*
        A SZUREST ITT KOTJUK BELE A HIVASOKBA, es nem a menet belsejeben: igy a
        menet nem tud "elfelejteni" egy parametert -- a rossz halmaz ITT derul
        ki, forditaskor.
      */
      return letoltHelyszin(
        {
          helyszinNeve: valasztott.name,
          helyszinUt: helyszinUtja(helyszinek.data?.items ?? [], valasztott.id),
        },
        {
          eszkozLista: (oldal) => listAssets(oldal, 50, "", departmentId),
          eszkozReszlet: getAsset,
          eszkozokMentese: rememberAssets,
          eszkozReszletMentese: rememberAssetDetail,
          /*
            A BELYEGKEP UGYANABBA A KONYVTARBA es UGYANAZZAL a fajlnevvel
            kerul, amit a galeria horga keres -- kulonben ott allna a
            lemezen, es a csempe megsem talalna meg. A ket ut ezert EGY
            modulbol veszi a varratokat (`kep-fajl-deps.ts`).
          */
          belyegkepLetoltese: async ({ assetId, documentId }) => {
            const eredmeny = await kepLetoltese(
              {
                apiUrl: environment.ok ? environment.config.apiUrl : null,
                ownerPath: `/service/assets/${encodeURIComponent(assetId)}`,
                documentId,
                variant: "thumbnail",
              },
              kepFajlFuggosegek,
            );
            /*
              A BUKAST KIVETELKENT DOBJUK TOVABB, mert a menet a `probald`
              burkolójával szamol: egy csendben elnyelt hiba ugy latszana,
              mintha a kep lejott volna, es a zaro mondat TOBBET allitana,
              mint amennyi igaz.
            */
            if (eredmeny.allapot === "hiba") throw new Error(eredmeny.uzenet);
          },
          jegyLista: () => listServiceJobs("open"),
          /*
            A LETOLTO A BELSO ALAKOT MENTI, tehat a partner-alakot NEM veheti
            at: a visszaolvaso belso alaknak feltetelezne, es a kovetkezo
            megnyitas ugyanabba a hibaba futna, amit ez a javitas megszuntet.

            HANGOSAN ALL MEG, nem csendben hagyja ki: a letoltes `probald`
            burkolója a kivetelt sorkent jeleniti meg, tehat a szerelo LATJA,
            hogy az a jegy nem kerult a keszulekre. Egy nema kihagyas azt
            allitana, hogy minden lejott.

            ES MA EZ NEM ALL ELO: a helyszin-letolto a BELSO munkateren all.
            A sor azert van itt, mert a tipus mostantol MEGKOVETELI a dontest --
            es a kovetkezo olvaso igy latja, MELYIK dontes az.
          */
          jegyReszlet: async (id: string): Promise<ServiceJobDetail> => {
            const jegy = await getServiceJob(id);
            if (!menthetoMasolatkent(jegy))
              throw new Error(
                "Ez a hibajegy partner-nézetben érkezett, ezért nem menthető a készülékre.",
              );
            return jegy;
          },
          jegyekMentese: rememberServiceJobs,
          jegyReszletMentese: rememberServiceJobDetail,
          munkalapLista: (oldal) =>
            listWorksheets({ page: oldal, pageSize: 100, departmentId }),
          munkalapReszlet: getWorksheet,
          munkalapMentese: rememberWorksheet,
        },
      );
    },
    /**
     * A MENTES UTAN A KEPERNYOKNEK UJRA KELL OLVASNIUK A MASOLATOT.
     *
     * Balazs merese (2026-09-21): a letoltes lefutott es szamot mondott, de a
     * lista LEHUZASRA kiurult. A mentes jo volt -- a kepernyok viszont a
     * mentett masolatot SAJAT lekerdezesen at olvassak, es annak a valasza a
     * letoltes utan is a REGI maradt.
     *
     * A `onSettled`, NEM az `onSuccess`: a RESZLEGES letoltes is hoz uj sorokat
     * (egy elhasalt reszletlap mellett a tobbi lement), es azokat ugyanugy latni
     * kell. Ami tenyleg nem jott le, arrol a zaro mondat szol.
     */
    onSettled: async () => {
      await Promise.all(
        LETOLTES_UTAN_UJRAOLVASANDO.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey: [...queryKey] }),
        ),
      );
    },
  });

  const osszegzes = letoltes.data;
  const teljesKepek = letoltes.data?.teljesKepek ?? [];

  /**
   * AMIT A GOMB IGER, AZ AZ ATVITT ADAT, NEM A TELJES KESZLET.
   *
   * Ha egy kep MAR LENT VAN, nem szamol bele -- kulonben a masodik megnyomas
   * ugyanazt a szamot mutatna, es a felhasznalo azt hinne, semmi nem tortent.
   *
   * A lemez-nezes ASZINKRON, ezert lekerdezes. A kulcs a lista, tehat egy uj
   * letoltes utan magatol ujraszamol; a `letoltes.data` valtozasa is ide fut.
   */
  const atvivendo = useQuery({
    queryKey: [
      "teljes-kepek-atvivendo",
      teljesKepek.map((kep) => kep.documentId).join(","),
    ],
    enabled: teljesKepek.length > 0,
    queryFn: async () => {
      const hianyzo: typeof teljesKepek = [];
      for (const kep of atvivendoKepek) {
        const helyi = await kepFajlFuggosegek.helyiFajl(
          documentCacheFileName({
            documentId: kep.documentId,
            variant: "original",
          }),
        );
        if (!helyi) hianyzo.push(kep);
      }
      return hianyzo;
    },
  });

  const atvivendoKepek = atvivendo.data ?? [];
  const osszeg = atvitelOsszege(atvivendoKepek);

  /**
   * A TELJES KEPEK KULON LEPESBEN, ES A GOMBON OTT A SZAM.
   *
   * Balazs merese: a legnagyobb kepanyagu helyszin TELJES meretben 51 MB,
   * belyegkepben 567 KB. A belyegkep tehat mindig jon; ez a gomb a KULONBSEG,
   * es a szerelo a szammal a kezeben dont.
   *
   * A SZAM CSAK A BELYEGKEPES KOR UTAN ISMERT, es ez nem kenyelmi kerdes: a
   * meretek a csatolmany-sorokban allnak, azokat pedig az eszkoz-adatlapokkal
   * egyutt hozzuk le. Elotte nincs mibol osszeadni -- ezert all ez a gomb a
   * zaro mondat ALATT, nem az elso gomb mellett.
   */
  const teljesLetoltes = useMutation({
    mutationFn: async () => {
      let kesz = 0;
      let hibas = 0;
      for (const kep of atvivendoKepek) {
        const eredmeny = await kepLetoltese(
          {
            apiUrl: environment.ok ? environment.config.apiUrl : null,
            ownerPath: `/service/assets/${encodeURIComponent(kep.assetId)}`,
            documentId: kep.documentId,
            variant: "original",
          },
          kepFajlFuggosegek,
        );
        if (eredmeny.allapot === "kesz") kesz += 1;
        else hibas += 1;
      }
      return { kesz, hibas };
    },
    onSettled: async () => {
      await Promise.all([
        ...LETOLTES_UTAN_UJRAOLVASANDO.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey: [...queryKey] }),
        ),
        /*
          ES A SAJAT LISTAJA IS: a lemezre most lekerult kepek mar nem
          atvivendok. Enelkul a gomb a letoltes utan is a REGI szamot
          mutatna, es ugy nezne ki, mintha semmi nem tortent volna -- pont az
          a hiba, ami ellen a 2. kikotes szol.
        */
        queryClient.invalidateQueries({
          queryKey: ["teljes-kepek-atvivendo"],
        }),
      ]);
    },
  });

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Helyszín letöltése a készülékre</Text>
      <Text style={styles.hint}>
        Válaszd ki, hova mész, és töltsd le előre. Térerő nélkül az eszközök
        adatlapjai, a hibajegyek és a munkalapok így is megnyithatók.
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Helyszín választása a letöltéshez"
        onPress={() => setNyitva((open) => !open)}
        style={({ pressed }) => [styles.picker, pressed && styles.pressed]}
        testID="helyszin-letolto-valaszto"
      >
        <Text style={styles.rowText}>
          {valasztott ? `Helyszín: ${valasztott.name}` : "Helyszín: nincs"}
        </Text>
      </Pressable>

      {nyitva ? (
        <View style={styles.list}>
          {partnerek.isPending || helyszinek.isPending ? (
            <ActivityIndicator color="#52d6c7" />
          ) : null}
          {!customerId
            ? (partnerek.data?.items ?? []).map((item) => (
                <Pressable
                  key={item.customerId}
                  onPress={() => {
                    setCustomerId(item.customerId);
                    setDepartmentId("");
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.rowText}>{item.name}</Text>
                </Pressable>
              ))
            : (helyszinek.data?.items ?? []).map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    setDepartmentId(item.id);
                    setNyitva(false);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.rowText}>{item.name}</Text>
                </Pressable>
              ))}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="A kiválasztott helyszín letöltése"
        disabled={!departmentId || letoltes.isPending}
        onPress={() => letoltes.mutate()}
        style={({ pressed }) => [
          styles.button,
          (!departmentId || letoltes.isPending) && styles.buttonDisabled,
          pressed && styles.pressed,
        ]}
        testID="helyszin-letolto-gomb"
      >
        <Text style={styles.buttonText}>
          {letoltes.isPending ? "Letöltés folyamatban…" : "Letöltés"}
        </Text>
      </Pressable>

      {/*
        A VISSZAJELZES A FELADAT RESZE, nem rahagyas: Balazs kifejezetten kerte,
        hogy irja ki, ha megtortent. Egy csendben sikeres elotoltes ugyanugy nez
        ki, mint egy elhasalt.

        ES A HIANYOS LETOLTES MAS SZINT KAP, nem csak mas szamot: a szerelo a
        pinceben abbol indul ki, hogy megvan minden.
      */}
      {letoltes.isError ? (
        <Text style={styles.hiba}>
          A letöltés nem indult el:{" "}
          {letoltes.error instanceof Error
            ? letoltes.error.message
            : "ismeretlen hiba"}
        </Text>
      ) : null}
      {atvivendoKepek.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`A teljes méretű képek letöltése: ${osszeg.darab} kép`}
          disabled={teljesLetoltes.isPending}
          onPress={() => teljesLetoltes.mutate()}
          style={({ pressed }) => [
            styles.button,
            teljesLetoltes.isPending && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
          testID="teljes-kepek-gomb"
        >
          <Text style={styles.buttonText}>
            {teljesLetoltes.isPending
              ? "Teljes képek letöltése…"
              : /*
                  ISMERETLEN MERET MELLETT NEM ALL SZAM A GOMBON. A hianyzo
                  meret nulla megabajtnak latszana, es a nulla itt azt
                  IGERNE, hogy ingyen van. A DARABSZAM viszont akkor is
                  kimehet: abbol a szerelo tudja, mibe vag bele.
                */
                `Teljes képek letöltése (${
                  osszeg.ismeretlen
                    ? `${osszeg.darab} kép`
                    : formatDocumentSize(osszeg.bytes)
                })`}
          </Text>
        </Pressable>
      ) : null}

      {/*
        A TELJES KEPEK SAJAT ZARO MONDATOT KAPNAK, ugyanazzal a szaballyal,
        mint a helyszin letoltese: ha nem jott le minden, azt KI KELL MONDANI.
        A szerelo a pinceben abbol indul ki, hogy megvan, amit kert.
      */}
      {teljesLetoltes.data ? (
        <View
          style={teljesLetoltes.data.hibas === 0 ? styles.kesz : styles.hianyos}
        >
          <Text style={styles.osszegzesCim}>
            {teljesLetoltes.data.hibas === 0
              ? `${teljesLetoltes.data.kesz} teljes kép letöltve.`
              : `A teljes képek letöltése HIÁNYOS: ${teljesLetoltes.data.kesz} lejött, ${teljesLetoltes.data.hibas} nem.`}
          </Text>
        </View>
      ) : null}

      {osszegzes ? (
        <View style={osszegzes.teljes ? styles.kesz : styles.hianyos}>
          <Text style={styles.osszegzesCim}>{osszegzes.cim}</Text>
          {osszegzes.sorok.map((sor) => (
            <Text key={sor} style={styles.osszegzesSor}>
              {sor}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A HELYSZIN TELJES UTJA A LAPOS LISTABOL.
 *
 * A lista `parentId` mezovel jon, a fa nincs felepitve. Az ut a hibajegyek
 * szuresehez kell -- es a rossz egyezes ott BIZTONSAGOSAN romlik el: kevesebb
 * reszletlap jon le, nem rossz adat.
 */
export function helyszinUtja(
  items: readonly { id: string; name: string; parentId: string | null }[],
  id: string,
): string[] {
  const ut: string[] = [];
  let aktualis = items.find((item) => item.id === id);
  /* A LATOTT CSOMOPONTOK SZAMOLASA KOR ELLEN: egy elrontott `parentId` lanc
     kulonben vegtelen ciklust adna a fokepernyon. */
  const latott = new Set<string>();
  while (aktualis && !latott.has(aktualis.id)) {
    latott.add(aktualis.id);
    ut.unshift(aktualis.name);
    const szuloId = aktualis.parentId;
    aktualis = szuloId ? items.find((item) => item.id === szuloId) : undefined;
  }
  return ut;
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "#52d6c7",
    borderRadius: 12,
    marginTop: 12,
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#04222d", fontSize: 15, fontWeight: "800" },
  card: {
    backgroundColor: "#06202e",
    borderRadius: 14,
    marginTop: 18,
    padding: 16,
  },
  hianyos: {
    backgroundColor: "#3a2a12",
    borderRadius: 10,
    marginTop: 12,
    padding: 12,
  },
  hiba: { color: "#ffb4a2", fontSize: 13, marginTop: 10 },
  hint: { color: "#91afbe", fontSize: 13, marginTop: 6 },
  kesz: {
    backgroundColor: "#0d3a33",
    borderRadius: 10,
    marginTop: 12,
    padding: 12,
  },
  list: {
    backgroundColor: "#04202c",
    borderRadius: 10,
    marginTop: 8,
    padding: 8,
  },
  osszegzesCim: { color: "#f4fbff", fontSize: 14, fontWeight: "800" },
  osszegzesSor: { color: "#cfe3ec", fontSize: 13, marginTop: 4 },
  picker: {
    backgroundColor: "#04202c",
    borderRadius: 10,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pressed: { opacity: 0.7 },
  row: {
    borderBottomColor: "#123b50",
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  rowText: { color: "#e8f4fa", fontSize: 14 },
  title: { color: "#f4fbff", fontSize: 16, fontWeight: "800" },
});
