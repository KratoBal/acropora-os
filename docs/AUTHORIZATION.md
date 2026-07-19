# Authorization

## Modell

A jogosultságkezelés két szintből áll:

1. a felhasználó egyetlen `UserRole` szerepkörrel rendelkezik;
2. a szerepkör a központi `ROLE_PERMISSIONS` mátrixon keresztül kap permissionöket.

A role-, permission- és helper-definíciók kizárólag a `@acropora/types` csomag `auth` moduljában élnek. Alkalmazáskódban új permission string literált létrehozni tilos; a `PERMISSIONS` konstans használatos.

## Szerepkörök

- `OWNER`: minden permission
- `ADMIN`: minden permission
- `MANAGER`: minden operatív permission, felhasználó- és rendszerbeállítás-kezelés nélkül
- `SALES`: rendelés- és vevőkezelés, valamint kapcsolódó olvasási jogok
- `WAREHOUSE`: készlet- és beszerzéskezelés
- `SERVICE`: szerviz- és akváriumkezelés
- `VIEWER`: üzleti modulok olvasása

## Segédfüggvények

- `hasPermission(userOrRole, permission)`
- `hasAnyPermission(userOrRole, permissions)`
- `hasAllPermissions(userOrRole, permissions)`

Az üres permissionlista az `all` ellenőrzésben igaz, az `any` ellenőrzésben hamis, a JavaScript szabványos `every`/`some` szemantikájának megfelelően.

## API használat

Az `AuthGuard` alapértelmezetten minden végpontot véd. Publikus végpontot a `@Public()` dekorátor jelöl.

Permissiont igénylő végpont:

```ts
@RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
@Post("stock-adjustment")
adjustStock() {}
```

A `PermissionGuard` minden felsorolt permissiont megkövetel. A controller a `@CurrentUser()` dekorátorral éri el a validált felhasználót.

## Web használat

Az oldalsáv elemei permissiont deklarálnak, az App Shell pedig `hasPermission` alapján szűri őket. Ez kizárólag felületi kényelmi és információrejtési réteg: biztonsági döntést mindig az API-nak kell meghoznia.

## Új permission hozzáadása

1. Vedd fel a `PERMISSIONS` objektumba.
2. Add hozzá a szükséges role-okhoz a `ROLE_PERMISSIONS` mátrixban.
3. Egészítsd ki a mapping tesztjeit.
4. Rendeld hozzá az API-dekorátorhoz és szükség esetén a webes navigációhoz.
