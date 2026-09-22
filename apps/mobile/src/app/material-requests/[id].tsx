import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * AZ ANYAGIGENY-ERTESITES LANDOLO LAPJA -- ES EZ SZANDEKOSAN NEM ANYAGIGENY-
 * RESZLETLAP.
 *
 * === MIERT KULON UTVONAL, HOLOTT A CEL A MUNKALAP ===
 *
 * A push-celpontok tablaja (`lib/notifications/push-target.ts`) MEGKOVETELI,
 * hogy minden ismert tipus SAJAT, EGYEDI utvonalra mutasson -- ket tipus nem
 * mehet ugyanarra a sztringre, kulonben az orzo nem tudja megkulonboztetni a
 * "ket dolog szandekosan egy hely fele mutat" es a "masolassal bennmaradt a
 * regi ut" esetet (lasd `push-target.spec.ts`). Az anyagigeny-ertesitesnek
 * (letrehozva ES beerkezett is) viszont NINCS SAJAT reszletlapja -- sem a
 * weben, sem itt --, a helyes celja a MUNKALAP, ahol az "Anyagigénylés"
 * szakasz all. A `/worksheets/[id]` utvonalat viszont mar a `worksheet` tipus
 * FOGLALJA.
 *
 * EZERT EZ A KEPERNYO A CELPONT, ES AZONNAL TOVABBIRANYIT: a szerver a
 * `targetId`-ben a MUNKALAP azonositojat kuldi (nem az igenyet, lasd
 * `NotificationsService.deliverMaterialRequestCreated`), tehat az `id`
 * parameter itt is a munkalape.
 */
export default function MaterialRequestPushLandingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: "/worksheets/[id]", params: { id } }} />;
}
