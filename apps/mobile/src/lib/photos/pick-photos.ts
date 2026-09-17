import * as ImagePicker from "expo-image-picker";

import { MAX_FILES_PER_UPLOAD } from "@/lib/api/document-upload";
import { photoPermissionDeniedNotice } from "@/lib/api/photo-permission-notice";

/**
 * A KESZULEK FELE NEZO FEL: ENGEDELY, VALASZTO, MEGSZAKITAS.
 *
 * === MIERT KULON A HOROGTOL (`use-photo-attachments.ts`) ===
 *
 * A hat feltolto kepernyo KET fajtara oszlik, es a kulonbseg NEM stilus:
 *
 *   UJ FELVITEL      a rekord MEG NEM LETEZIK, tehat a kepeket GYUJTENI kell,
 *                    es a sorsuk a mentes utan dol el
 *   MAR LETEZO LAP   van azonosito, tehat a kep AZONNAL felmehet
 *
 * A horog a GYUJTESRE valo: allapotot tart, es NEM ad visszahivast. A
 * `worksheets/[id].tsx` fejlece ki is mondja, miert nem szabad ezen valtoztatni:
 * egy `photos`-ra allo mellekhatas a BUKASNAL romlik el -- egy sikertelen
 * feltoltes utan a kepek bent maradnak, es a kovetkezo valasztas MEGINT
 * elkuldene oket, tehat a lapra ket peldany kerulne ugyanabbol a kepbol.
 *
 * AMI VISZONT MIND A HAT KEPERNYON UGYANAZ, az ez a fajl: engedelyt kerni,
 * elinditani a valasztot, a megszakitast megkulonboztetni a megtagadastol, es a
 * megtagadast KIMONDANI. Ez a resz allt eddig KETSZER kezzel (az eszkoz es a
 * hibajegy adatlapjan), a maradek negyen pedig a horog belsejeben.
 *
 * === A VISSZATERES HAROM ALLAPOT, NEM KETTO ===
 *
 * A `null` NEM ugyanaz, mint az ures tomb, es a megtagadas sem ugyanaz, mint a
 * megszakitas:
 *
 *   { kind: "picked", assets }   van kep, a hivo dontheti el, mi legyen vele
 *   { kind: "cancelled" }        a szerelo visszalepett -- NEM kell uzenet
 *   { kind: "denied", notice }   nincs jog, es a mondat MEGMONDJA, hol allithato
 *
 * Egy ketallapotu valasz (kep vagy semmi) a megtagadast osszemosna a
 * megszakitassal, es a szerelo egy letiltott kamera utan ugyanazt latna, mint
 * amikor o maga lepett vissza: semmit.
 */
export type PhotoPickResult =
  | { kind: "picked"; assets: ImagePicker.ImagePickerAsset[] }
  | { kind: "cancelled" }
  | { kind: "denied"; notice: string };

/** MOST KESZULO KEP: a helyszini elsodleges ut. */
export async function takePhotoFromCamera(): Promise<PhotoPickResult> {
  const jog = await ImagePicker.requestCameraPermissionsAsync();
  if (!jog.granted)
    return { kind: "denied", notice: photoPermissionDeniedNotice("camera") };

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
  });
  if (result.canceled) return { kind: "cancelled" };
  return { kind: "picked", assets: result.assets };
}

/**
 * MAR MEGLEVO KEP A GALERIABOL.
 *
 * A `selectionLimit` a SZERVER hatarat ismetli meg, es ez kimondott masolat: a
 * telefon igy mar a valasztonal megall, nem egy halozati kor utan.
 */
export async function pickPhotosFromLibrary(): Promise<PhotoPickResult> {
  const jog = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!jog.granted)
    return { kind: "denied", notice: photoPermissionDeniedNotice("library") };

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: MAX_FILES_PER_UPLOAD,
  });
  if (result.canceled) return { kind: "cancelled" };
  return { kind: "picked", assets: result.assets };
}
