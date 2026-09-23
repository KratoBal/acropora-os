/**
 * ERTESITESI SZEREPEK -- MEGNEVEZETT KESZLET, EGY HELYEN.
 *
 * Balazs 2026-09-22-en MASODSZOR kert ertesitesi jelolonegyzetet a sajat
 * felhasznaloinkra, es maga mondta, hogy tobb pont jon. Ezert keszlet, nem
 * kulon logikai oszlopok: a kovetkezo pontok UJ ELEMKENT kerulnek ide.
 *
 * A FELIRAT ITT ALL, NEM A FELULETEN. Ugyanaz a nev kell a webes
 * jelolonegyzet melle es barmely kesobbi olvasohoz -- ket masolatbol az egyik
 * elobb-utobb mast mond, es a kulonbseg nema.
 */
export interface NotificationRoleInfo {
  /** Az adatbazis enum erteke. */
  readonly value: "SERVICE_JOB_OPENED" | "MATERIAL_REQUEST_CREATED";
  /** A jelolonegyzet felirata. */
  readonly label: string;
  /** Mit jelent, ha be van jelolve -- a felirat ala. */
  readonly description: string;
}

export const NOTIFICATION_ROLES: readonly NotificationRoleInfo[] = [
  {
    value: "SERVICE_JOB_OPENED",
    label: "Hibajegy-felelős",
    description:
      "Push és e-mail értesítést kap, amikor egy ügyfél hibajegyet nyit a partnerportálon.",
  },
  {
    value: "MATERIAL_REQUEST_CREATED",
    label: "Anyagigény-felelős",
    description:
      "Push és e-mail értesítést kap, amikor egy szervizes anyagigényt küld a munkalapról. Ez csak az értesülés szerepe -- a beérkezés jelölése külön jogosultság, ettől a jelölőtől függetlenül állítható.",
  },
] as const;

export type NotificationRoleValue = NotificationRoleInfo["value"];

export const NOTIFICATION_ROLE_VALUES: readonly NotificationRoleValue[] =
  NOTIFICATION_ROLES.map((szerep) => szerep.value);
