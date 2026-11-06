/**
 * A PRÓBALEVÉL LINKJÉNEK TOKENJE (acrobot 44553): az OS admin "Próbalevél küldése" gombja `proba.` kezdetű tokent tesz a levél
 * linkjébe. A /megerosites oldal ezt felismeri, és nem kínál megerősítést (nincs mit): azt írja ki, hogy a link működik.
 * A PONT SZÁNDÉKOS: a valódi token base64url (A-Z a-z 0-9 - _), abban nincs pont, így egy valódi token nem kezdődhet így.
 * Az api ugyanezt a előtagot használja (`TEST_TOKEN_PREFIX`, game-confirmation-mail.ts); az api egyik specje összeveti.
 */
export const PROBA_TOKEN_PREFIX = "proba.";

export const probaToken = (token: string): boolean =>
  token.startsWith(PROBA_TOKEN_PREFIX);

export const PROBA_UZENET = "Ez próbalevél volt: a link működik.";
