import { useState } from "react";
import {
  Image,
  Text,
  View,
  type StyleProp,
  type ImageStyle,
  type ViewStyle,
} from "react-native";

import {
  HIANYZO_FORRAS_UZENET,
  kepHibaSzovege,
} from "@/lib/documents/kep-hiba";

/**
 * EGY CSATOLMÁNY-KÉP, ÉS AMI A HELYÉN ÁLL, HA NEM JÖN KI.
 *
 * === MIÉRT KÜLÖN KOMPONENS (2026-09-21) ===
 *
 * Balázs éles hibát jelentett Androidon: a lista betöltődik, a kép nem -- sem a
 * csempén, sem nagyban. Öt különböző ok adja pontosan ezt a képet, és kívülről
 * megkülönböztethetetlenek. A készülék viszont TUDJA a választ: a natív
 * betöltő hibaüzenetét a `onError` visszaadja.
 *
 * Ez a komponens azért van, hogy az a mondat MEGJELENJEN a képernyőn, ott, ahol
 * a kép lenne. Enélkül a hiba csak üres helyként látszik, és egy felolvasott
 * "nem jelenik meg" mondat semmit nem zár ki.
 *
 * === EZ MÉRŐESZKÖZ, NEM VÉGLEGES FELÜLET ===
 *
 * A szövegek `MÉRÉS:` szóval kezdődnek, szándékosan: aki látja, tudja, hogy ez
 * egy kérdés, amire válasz kell, nem a kész alak. Amint megvan a válasz, a
 * mondatok helyére a VALÓDI kezelés kerül -- és akkor ez a komponens marad, de
 * a szövege más lesz.
 */
export function DocumentImage({
  source,
  style,
  hibaStyle,
  resizeMode,
  accessibilityLabel,
}: {
  /** A hitelesített forrás, vagy `null`, ha a token még nem állt készen. */
  source: { uri: string; headers: Record<string, string> } | null;
  style: StyleProp<ImageStyle>;
  /** A hiba-doboz kerete: a csempén és nagyban más méret kell. */
  hibaStyle?: StyleProp<ViewStyle>;
  resizeMode: "cover" | "contain";
  accessibilityLabel: string;
}) {
  const [hiba, setHiba] = useState<string | null>(null);

  /*
    A HIÁNYZÓ FORRÁS KÜLÖN ÁG, ÉS KÜLÖN MONDAT: ott kérés EL SEM INDULT, tehát
    a natív betöltő nem is hibázhatott. Egy közös szöveg a kettőt összemosná,
    és pont a mérés értelme veszne el.
  */
  if (!source)
    return (
      <View style={[style, hibaStyle]}>
        <Text style={{ color: "#f5b78a", fontSize: 11 }}>
          {HIANYZO_FORRAS_UZENET}
        </Text>
      </View>
    );

  if (hiba)
    return (
      <View style={[style, hibaStyle]}>
        {/*
          A TELJES ÜZENET LÁTSZIK, nem levágva: a `numberOfLines` itt pont azt
          vinné el, amiért a mérés készült.
        */}
        <Text style={{ color: "#f5b78a", fontSize: 11 }} selectable>
          {hiba}
        </Text>
      </View>
    );

  return (
    <Image
      source={source}
      style={style}
      resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel}
      onError={(esemeny) => setHiba(kepHibaSzovege(esemeny))}
    />
  );
}
