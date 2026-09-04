/**
 * A VETITES HITELESITO ADATA ES KLIENSE, KULON MODULBAN.
 *
 * MIERT KULON, ES MIERT NEM A FUTTATOBAN: ezt a harom dolgot NEGY MASIK
 * parancs is hasznalja (`medusa-inventory.cli.ts`, `medusa-pricing.cli.ts`,
 * `medusa-category.cli.ts`, `medusa-brand.cli.ts`). Ha a futtatoba kerultek
 * volna, azok a parancsok egy "vetites-futtato" nevu modulbol importalnanak
 * hitelesitest -- vagy a futtato importalna a parancsbol, ami korkoros.
 *
 * A SOROK BETURE VALTOZATLANOK. Ez a modul az athelyezes eredmenye, nem uj kod.
 */
import {
  medusaClientFromEnvironment,
  type MedusaAdminClient,
} from "./medusa-admin.client.js";
import { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";
import { MedusaCredentialProvider } from "./medusa-credential.provider.js";

/**
 * A TARTALÉK ÚT KIMONDÁSA, egy sorban.
 *
 * A tartalék természete, hogy MŰKÖDIK, és amíg működik, senki nem veszi észre,
 * hogy még mindig azt használjuk. Így lesz egy átmenetből állapot. Enélkül a sor
 * nélkül a kör állítása nem is ellenőrizhető: valaki futtatná környezeti
 * változóval, látná, hogy megy, és azt hinné, hogy a tárolt úton ment.
 */
export const MEDUSA_PROJECTION_FALLBACK_NOTICE =
  "TARTALÉK ÚT: a kulcs a MEDUSA_ADMIN_API_KEY környezeti változóból jött, " +
  "mert tárolt hitelesítő adat nincs beállítva. Állítsd be a Beállítások " +
  "oldalon, hogy a titok ne a folyamat környezetében éljen.";

/**
 * A KULCS a tárolóból, a CÍM a környezetből.
 *
 * Ez a kör állítása: a vetítés a kulcs parancssori vagy környezeti átadása
 * NÉLKÜL is lefut, tehát a titok többé nem kerül a héj előzményeibe és a
 * folyamatlistába. A cím marad a környezetben, mert az nem titok.
 *
 * Azért külön, exportált függvény, és nem a parancs törzsébe írt néhány sor,
 * mert MÉRHETŐNEK kell lennie adatbázis nélkül. A kliens a VALÓDI gyárral
 * készül, csak a `fetch` cserélhető: egy teszt, ami saját hamis klienst adna át,
 * pontosan ezt az utat NEM mérné, és zöld maradna akkor is, ha ide bárki
 * visszacsempész egy környezeti kulcs-olvasást.
 */

export async function medusaClientForProjection(
  credentials: MedusaCredentialProvider,
  out: { stdout(value: string): void; stderr(value: string): void },
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): Promise<MedusaAdminClient> {
  const resolved = await credentials.resolve();

  if (resolved.source === "env")
    out.stderr(`${MEDUSA_PROJECTION_FALLBACK_NOTICE}\n`);
  // A REVÍZIÓ a kulcs azonossága, nem a kulcs: ez mehet a kimenetre.
  else
    out.stdout(
      `A tárolt hitelesítő adatot használom (${resolved.revision}).\n`,
    );

  return medusaClientFromEnvironment(resolved.apiKey, env, fetchImpl);
}

/** Amit a parancs használ, ha a hívó nem ad mást: a tárolt kulcs útja. */
export function storedCredentialProvider(): MedusaCredentialProvider {
  return new MedusaCredentialProvider(
    new MedusaConnectionRepository(),
    new MedusaCredentialCryptoService(),
  );
}

/**
 * Egy sor, embernek. A hitelesítő adat hiánya nem programhiba, hanem a futtatás
 * első lépése, amit el lehet felejteni; a sérült adat viszont igen, és a kettő
 * NEM látszhat ugyanannak.
 */
export function describeCredentialFailure(
  error: MedusaConnectionError,
): string {
  if (
    error.code === "MEDUSA_CONNECTION_NOT_CONFIGURED" ||
    error.code === "MEDUSA_CONNECTION_CONFIGURATION_MISSING"
  )
    return (
      "A Medusa hitelesítő adat nincs beállítva. Állítsd be a Beállítások " +
      "oldalon (Medusa kapcsolat), és futtasd újra."
    );
  if (error.code === "MEDUSA_CONNECTION_DISABLED")
    return "A Medusa kapcsolat le van tiltva, ezért a vetítés nem fut.";
  return `A tárolt Medusa hitelesítő adat nem használható (${error.code}).`;
}
