"use client";

import { useEffect } from "react";

import { Button } from "./button";
import { cn } from "./utils";

export interface ConfirmDialogProps {
  /** Nyitva van-e. Zárt állapotban semmit nem rajzol. */
  open: boolean;
  /** A kérdés, a MŰVELETTEL megnevezve: „Törlöd ezt a dokumentumot?" */
  title: string;
  /**
   * MI VÉSZ EL, egy mondatban. Nem „biztos vagy benne", hanem a következmény:
   * mi szűnik meg, mi nem fog működni, mi tűnik el a listákból.
   */
  consequence: string;
  /**
   * HONNAN SZEREZHETŐ VISSZA. Kötelező, és ez a lényege: ha egy művelet
   * visszafordíthatatlan, azt ide KI KELL ÍRNI, nem elhallgatni. A mező
   * megléte az, ami a kérdést feltéteti a fejlesztővel: van-e visszaút.
   */
  recovery: string;
  /** A megerősítő gomb felirata, szintén a művelettel: „Végleges törlés". */
  confirmLabel: string;
  /** Amíg fut a művelet, mindkét gomb tiltva. */
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
  /**
   * EGY RITKÁBB, SÚLYOSABB KIÚT, a gombok ALATT.
   *
   * Nem díszítés: van, ahol két művelet közül az egyik a fő út, a másik a
   * ritkább és a visszafordíthatatlan (az eszköznél a kivezetés és a törlés).
   * Két egymás melletti gomb VÁLASZTÁSSÁ tenné, ami nem az -- a kettő nem
   * egyenrangú. Egy lépéssel beljebb téve az ember már elolvasta, mit jelent a
   * fő út, és csak akkor megy tovább, ha az nem elég neki.
   *
   * A saját megerősítését az hozza, aki ide teszi: ez a slot csak a kiutat
   * mutatja meg, nem hajtja végre.
   */
  children?: React.ReactNode;
}

/**
 * MEGERŐSÍTÉS, AMI MEGMONDJA, MI TÖRTÉNIK.
 *
 * A böngésző `window.confirm` ablaka helyett, és nem stílus miatt: az a
 * szöveget egy sorba zsúfolja, a gomb felirata pedig „OK", tehát a
 * megerősítés semmit nem mond arról, mibe egyezik bele az ember. A kérdés itt
 * három részre bomlik -- mit teszünk, mi vész el, honnan szerezhető vissza --,
 * és a harmadik azért kötelező mező, mert épp azt szokás elfelejteni.
 *
 * AMIT EZ NEM VÁLT KI: ahol a törlés a szerveren FELTÉTELES (hivatkozik-e rá
 * valami), ott nem elég egy kérdés, mert a következmény a szerver válaszától
 * függ. Ott a partner-törlés mintája marad: előbb megkérdezzük a szervert,
 * mi történne, és a választ mutatjuk meg.
 */
export function ConfirmDialog({
  open,
  title,
  consequence,
  recovery,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  /**
   * ESC = mégsem. A kilépés a biztonságos irányba visz, és a billentyűzetes
   * használat nem szorul egérre.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "w-full max-w-md space-y-3 rounded-xl border border-rose-200 bg-white p-5 shadow-lg",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-sm text-slate-700">{consequence}</p>
        <p className="text-sm text-slate-500">{recovery}</p>
        <div className="flex gap-2">
          <Button
            autoFocus
            variant="danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Mégsem
          </Button>
        </div>
        {children ? <div className="pt-1">{children}</div> : null}
      </div>
    </div>
  );
}
