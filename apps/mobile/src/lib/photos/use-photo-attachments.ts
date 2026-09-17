import type * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";

import { toPickedImages, type PickedFile } from "@/lib/api/picked-image";
import { pickPhotosFromLibrary, takePhotoFromCamera } from "./pick-photos";

/**
 * A HELYSZINEN KESZULT KEPEK GYUJTESE EGY URLAPON.
 *
 * === MIERT HOROG, ES MIERT MOST ===
 *
 * Ez a nehany kezelo 2026-09-16-ig KETSZER allt a fan, beture azonosan (az uj
 * eszkoz es az uj munkalap kepernyojen), egyetlen komment kulonbseggel. A
 * harmadik hivo (az uj hibajegy) hozta el a dontest: egy harmadik masolat nem
 * uj kockazat, hanem a meglevo megharmazasa -- es a masolat epp attol
 * lathatatlan, hogy mind a harom hely egyforma.
 *
 * === AMIT A HOROG NEM VISZ, ES EZ SZANDEKOS ===
 *
 * A kepek SORSA (feltoltes, sorba tetel, elejtes) NEM itt dol el: az a
 * `lib/assets/photo-after-record.ts` dolga, mert az adatbazis es a halozat
 * nelkul MERHETO, es specek merik is. Ide csak az kerult, ami a keszulek
 * felulete fele nez -- az, amire ebben az appban ugysem lehet tesztet irni.
 *
 * === A KET SZABALY, AMI A MASOLATOKBOL IDEKOLTOZOTT ===
 *
 * Az egyik: ugyanaz a fajl ketszer NEM ket kep. A valaszto ugyanazt az `uri`-t
 * adja vissza, es ket azonos sor a sorban ket feltoltes lenne.
 * A masik: a kihagyott fajlokat KI KELL MONDANI. Egy csendben eldobott HEIC
 * ugyanugy nez ki, mint egy sikeres valasztas.
 */
export interface PhotoAttachments {
  /** A mar kivalasztott kepek, a valasztas sorrendjeben. */
  photos: PickedFile[];
  /** Amit a szerelonek tudnia kell a valasztasrol; `null`, ha nincs ilyen. */
  notice: string | null;
  setNotice: (uzenet: string | null) => void;
  /** Mind eldobasa -- a sikeres rogzites utan az urlap ures lappal indul. */
  clear: () => void;
  takePhoto: () => Promise<void>;
  pickPhotos: () => Promise<void>;
}

export function usePhotoAttachments(): PhotoAttachments {
  const [photos, setPhotos] = useState<PickedFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const felvesz = useCallback((assets: ImagePicker.ImagePickerAsset[]) => {
    const { files, skipped } = toPickedImages(assets);
    setPhotos((elozo) => {
      const utak = new Set(elozo.map((f) => f.uri));
      return [...elozo, ...files.filter((f) => !utak.has(f.uri))];
    });
    setNotice(
      skipped.length > 0
        ? `Kimaradt (csak JPEG és PNG megy): ${skipped.join(", ")}.`
        : null,
    );
  }, []);

  /**
   * A KESZULEK FELE NEZO RESZ A `pick-photos.ts`-BEN ALL, ES ITT CSAK A
   * GYUJTES MARAD. A megszakitas NEM tol uzenetet -- a szerelo tudja, hogy o
   * lepett vissza --, a megtagadas viszont IGEN.
   */
  const felvesz2 = useCallback(
    (eredmeny: Awaited<ReturnType<typeof takePhotoFromCamera>>) => {
      if (eredmeny.kind === "denied") {
        setNotice(eredmeny.notice);
        return;
      }
      if (eredmeny.kind === "cancelled") return;
      felvesz(eredmeny.assets);
    },
    [felvesz],
  );

  const takePhoto = useCallback(async () => {
    setNotice(null);
    felvesz2(await takePhotoFromCamera());
  }, [felvesz2]);

  const pickPhotos = useCallback(async () => {
    setNotice(null);
    felvesz2(await pickPhotosFromLibrary());
  }, [felvesz2]);

  const clear = useCallback(() => setPhotos([]), []);

  return { photos, notice, setNotice, clear, takePhoto, pickPhotos };
}
