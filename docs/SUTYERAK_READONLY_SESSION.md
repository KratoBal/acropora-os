# Sutyerák: read-only dolgozói belépő (1. pont)

Kiinduló állapot: `main@1f94b836`. Ez csak a szerveroldali belépő és védelem;
UI, widget, LLM, ágens és acrobot-integráció nincs benne.

## Kiadás és használat

`POST /auth/assistant-sessions`, a dolgozó meglévő Bearer-tokenjével vagy
munkamenet-sütijével (utóbbinál a meglévő CSRF-szabály is érvényes).
Nincs választható userId: kizárólag a kérő saját, aktuális felhasználója.
A válasz a meglévő Session-szerződés: `id`, `user`, `token`, `expiresAt`;
`Cache-Control: no-store`, sütit nem állít. A nyers belépő csak ebben a válaszban
jelenik meg; az adatbázis SHA-256 lenyomatot tárol. A későbbi hívásoknál
`Authorization: Bearer <token>` használható.

- Forrás: kizárólag `Session.kind === USER` és `partnerScopeOf(user).kind === internal`.
- Partner: 403. Assistant-session nem adhat ki új belépőt.
- Fix lejárat: a kiadástól 10 perc, megújítás nélkül; lejárva 401.
- Legfeljebb 3 élő assistant-session/felhasználó, a negyedik 429.
- Kiadáskor a User sor zárolása és explicit READ COMMITTED tranzakció védi a
  korlátot párhuzamos API-példányok között. A lejárt sorok nem számítanak bele;
  a kiadás nem töröl régi belépőt.
- A migráció a korábbi munkameneteket `USER`-ként tartja meg. A normál webes és
  mobilos munkamenetek eddigi csúszó lejárata megmarad.

## Read-only védelem és jogosultság

Az auth-context a tárolt `kind` mezőt használja, nem a token előtagját.
A globális sorrend: `AuthGuard → AssistantReadonlyGuard → PermissionGuard`.
Kizárólag GET engedett. HEAD, OPTIONS, POST, PUT, PATCH és DELETE sem kap
üzleti API-hozzáférést. A CORS infrastruktúra preflight-kezelése külön történik.
Az összes `/auth` út (a publikus login, `/auth/me`, logout és issuance is),
valamint a session- és jelszókezelési útcsaládok tiltottak.
Az endpoint-tiltás a Nest route-metaadatából dolgozik, nem a kliens URL-jéből.

Minden kérés újra a normál AuthUserResolverrel tölti be az aktuális felhasználót.
A PermissionGuard, a szerepek, képességek és partner-scope szabályai nem
módosultak. Egy későbbi szerep- vagy partner-hozzárendelési változás nem marad
befagyasztva a belépőben. Az assistant olvasása nem hosszabbít és nem töröl
Session sort, és nem állít hosszabb lejáratú sütit.

## Mellékhatásos GET-ek mérése

Az alapállapot 194 GET-deklarációjának controller → service → repository
útvonalát vizsgáltuk; a közvetett függvényeket, dashboard-adatbetöltőket és
feltételes/lusta írásokat is figyelembe vettük. A szinkronizálás GET-es
állapotlekérdezése és POST-os indítása külön út. A memóriában készített PDF/XLSX,
a dokumentumtároló olvasása és az adatot nem mentő külső lekérdezések olvasók.
A vizsgált útvonalak leltára a dokumentum végén szerepel.

A tiltólista akkor is érvényes, ha az adott sor már gyorsítótárazott vagy
feldolgozott, tehát egy konkrét kérés éppen nem írna. A dashboard teljes
`widgets` útját tiltjuk, mert egy kérés több adatbetöltőt is választhat.

| Tiltott GET                                              | Írási út                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| `/missing-invoices/months`                               | `compute → checkPayees → setPayee`                          |
| `/missing-invoices/months/:month`                        | ugyanez                                                     |
| `/missing-invoices/months/:month/missing.xlsx`           | ugyanez                                                     |
| `/missing-invoices/months/:month/accountant-package.pdf` | ugyanez                                                     |
| `/missing-invoices/items/:id`                            | ugyanez                                                     |
| `/missing-invoices/items/:id/jev-suggestion`             | vevő-utóellenőrzés + JEV DecisionRun                        |
| `/billing/incoming-documents`                            | `documentPairings → compute → setPayee`                     |
| `/billing/incoming-documents/:id`                        | ugyanez                                                     |
| `/integrations/nav/invoices/:id`                         | lusta `queryInvoiceData → saveParsedData / markError`       |
| `/dashboard/widgets`                                     | `missing-invoices` loader → cache miss → `months → compute` |

