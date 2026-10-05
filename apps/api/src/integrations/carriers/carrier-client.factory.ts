import {
  type CarrierClient,
  type CarrierCode,
  carrierMode,
} from "./carrier.types.js";
import { FoxpostApiClient, foxpostApiConfig } from "./foxpost-api.client.js";
import { GlsApiClient, glsApiConfig } from "./gls-api.client.js";
import { StubCarrierClient } from "./stub-carrier.client.js";

/**
 * A KAPCSOLO (nautilus 26359): `FOXPOST_API_MODE` es `GLS_API_MODE`, ertekuk
 * `stub` | `test` | `live`. Minden mas ertek, a hiany is, az alszolgaltato:
 * a valodi szolgaltatohoz csak kifejezett beallitas visz. Beallitott mod, de
 * hianyzo hozzaferes eseten a kliens NOT_CONFIGURED hibaval all meg az elso
 * hivasnal, nem esik vissza csendben az alszolgaltatora.
 */
export function carrierClientFor(
  carrier: CarrierCode,
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): CarrierClient {
  // literal reads, so the env-template coverage spec sees both names
  const mode = carrierMode(
    carrier === "foxpost"
      ? environment.FOXPOST_API_MODE
      : environment.GLS_API_MODE,
  );
  if (mode === "stub") return new StubCarrierClient(carrier);
  return carrier === "foxpost"
    ? new FoxpostApiClient(foxpostApiConfig(mode, environment), fetchImpl)
    : new GlsApiClient(glsApiConfig(mode, environment), fetchImpl);
}
