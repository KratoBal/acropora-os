import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { kepHibaSzovege } from "@/lib/documents/kep-hiba";
import type { DocumentImageVariant } from "@/lib/documents/document-view";
import { useDocumentImageFile } from "@/lib/documents/use-document-image-file";

/**
 * EGY CSATOLMÁNY-KÉP, A MI KÉRÉSÜNKKEL LEHÍVVA.
 *
 * === MIÉRT NEM A NATÍV BETÖLTŐ KÉRI LE (mérve a készüléken, 2026-09-21) ===
 *
 * Balázs androidos készüléke a saját mérő-mondatunkat mutatta:
 * `Unexpected HTTP code Response{protocol=h2, code=401, ...}`. A kérés tehát
 * ELMENT a szerverig, és a szerver ELUTASÍTOTTA -- vagyis az `Authorization`
 * fejléc nem jutott el vele. A `ImageURISource.headers` mező létezik a
 * típusban, de Androidon nem ér célba.
 *
 * Ezért a lehívás átkerült hozzánk: a bájtokat a `expo-file-system` tölti le a
 * fejléccel, lemezre, és a kép a HELYI fájlt tölti be -- ahol már nincs mit
 * hitelesíteni.
 *
 * === A MÉRŐESZKÖZ BENT MARAD, ÉS EZ NEM ÓVATOSSÁG ===
 *
 * Két hiba-út van, és MIND A KETTŐ látszik:
 *   - a letöltés hibája (401, időtúllépés, lemez) -- a horog adja
 *   - a helyi fájl betöltésének hibája (sérült vagy nem kép tartalom) -- az
 *     `onError` adja, szó szerint
 *
 * A második azért kell, mert azt NEM tudom megmérni innen, mit ír a lemezre a
 * letöltő egy 401-es válasznál. Ha hibát dob, az első út mutatja; ha a
 * hibatörzset írja fájlba, a második. Egy javítás, ami az üzenetet is elviszi,
 * vakká tenne a következő alkalomra.
 */
export function DocumentImage({
  ownerPath,
  documentId,
  variant,
  style,
  hibaStyle,
  resizeMode,
  accessibilityLabel,
  enabled,
}: {
  ownerPath: string | null;
  documentId: string;
  variant: DocumentImageVariant;
  style: StyleProp<ImageStyle>;
  /** A hiba-doboz kerete: a csempén és nagyban más méret kell. */
  hibaStyle?: StyleProp<ViewStyle>;
  resizeMode: "cover" | "contain";
  accessibilityLabel: string;
  enabled?: boolean;
}) {
  const [hiba, setHiba] = useState<string | null>(null);
  const letoltes = useDocumentImageFile({
    ownerPath,
    documentId,
    variant,
    enabled,
  });

  if (letoltes.isPending)
    return (
      <View style={[style, hibaStyle]}>
        <ActivityIndicator color="#52d6c7" />
      </View>
    );

  /*
    A LEKERDEZES SAJAT HIBAJA (halozat, kivetel a horogban) KULON All a
    letoltes sajat, MERT valaszatol: az elobbi nem jutott el odaig, hogy
    barmit mondjon rola a keszulek.
  */
  if (letoltes.isError)
    return (
      <View style={[style, hibaStyle]}>
        <Text style={{ color: "#f5b78a", fontSize: 11 }} selectable>
          MÉRÉS: a letöltés el sem indult (
          {letoltes.error instanceof Error
            ? letoltes.error.message
            : "ismeretlen ok"}
          ).
        </Text>
      </View>
    );

  const eredmeny = letoltes.data;

  if (!eredmeny || eredmeny.allapot === "hiba")
    return (
      <View style={[style, hibaStyle]}>
        <Text style={{ color: "#f5b78a", fontSize: 11 }} selectable>
          {eredmeny?.uzenet ?? "MÉRÉS: a letöltés nem adott eredményt."}
        </Text>
      </View>
    );

  if (hiba)
    return (
      <View style={[style, hibaStyle]}>
        <Text style={{ color: "#f5b78a", fontSize: 11 }} selectable>
          {hiba}
        </Text>
      </View>
    );

  return (
    <Image
      source={{ uri: eredmeny.uri }}
      style={style}
      resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel}
      onError={(esemeny) => setHiba(kepHibaSzovege(esemeny))}
    />
  );
}