A lista forrása `assistant-readonly.policy.ts`. A teszt tételesen felsorolja a
tíz útvonalat, valódi controller-handlerhez köti őket, és mindegyiknél méri a
403-at. Új GET vagy a hívási lánc módosítása esetén ezt az auditot és a listát is
felül kell vizsgálni.

## Audit

A globális middleware a route kiválasztása előtt azonosítja az assistant-sessiont,
beleértve a lejárt tokeneket is. A publikus, 403-as, 401-es, 404-es, 500-as és
megszakadt kérések is naplózódnak. A lejárt assistant-sor megmarad az
azonosíthatóság miatt; külön megőrzési/takarítási folyamat nincs ebben a PR-ben.

A meglévő `AuditLog` tárolja: `action=assistant.request`, `userId=actorUserId`,
`entityType=Session`, `entityId=sessionId`. Metadata: actorUserId, sessionId,
endpoint (query nélkül), method, timestamp, status, result, completedAt.
Nyers token, Authorization/cookie fejléc, kérés- vagy válaszbody nincs a naplóban.

A kérés előtt tartós PENDING audit-sor készül. Ha ez nem írható, a kérés nem jut
el az üzleti handlerig, és strukturált hibalog készül. A HTTP-válasz lezárásakor
SUCCESS/REJECTED eredmény és státusz kerül a sorba; megszakadáskor 499/ABORTED.
Az egyszeri lezárás védi a finish/close kettős eseményt. Ha az eredmény mentése
meghiúsul, a PENDING sor megmarad, az eredményt strukturált hibalog tartalmazza.
Folyamatleállás a kezdés és lezárás között szintén PENDING sort hagyhat.
Az audit írása az egyetlen szándékos írás a read-only kérésben.

## Ellenőrzés

```sh
pnpm exec turbo run test --filter=@acropora/api
pnpm --filter @acropora/api typecheck
pnpm --filter @acropora/database db:validate
node scripts/calibrate-assistant-readonly.mjs
```

A kalibráció kizárólag az ideiglenes `test-dist` fájlokat módosítja; a forrást nem.
Mind az öt szabály (POST, mellékhatásos GET, partner, lejárat, permission-paritás)
elrontásakor a megfelelő HTTP-állításnak pirosnak kell lennie, visszaállításkor a
teljes Sutyerák-készletnek zöldnek. A módosítások végül minden esetben visszaállnak.

Az `assistant-session.integration.spec.ts` a kódtár közös tesztadatbázis-kapuját
használja. Dedikált `_test` vagy `_ci` adatbázis, migráció és
`RUN_DB_INTEGRATION=1` szükséges. Mérjük a régi sor USER-visszatöltését, a 12
párhuzamos kiadásból pontosan 3 sikert két külön adatbázis-klienssel, a lejárt
sor megmaradását, a fix lejáratot és a tartós 401 auditot. A teszt saját sorait
azonosító szerint takarítja.

## A vizsgált GET-ek leltára

