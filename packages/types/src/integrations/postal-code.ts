/// Legjobb-erőfeszítés (nem hivatalos forrásból származó) irányítószám →
/// település javaslat, kizárólag kényelmi automatikus kitöltéshez. Egy
/// irányítószámhoz Magyarországon néha több kis település is tartozhat -
/// ilyenkor az első találat érkezik, amit a felhasználó felülírhat.
export interface PostalCodeLookupResult {
  city: string | null;
}
