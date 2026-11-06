/**
 * THE TEXTS A PLAYER ACCEPTS, BY VERSION (acrobot 44375; Balázs's privacy notice, sections 3.1 and 4). The entry form has two
 * separate unticked checkboxes, the rules and the data consent; the server stores when each was given and WHICH VERSION of the
 * two texts was on the page. The page sends the versions it showed; the server only takes an entry made against the current
 * ones (a page from before a text change is told to reload), so a stored version is the version the player really saw.
 *
 * BUMP A VERSION WHEN THE TEXT OF ITS DOCUMENT CHANGES, here and in `apps/jatek/src/lib/jogi-szovegek.ts` (`VERZIO`): a spec
 * reads both files and fails when they differ.
 */
export const GAME_RULES_VERSION = "szabalyzat-1.0";
export const GAME_PRIVACY_VERSION = "adatkezeles-1.0";
