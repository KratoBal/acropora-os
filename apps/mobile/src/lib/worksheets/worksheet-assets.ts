/**
 * A LAP ERINTETT ESZKOZEINEK SZERKESZTESE -- ugyanaz a szerep, mint a
 * `worksheet-assignees.ts`-e, es szandekosan ugyanaz az alak: a szerver `PUT`-ot
 * vesz mindket vegponton, es a bekuldott lista a lap TELJES allapota, nem egy
 * hozzaadas.
 *
 * === MIERT KULON FAJL, NEM A `worksheet-assignees.ts` BOVITESE ===
 *
 * Ket kulon vegpont, ket kulon DTO (`SetWorksheetAssigneesDto` es
 * `SetWorksheetAssetsDto`), ket kulon jelentes ("ki a felelos" kontra "milyen
 * eszkozrol szol a lap"). Egy kozos fajl azt sugallna, hogy a ketto egyutt
 * valtozik.
 *
 * === AZ ALLAPOT NEM SZAMIT, UGYANAZERT, MINT A FELELOSOKNEL ===
 *
 * A `WorksheetAsset` a MUNKALAPHOZ kotodik, nem a verziohoz (lasd a szerver
 * `setAssets` fejleceit) -- tehat lezart lapon is javithato.
 */

/**
 * A KIJELOLES VALTASA, UGYANAZZAL A SORREND-SZABALLYAL, MINT A FELELOSOKNEL:
 * az ujonnan kijelolt eszkoz a lista VEGERE kerul.
 */
export function toggleWorksheetAsset(
  selected: readonly string[],
  assetId: string,
): string[] {
  return selected.includes(assetId)
    ? selected.filter((id) => id !== assetId)
    : [...selected, assetId];
}

/**
 * VALTOZOTT-E AZ ESZKOZ-LISTA A MENTETT ALLAPOTHOZ KEPEST -- a sorrend nem
 * szamit, a tartalom igen. Lasd `worksheetAssigneesChanged` fejleceit: ugyanaz
 * az ok.
 */
export function worksheetAssetsChanged(
  selected: readonly string[],
  current: readonly string[],
): boolean {
  const a = new Set(selected);
  const b = new Set(current);
  if (a.size !== b.size) return true;
  for (const id of a) if (!b.has(id)) return true;
  return false;
}

/**
 * MIT MOND A LAP A VALASZTHATO ESZKOZOKROL -- vagy `null`, ha nincs mit.
 * Lasd `describeAssignableUsers` fejleceit: ugyanaz a harom kulon eset.
 */
export function describeSelectableAssets(input: {
  loading: boolean;
  error: boolean;
  count: number;
}): string | null {
  if (input.error)
    return "Az eszközök listája most nem tölthető be, ezért a kiválasztás nem szerkeszthető. Próbáld újra később.";
  if (input.loading) return "Az eszközök listája töltődik...";
  if (input.count === 0)
    return "Ehhez a helyszínhez nincs felvett eszköz, amit kiválaszthatnál.";
  return null;
}

/**
 * MIERT NEM SZERKESZTHETO, AKI CSAK NEZHETI -- vagy `null`, ha szerkesztheti.
 * Lasd `describeAssigneeReadOnly` fejleceit: ugyanaz a hatarvonal
 * (`service.manage`).
 */
export function describeWorksheetAssetsReadOnly(
  canManage: boolean,
): string | null {
  return canManage
    ? null
    : "Az érintett eszközöket az iroda írja át: a te jogosultságoddal ez a lista csak látszik.";
}
