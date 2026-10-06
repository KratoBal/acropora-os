/**
 * A SZOLGÁLTATÁS-TOKEN, AMIVEL ACROBOT SUTYERÁK NEVÉBEN VISSZAÍRHAT (4. pont B,
 * 5. tétel). Külön rekord, a webshop-levél mintájára: ez a token semmi mást
 * nem nyit, és más token ezt nem nyitja. Beállítatlanul SEMMIT nem enged.
 */
export const SUTYERAK_HANDOFF_TOKEN_ID_ENV = "SUTYERAK_HANDOFF_TOKEN_ID";

/** A környezet jelzője a guardnak (a `NodeJS.ProcessEnv` `Object`-té törlődik). */
export const SUTYERAK_HANDOFF_ENVIRONMENT = Symbol(
  "SUTYERAK_HANDOFF_ENVIRONMENT",
);

export function sutyerakHandoffTokenId(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = environment[SUTYERAK_HANDOFF_TOKEN_ID_ENV]?.trim();
  return value ? value : null;
}
