import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReactNode } from "react";

import { getAsset, getAssetQr } from "@/lib/api/assets";
import {
  LABEL_GAP_MM,
  LABEL_NAME_FONT_MM,
  LABEL_NUMBER_FONT_MM,
  LABEL_PADDING_MM,
  labelAssetNumber,
  labelLayout,
  labelPageSize,
} from "@/lib/assets/label-format";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getServiceCapabilities } from "@/lib/auth/webshop-authorization";

const STATUS_LABELS = {
  ACTIVE: "Aktív",
  OUT_OF_SERVICE: "Nem üzemel",
  IN_REPAIR: "Javítás alatt",
  RETIRED: "Kivezetett",
} as const;

const KIND_LABELS = {
  SYSTEM: "Rendszer",
  EQUIPMENT: "Berendezés",
  COMPONENT: "Részegység",
  SENSOR: "Szenzor",
  OTHER: "Egyéb",
} as const;

export default function AssetDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { status, user } = useAuth();
  const capabilities = user ? getServiceCapabilities(user.role) : null;
  const query = useQuery({
    queryKey: ["service-asset", id],
    queryFn: () => getAsset(id!),
    enabled:
      status === "authenticated" && Boolean(id && capabilities?.assetsView),
  });

  const printLabel = async (share: boolean) => {
    if (!query.data) return;
    const qr = await getAssetQr(query.data.id);
    const html = labelHtml(qr.svg, query.data.assetNumber, query.data.name);
    if (share) {
      /**
       * A LAP-MÉRET A HÍVÁSBÓL JÖN, nem a stílusból. Az `expo-print` iOS oldalon
       * a `PrintOptions.toPageSize()` a Letter méretből indul, és csak a
       * `width`/`height` értéket veszi figyelembe; a `@page` CSS-t ez az út nem
       * olvassa. Enélkül teljes lapra készül a PDF, egy apró címkével a sarkában.
       */
      const { uri } = await Print.printToFileAsync({
        html,
        ...labelPageSize(),
      });
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          UTI: "com.adobe.pdf",
          dialogTitle: `${query.data.assetNumber} QR-címke`,
        });
      return;
    }
    await Print.printAsync({ html, ...labelPageSize() });
  };

  if (status !== "authenticated" || !user) return <Redirect href="/login" />;
  if (!capabilities?.assetsView) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.container}>
        {query.isPending ? <ActivityIndicator color="#52d6c7" /> : null}
        {query.isError ? (
          <MessageCard
            title="Az eszköz nem tölthető be"
            message={
              query.error instanceof Error
                ? query.error.message
                : "Ismeretlen hiba történt."
            }
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {query.data ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.number}>{query.data.assetNumber}</Text>
              <Text style={styles.title}>{query.data.name}</Text>
              <View style={styles.badges}>
                <Text style={styles.badge}>{KIND_LABELS[query.data.kind]}</Text>
                <Text style={styles.badge}>
                  {STATUS_LABELS[query.data.status]}
                </Text>
              </View>
            </View>

            <Section title="Elhelyezés">
              <Info label="Tulajdonos" value={query.data.owner.displayName} />
              <Info label="Partnerkód" value={query.data.owner.code} />
              <Info label="Helyszín" value={query.data.address?.formatted} />
              <Info label="Akvárium" value={query.data.aquarium?.name} />
            </Section>

            <Section title="Műszaki adatok">
              <Info label="Gyártó" value={query.data.manufacturer} />
              <Info label="Modell" value={query.data.model} />
              <Info label="Sorozatszám" value={query.data.serialNumber} />
              <Info label="Leltári szám" value={query.data.inventoryNumber} />
              <Info label="Termék" value={query.data.product?.name} />
              <Info label="Leírás" value={query.data.description} />
            </Section>

            <Section title="Karbantartás">
              <Info
                label="Következő karbantartás"
                value={formatDate(query.data.nextServiceAt)}
              />
              <Info
                label="Utolsó karbantartás"
                value={formatDate(query.data.lastServicedAt)}
              />
              <Info
                label="Intervallum"
                value={
                  query.data.serviceIntervalDays
                    ? `${query.data.serviceIntervalDays} nap`
                    : undefined
                }
              />
              <Info label="Megjegyzés" value={query.data.notes} />
            </Section>

            {capabilities?.assetsManage ? (
              <Section title="Szerkesztés">
                <AssetLink
                  label="Eszközadatok módosítása"
                  meta="Státusz, gyártó, sorozatszám, megjegyzés"
                  onPress={() =>
                    router.push({
                      pathname: "/assets/edit/[id]",
                      params: { id: query.data.id },
                    })
                  }
                />
              </Section>
            ) : null}

            <Section title="QR-címke · 30 × 30 mm">
              <AssetLink
                label="Nyomtatás"
                meta="Rendszer nyomtatási párbeszédablak"
                onPress={() => void printLabel(false)}
              />
              <AssetLink
                label="PDF megosztása"
                meta="Megnyitás a címkenyomtató alkalmazásában"
                onPress={() => void printLabel(true)}
              />
            </Section>

            {query.data.ancestors.length > 0 ? (
              <Section title="Rendszerútvonal">
                {query.data.ancestors.map((ancestor) => (
                  <AssetLink
                    key={ancestor.id}
                    label={ancestor.name}
                    meta={ancestor.assetNumber}
                    onPress={() =>
                      router.push({
                        pathname: "/assets/[id]",
                        params: { id: ancestor.id },
                      })
                    }
                  />
                ))}
              </Section>
            ) : null}

            {query.data.children.length > 0 ? (
              <Section title="Részegységek">
                {query.data.children.map((child) => (
                  <AssetLink
                    key={child.id}
                    label={child.name}
                    meta={child.assetNumber}
                    onPress={() =>
                      router.push({
                        pathname: "/assets/[id]",
                        params: { id: child.id },
                      })
                    }
                  />
                ))}
              </Section>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function AssetLink({
  label,
  meta,
  onPress,
}: {
  label: string;
  meta: string;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.assetLink, pressed && styles.pressed]}
    >
      <View>
        <Text style={styles.assetLinkLabel}>{label}</Text>
        <Text style={styles.assetLinkMeta}>{meta}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function MessageCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry(): void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>Újrapróbálás</Text>
      </Pressable>
    </View>
  );
}

function formatDate(value?: string) {
  return value
    ? new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : undefined;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

/**
 * A címke tartalma. A MÉRETEK a `label-format` modulból jönnek, hogy a stílus és
 * a nyomtatási hívás ne mondhasson két különböző számot: ez a hiba csak
 * nyomtatásban derülne ki, és akkor sem mondaná meg magáról, hogy méret-eltérés.
 */
/**
 * A CÍMKE FEKVŐ, ÉS A FELIRAT A KÓD MELLETT VAN, NEM ALATTA.
 *
 * A szalag 24 mm széles és folytonos: a magasság kötött, a hossz szabad. Ha a
 * felirat a kód ALÁ kerülne, a szövegsáv abból a magasságból venne el, amiből a
 * modul-méret származik -- vagyis pont a beolvashatóságból. Mellette viszont a
 * kód megkapja a teljes magasságot, és a szöveg a szabad irányba nő.
 *
 * MINDEN MÉRET A LEVEZETÉSBŐL JÖN (`labelLayout()`). Kézzel beírt milliméter itt
 * nincs, mert a stílus és a nyomtatási hívás akkor válna szét, és a különbség
 * csak a kinyomtatott szalagon derülne ki.
 */
function labelHtml(svg: string, assetNumber: string, name: string) {
  const { pageWidthMm, pageHeightMm, qrSizeMm, textWidthMm } = labelLayout();

  // A CÍMKÉRE A RÖVIDÍTETT AZONOSÍTÓ KERÜL, nem a teljes eszközszám. A teljes
  // szám a QR-ben lévő hivatkozásban van; a felirat az emberi visszakeresést
  // szolgálja, és a rövid alak a teljes szám vége, tehát kereséssel megtalálja.
  const number = labelAssetNumber(assetNumber);

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>
    @page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0; }
    html, body { width: ${pageWidthMm}mm; height: ${pageHeightMm}mm; margin: 0; padding: 0; overflow: hidden; }
    body { box-sizing: border-box; padding: ${LABEL_PADDING_MM}mm; font-family: -apple-system, Arial, sans-serif; color: #000; display: flex; align-items: center; gap: ${LABEL_GAP_MM}mm; }
    svg { display: block; flex: none; width: ${qrSizeMm}mm; height: ${qrSizeMm}mm; }
    .text { flex: none; width: ${textWidthMm}mm; overflow: hidden; }
    .number { font-size: ${LABEL_NUMBER_FONT_MM}mm; font-weight: 800; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .name { margin-top: ${LABEL_GAP_MM}mm; font-size: ${LABEL_NAME_FONT_MM}mm; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style></head><body>${svg}<div class="text"><div class="number">${escapeHtml(number)}</div><div class="name">${escapeHtml(name)}</div></div></body></html>`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#071827" },
  container: { padding: 18, paddingBottom: 40, gap: 14 },
  hero: {
    borderRadius: 22,
    padding: 20,
    backgroundColor: "#0d3146",
    borderWidth: 1,
    borderColor: "#1d536b",
  },
  number: { color: "#52d6c7", fontSize: 11, fontWeight: "900" },
  title: { color: "#f4fbff", fontSize: 27, fontWeight: "900", marginTop: 7 },
  badges: { flexDirection: "row", gap: 8, marginTop: 12 },
  badge: {
    color: "#d3eef4",
    backgroundColor: "#16495e",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "800",
  },
  section: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1c4963",
    backgroundColor: "#0d2b40",
    padding: 17,
  },
  sectionTitle: { color: "#f4fbff", fontSize: 16, fontWeight: "900" },
  sectionBody: { marginTop: 8 },
  infoRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#153c52",
  },
  infoLabel: {
    color: "#789cad",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  infoValue: { color: "#e4f3f8", fontSize: 14, lineHeight: 20, marginTop: 3 },
  assetLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  assetLinkLabel: { color: "#e4f3f8", fontSize: 15, fontWeight: "700" },
  assetLinkMeta: { color: "#75a0b2", fontSize: 11, marginTop: 2 },
  chevron: { color: "#52d6c7", fontSize: 26 },
  pressed: { opacity: 0.68 },
  message: { color: "#a9c4d1", lineHeight: 20, marginTop: 8 },
  retryButton: {
    alignSelf: "flex-start",
    backgroundColor: "#177b74",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 14,
  },
  retryText: { color: "#fff", fontWeight: "800" },
});