| Útvonal                                                           | Handler                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| `GET /`                                                           | `AppController.getWelcome`                             |
| `GET /aquariums`                                                  | `AquariumsController.list`                             |
| `GET /aquariums/:id`                                              | `AquariumsController.detail`                           |
| `GET /aquariums/:id/measurements`                                 | `AquariumsController.listMeasurements`                 |
| `GET /aquariums/:id/measurements/export.xlsx`                     | `AquariumsController.exportMeasurementsXlsx`           |
| `GET /aquariums/customers`                                        | `AquariumsController.selectableCustomers`              |
| `GET /aquariums/maintainers/selectable`                           | `AquariumsController.selectableMaintainers`            |
| `GET /asset-categories`                                           | `AssetCategoriesController.list`                       |
| `GET /asset-functions`                                            | `AssetFunctionsController.list`                        |
| `GET /auth/me`                                                    | `AuthController.getCurrentUser`                        |
| `GET /billing/documents`                                          | `BillingDocumentReadController.list`                   |
| `GET /billing/documents/:id`                                      | `BillingDocumentsController.detail`                    |
| `GET /billing/documents/:id/email-draft`                          | `BillingDocumentEmailController.draft`                 |
| `GET /billing/documents/:id/pdf`                                  | `BillingDocumentReadController.pdf`                    |
| `GET /billing/email-draft`                                        | `BillingEmailDraftController.draft`                    |
| `GET /billing/external-documents/:id`                             | `ExternalBillingDocumentsController.detail`            |
| `GET /billing/incoming-documents`                                 | `IncomingBillingDocumentsController.list`              |
| `GET /billing/incoming-documents/:id`                             | `IncomingBillingDocumentsController.detail`            |
| `GET /billing/incoming-documents/:id/pdf`                         | `IncomingBillingDocumentsController.pdf`               |
| `GET /billing/paid-marks/latest`                                  | `PaidMarksController.latest`                           |
| `GET /billing/receipts`                                           | `IncomingBillingDocumentsController.receipts`          |
| `GET /brands`                                                     | `BrandsController.list`                                |
| `GET /brands/:id`                                                 | `BrandsController.detail`                              |
| `GET /brands/import-assistant/batches`                            | `BrandImportAssistantController.batches`               |
| `GET /brands/import-assistant/batches/:batchId`                   | `BrandImportAssistantController.summary`               |
| `GET /brands/import-assistant/batches/:batchId/rows`              | `BrandImportAssistantController.rows`                  |
| `GET /brands/options`                                             | `BrandsController.options`                             |
| `GET /categories/options`                                         | `CatalogOptionsController.listCategoryOptions`         |
| `GET /content/:id`                                                | `ContentController.detail`                             |
| `GET /content/calendar`                                           | `ContentController.calendar`                           |
| `GET /content/ideas`                                              | `ContentController.ideas`                              |
| `GET /content/waiting`                                            | `ContentController.waiting`                            |
| `GET /content/waiting-for-image`                                  | `ContentController.waitingForImage`                    |
| `GET /content/waiting-on-me`                                      | `ContentController.waitingOnMe`                        |
| `GET /customers`                                                  | `CustomersController.list`                             |
| `GET /customers/:id`                                              | `CustomersController.detail`                           |
| `GET /dashboard/layout`                                           | `DashboardController.layout`                           |
| `GET /dashboard/summary`                                          | `DashboardController.summary`                          |
| `GET /dashboard/widgets`                                          | `DashboardController.widgetData`                       |
| `GET /health`                                                     | `AppController.getHealth`                              |
| `GET /health/inventory/activation-readiness`                      | `StockDiagnosticsController.activationReadiness`       |
| `GET /health/inventory/diagnostics`                               | `StockDiagnosticsController.diagnostics`               |
| `GET /health/inventory/live`                                      | `StockDiagnosticsController.live`                      |
| `GET /health/inventory/ready`                                     | `StockDiagnosticsController.ready`                     |
| `GET /imports/unas/:batchId/brand-reviews`                        | `UnasImportController.brandReviews`                    |
| `GET /imports/unas/:batchId/report`                               | `UnasImportController.report`                          |
| `GET /integrations/ai-product-search`                             | `AiProductSearchController.search`                     |
| `GET /integrations/ai/user-context`                               | `AiUserContextController.userContext`                  |
| `GET /integrations/foxpost/reports`                               | `FoxpostSettlementController.reports`                  |
| `GET /integrations/foxpost/reports/:year/:month/download`         | `FoxpostSettlementController.downloadReport`           |
| `GET /integrations/foxpost/settlements`                           | `FoxpostSettlementController.list`                     |
| `GET /integrations/foxpost/settlements/:id`                       | `FoxpostSettlementController.detail`                   |
| `GET /integrations/foxpost/sync`                                  | `FoxpostSettlementController.syncStatus`               |
| `GET /integrations/gls/cod-reports`                               | `GlsSettlementController.listReports`                  |
| `GET /integrations/gls/cod-reports/:id`                           | `GlsSettlementController.reportDetail`                 |
| `GET /integrations/gls/invoices`                                  | `GlsSettlementController.listInvoices`                 |
| `GET /integrations/gls/reports/:year/:month/download`             | `GlsSettlementController.downloadReport`               |
| `GET /integrations/gls/sync`                                      | `GlsSettlementController.syncStatus`                   |
| `GET /integrations/medusa/connection`                             | `MedusaConnectionController.get`                       |
| `GET /integrations/nav/connection`                                | `NavConnectionController.get`                          |
| `GET /integrations/nav/invoices`                                  | `NavIncomingInvoiceController.list`                    |
| `GET /integrations/nav/invoices/:id`                              | `NavIncomingInvoiceController.detail`                  |
| `GET /integrations/nav/invoices/sync-runs`                        | `NavIncomingInvoiceController.listRuns`                |
| `GET /integrations/nav/invoices/sync-runs/:runId`                 | `NavIncomingInvoiceController.getRun`                  |
| `GET /integrations/nav/taxpayer/:taxNumber`                       | `NavTaxpayerController.lookup`                         |
| `GET /integrations/postal-code/:zip`                              | `PostalCodeController.lookup`                          |
| `GET /integrations/simplepay/monthly/:year/:month/download`       | `SimplePaySettlementController.downloadMonthly`        |
| `GET /integrations/simplepay/reports`                             | `SimplePaySettlementController.listReports`            |
| `GET /integrations/simplepay/reports/:id`                         | `SimplePaySettlementController.reportDetail`           |
| `GET /integrations/simplepay/sync`                                | `SimplePaySettlementController.syncStatus`             |
| `GET /integrations/szamlazz/connection`                           | `SzamlazzConnectionController.get`                     |
| `GET /integrations/unas/connection`                               | `UnasConnectionController.get`                         |
| `GET /integrations/unas/customers/sync-runs`                      | `UnasCustomerSyncController.listRuns`                  |
| `GET /integrations/unas/customers/sync-runs/:runId`               | `UnasCustomerSyncController.getRun`                    |
| `GET /integrations/unas/orders`                                   | `UnasOrderSyncController.list`                         |
| `GET /integrations/unas/orders/:id`                               | `UnasOrderSyncController.getOne`                       |
| `GET /integrations/unas/orders/deletion-reconciliation/status`    | `UnasOrderSyncController.deletionReconciliationStatus` |
| `GET /integrations/unas/orders/stock/reconciliation`              | `UnasOrderSyncController.checkStockReconciliation`     |
| `GET /integrations/unas/orders/sync-runs`                         | `UnasOrderSyncController.listRuns`                     |
| `GET /integrations/unas/orders/sync-runs/:runId`                  | `UnasOrderSyncController.getRun`                       |
| `GET /integrations/unas/products/sync-runs`                       | `UnasProductSyncController.listRuns`                   |
| `GET /integrations/unas/products/sync-runs/:runId`                | `UnasProductSyncController.getRun`                     |
| `GET /integrations/unas/stock-sync/outbox`                        | `UnasStockSyncOutboxController.list`                   |
| `GET /integrations/unas/stock-sync/outbox/:id`                    | `UnasStockSyncOutboxController.getOne`                 |
| `GET /integrations/unas/stock-sync/outbox/summary`                | `UnasStockSyncOutboxController.summary`                |
| `GET /integrations/vies/check/:taxNumber`                         | `ViesVatController.check`                              |
| `GET /inventory/counts`                                           | `InventoryCountController.list`                        |
| `GET /inventory/counts/:id`                                       | `InventoryCountController.detail`                      |
| `GET /inventory/counts/:id/template.xlsx`                         | `InventoryCountController.downloadTemplate`            |
| `GET /inventory/reconciliation`                                   | `StockReconciliationController.page`                   |
| `GET /inventory/reconciliation/missing-stock-item`                | `StockReconciliationController.missingStockItem`       |
| `GET /inventory/reconciliation/repairs/:repairId`                 | `StockReconciliationRepairController.getRepair`        |
| `GET /inventory/reconciliation/summary`                           | `StockReconciliationController.summary`                |
| `GET /missing-invoices/items/:id`                                 | `MissingInvoicesController.item`                       |
| `GET /missing-invoices/items/:id/jev-suggestion`                  | `MissingInvoicesController.jevSuggestion`              |
| `GET /missing-invoices/months`                                    | `MissingInvoicesController.months`                     |
| `GET /missing-invoices/months/:month`                             | `MissingInvoicesController.month`                      |
| `GET /missing-invoices/months/:month/accountant-package.pdf`      | `MissingInvoicesController.accountantPackage`          |
| `GET /missing-invoices/months/:month/missing.xlsx`                | `MissingInvoicesController.missingXlsx`                |
| `GET /missing-invoices/suggestions`                               | `InvoiceCollectionSuggestionsController.list`          |
| `GET /missing-invoices/suggestions/:id/file`                      | `InvoiceCollectionSuggestionsController.file`          |
| `GET /notifications/mail-images`                                  | `MailImageController.list`                             |
| `GET /notifications/mail-images/:id/content`                      | `MailImageController.content`                          |
| `GET /notifications/mail-templates/:id`                           | `MailTemplateController.read`                          |
| `GET /orders/unas/stock-audit`                                    | `UnasOrderStockAuditController.page`                   |
| `GET /orders/unas/stock-audit/anomalies`                          | `UnasOrderStockAuditController.anomalies`              |
| `GET /orders/unas/stock-audit/summary`                            | `UnasOrderStockAuditController.summary`                |
| `GET /partners/completion-certificates`                           | `CompletionCertificatesController.list`                |
| `GET /partners/completion-certificates/:id`                       | `CompletionCertificatesController.detail`              |
| `GET /partners/completion-certificates/:id/documents/:documentId` | `CompletionCertificatesController.download`            |
| `GET /partners/contracts`                                         | `ContractsController.list`                             |
| `GET /partners/contracts/:id`                                     | `ContractsController.detail`                           |
| `GET /partners/contracts/:id/documents/:documentId`               | `ContractsController.download`                         |
| `GET /partners/contracts/customers`                               | `ContractsController.customers`                        |
| `GET /partners/maintenance-invoice/:invoiceId/pdf`                | `MaintenanceInvoiceController.pdf`                     |
| `GET /partners/maintenance-invoice/by-certificate/:certificateId` | `MaintenanceInvoiceController.byCertificate`           |
| `GET /partners/maintenance-orders`                                | `MaintenanceOrdersController.list`                     |
| `GET /partners/maintenance-orders/:id`                            | `MaintenanceOrdersController.detail`                   |
| `GET /partners/maintenance-orders/:id/documents/:documentId`      | `MaintenanceOrdersController.download`                 |
| `GET /partners/maintenance-package/:id/download`                  | `MaintenancePackageController.download`                |
| `GET /partners/maintenance-package/:id/mail`                      | `MaintenancePackageController.preview`                 |
| `GET /pos/products`                                               | `PosController.searchProducts`                         |
| `GET /pos/sales`                                                  | `PosController.listSales`                              |
| `GET /pos/sales/:id`                                              | `PosController.getSale`                                |
| `GET /product-barcodes/:variantId`                                | `ProductBarcodeController.list`                        |
| `GET /product-extensions/:variantId`                              | `ProductExtensionController.getByVariantId`            |
| `GET /products`                                                   | `ProductController.listProducts`                       |
| `GET /products/:id`                                               | `ProductController.getProduct`                         |
| `GET /products/:productId/shipping-profile`                       | `ProductShippingProfileController.get`                 |
| `GET /purchasing/exchange-rate`                                   | `PurchasingController.getExchangeRate`                 |
| `GET /purchasing/expected-arrivals`                               | `ExpectedArrivalController.list`                       |
| `GET /purchasing/expected-arrivals/:id`                           | `ExpectedArrivalController.detail`                     |
| `GET /purchasing/expected-arrivals/sync`                          | `ExpectedArrivalController.status`                     |
| `GET /purchasing/invoices`                                        | `PurchasingController.listInvoices`                    |
| `GET /purchasing/invoices/:id`                                    | `PurchasingController.getInvoice`                      |
| `GET /purchasing/products/conflicts`                              | `PurchasingController.productConflicts`                |
| `GET /purchasing/products/search`                                 | `PurchasingController.searchProducts`                  |
| `GET /purchasing/projects`                                        | `PurchasingController.listProjects`                    |
| `GET /search`                                                     | `SearchController.search`                              |
| `GET /service/assets`                                             | `ServiceAssetsController.list`                         |
| `GET /service/assets/:id`                                         | `ServiceAssetsController.detail`                       |
| `GET /service/assets/:id/documents`                               | `ServiceAssetsController.documents`                    |
| `GET /service/assets/:id/documents/:documentId`                   | `ServiceAssetsController.downloadDocument`             |
| `GET /service/assets/:id/neighbors`                               | `ServiceAssetsController.neighbors`                    |
| `GET /service/assets/:id/qr`                                      | `ServiceAssetsController.qrCode`                       |
| `GET /service/assets/document-store`                              | `ServiceAssetsController.documentStoreStatus`          |
| `GET /service/assets/label-batches`                               | `ServiceAssetsController.labelBatches`                 |
| `GET /service/assets/label-batches/:id/codes`                     | `ServiceAssetsController.labelBatchCodes`              |
| `GET /service/assets/labels/free`                                 | `ServiceAssetsController.freeLabels`                   |
| `GET /service/assets/name-check`                                  | `ServiceAssetsController.nameCheck`                    |
| `GET /service/assets/owners`                                      | `ServiceAssetsController.owners`                       |
| `GET /service/assets/scan-label/:code`                            | `ServiceAssetsController.scanLabel`                    |
| `GET /service/assets/scan/:qrToken`                               | `ServiceAssetsController.scan`                         |
| `GET /service/completion-certificates`                            | `CompletionCertificatesPortalController.list`          |
| `GET /service/completion-certificates/:id`                        | `CompletionCertificatesPortalController.detail`        |
| `GET /service/completion-certificates/:id/documents/:documentId`  | `CompletionCertificatesPortalController.download`      |
| `GET /service/jobs`                                               | `ServiceJobsController.list`                           |
| `GET /service/jobs/:id`                                           | `ServiceJobsController.detail`                         |
| `GET /service/jobs/:id/documents`                                 | `ServiceJobDocumentsController.documents`              |
| `GET /service/jobs/:id/documents/:documentId`                     | `ServiceJobDocumentsController.downloadDocument`       |
| `GET /service/jobs/:id/download`                                  | `ServiceJobsController.downloadPackage`                |
| `GET /service/jobs/:id/mail`                                      | `HandoverMailController.preview`                       |
| `GET /service/jobs/visibility/:userId`                            | `ServiceJobsController.listAssignments`                |
| `GET /service/jobs/visibility/:userId/units`                      | `ServiceJobsController.selectableUnits`                |
| `GET /service/maintenance-orders`                                 | `MaintenanceOrdersPortalController.list`               |
| `GET /service/maintenance-orders/:id`                             | `MaintenanceOrdersPortalController.detail`             |
| `GET /service/maintenance-orders/:id/documents/:documentId`       | `MaintenanceOrdersPortalController.download`           |
| `GET /service/material-requests`                                  | `MaterialRequestsController.listPending`               |
| `GET /service/material-requests/:id`                              | `MaterialRequestsController.detail`                    |
| `GET /service/material-requests/handler-options`                  | `MaterialRequestsController.handlerOptions`            |
| `GET /service/material-requests/history`                          | `MaterialRequestsController.listHistory`               |
| `GET /service/material-requests/overview`                         | `MaterialRequestsController.overview`                  |
| `GET /service/material-requests/summary`                          | `MaterialRequestsController.summary`                   |
| `GET /service/worksheets`                                         | `WorksheetsController.list`                            |
| `GET /service/worksheets/:id`                                     | `WorksheetsController.detail`                          |
| `GET /service/worksheets/:id/documents`                           | `WorksheetsController.documents`                       |
| `GET /service/worksheets/:id/documents/:documentId`               | `WorksheetsController.downloadDocument`                |
| `GET /service/worksheets/:id/entries`                             | `WorksheetsController.entries`                         |
| `GET /service/worksheets/:id/signers`                             | `WorksheetsController.signers`                         |
| `GET /service/worksheets/:id/versions/:version/diff`              | `WorksheetsController.diff`                            |
| `GET /service/worksheets/:worksheetId/material-requests`          | `MaterialRequestsController.listForWorksheet`          |
| `GET /service/worksheets/assignable-users`                        | `WorksheetsController.assignableUsers`                 |
| `GET /service/worksheets/attachable`                              | `WorksheetsController.attachableWorksheets`            |
| `GET /service/worksheets/customers/:customerId/departments`       | `WorksheetsController.departments`                     |
| `GET /service/worksheets/selectable-partners`                     | `WorksheetsController.selectablePartners`              |
| `GET /suppliers`                                                  | `SuppliersController.list`                             |
| `GET /suppliers/:id`                                              | `SuppliersController.detail`                           |
| `GET /suppliers/:id/deletion-plan`                                | `SuppliersController.deletionPlan`                     |
| `GET /suppliers/:id/units`                                        | `SuppliersController.units`                            |
| `GET /tasks/assignees`                                            | `TasksController.assignees`                            |
| `GET /tasks/mine`                                                 | `TasksController.listMine`                             |
| `GET /units-of-measure`                                           | `UnitsController.list`                                 |
| `GET /users`                                                      | `UsersController.list`                                 |
| `GET /users/:id`                                                  | `UsersController.detail`                               |
