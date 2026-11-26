"use client";

import { useEffect, useId, useRef } from "react";
import { Icon, PilotButton } from "@acropora/ui";

/**
 * A FÁJLVÁLASZTÓ SAJÁT GOMBBAL (picasso képernyő-leltár, 4. pont, P3; acrobot 62248): a natív `<input type="file">` stílus nélküli,
 * a böngésző nyelvén szóló vezérlő volt három lapon (munkalap, karbantartás, eszköz) és az új hibajegyen. Mostantól egy másodlagos
 * gomb nyitja a rejtett mezőt, és mellette a választás áll ("Nincs kiválasztva fájl", vagy a fájl neve, több fájlnál a darabszám és
 * a nevek). Ha a hívó üríti a választást (`files` üres, például feltöltés után), a rejtett mező is ürül: a natív mező eddig a régi
 * nevet mutatta tovább.
 */
export function FilePick({
  accept,
  multiple = false,
  files,
  onChange,
  disabled = false,
}: {
  accept: string;
  multiple?: boolean;
  files: readonly File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const statusId = useId();

  useEffect(() => {
    if (files.length === 0 && input.current) input.current.value = "";
  }, [files]);

  const status =
    files.length === 0
      ? "Nincs kiválasztva fájl"
      : files.length === 1
        ? files[0]!.name
        : `${files.length} fájl: ${files.map((file) => file.name).join(", ")}`;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={input}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => onChange(Array.from(event.target.files ?? []))}
      />
      <PilotButton
        type="button"
        variant="secondary"
        disabled={disabled}
        aria-describedby={statusId}
        onClick={() => input.current?.click()}
      >
        <Icon name="file-text" size={13} />
        {multiple ? "Fájlok kiválasztása" : "Fájl kiválasztása"}
      </PilotButton>
      <span
        id={statusId}
        className="min-w-0 break-words text-sm text-pilot-grey-600"
      >
        {status}
      </span>
    </div>
  );
}
