import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  CustomerAddress,
  CustomerDetail,
  CustomerListResponse,
  CustomerListRole,
  CustomerPartnerRole,
  CustomerSummary,
} from "@acropora/types";

import { withUniqueCode } from "../common/unique-code.util.js";
import {
  partnerTaxNumberFor,
  partnerTermsFor,
} from "./partner-payment-terms.js";
import type {
  CreateCustomerDto,
  CustomerListQueryDto,
  UpdateCustomerDto,
} from "./dto/customer.dto.js";

const EXTERNAL_ENTITY_TYPE = "Customer";

/**
 * The search text as a LIKE pattern that matches it anywhere, literally. `%`
 * and `_` are wildcards in LIKE and the backslash is PostgreSQL's default
 * escape, so all three are escaped: "100%" finds "100%", not "100" followed by
 * anything.
 *
 * THE OLD PATH DID NOT DO THIS EITHER, and that was measured, not assumed: on
 * the calibration branch that put Prisma's `contains` back, "100% Kft" also
 * returned "1000 Kft" (meres/vevo-kereses-a, run 36752101646). So this is a
 * fix of its own, not a behaviour the raw query had to re-create.
 */
export function customerSearchPattern(search: string): string {
  return `%${search.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * THE TAX NUMBER AS TYPED, WITHOUT ITS SEPARATORS (Luca, 2026-10-08: „nem
 * talál adószám alapján sem”; acrobot 28132). `12345678-2-42`, `12345678242`
 * and `12345678 2 42` are the same number, so both sides are compared with
 * only their letters and digits, upper case. `null` when the search has no
 * digit (a name is not a tax number) or fewer than four characters left.
 */
export function taxNumberSearchKey(search: string): string | null {
  // a Hungarian number typed with its country code (HU12345678) is the same
  // number: the stored one has no HU (barracuda, acrobot 28184)
  const key = search
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase()
    .replace(/^HU(?=\d)/, "");
  return key.length >= 4 && /\d/.test(key) ? key : null;
}

/**
 * A SOR EGY PARTNER VEVŐ-TÜKRE, ha él a partnere: a törölt partner (Supplier.deletedAt) sora ismét sima vevő-sor, nem kap partner
 * jelvényt, és a szerkesztése nem tiltott (a Partnerek képernyőn a törölt partner nem szerkeszthető, tehát a tiltás zsákutca
 * volna; barracuda, #2184 review).
 */
export function isPartnerMirror(
  partner: { deletedAt?: Date | null } | null,
): boolean {
  return partner !== null && !partner.deletedAt;
}

/**
 * A SZEREPEK A SUPPLIER-KÖTÉSBŐL (egy partnertörzs): a vevő-sor szerepei jelölésként, külön oszlop nélkül. Csak a partner-sornál
 * van (a vevőnél a mező hiányzik).
 */
export function partnerRolesOf(
  partner: {
    isSupplier: boolean;
    isService: boolean;
    deletedAt?: Date | null;
  } | null,
): { partnerRoles?: CustomerPartnerRole[] } {
  // egy törölt partner (Supplier.deletedAt) sora nem partner: a jelvény és a szerep nem látszik rajta (barracuda, #2182)
  if (!partner || partner.deletedAt) return {};
  const roles: CustomerPartnerRole[] = [];
  if (partner.isSupplier) roles.push("SUPPLIER");
  if (partner.isService) roles.push("SERVICE");
  return { partnerRoles: roles };
}

/**
 * A VEVŐ-LISTA SZEREP-SZŰRŐJE A `where`-BEN. Szerep nélkül a régi viselkedés (a partner vevő-tükrei kimaradnak, hacsak a hívó
 * nem kéri őket: a számla vevőválasztója). Szereppel a lista a partnereket is mutatja: `BUYER` csak a vevőket (partner nélkül),
 * `PARTNER` minden partnert, `SUPPLIER` a beszállítókat, `SERVICE` a szerviz-partnereket, `ALL` mindenkit.
 */
export function partnerFilter(
  role: CustomerListRole | undefined,
  includeMirrors: boolean,
): Prisma.CustomerWhereInput {
  switch (role) {
    case undefined:
      return includeMirrors ? {} : { partner: null };
    case "ALL":
      return {};
    case "BUYER":
      // a törölt partner sora ismét sima vevő-sor
      return {
        OR: [
          { partner: null },
          { partner: { is: { deletedAt: { not: null } } } },
        ],
      };
    case "PARTNER":
      return { partner: { is: { deletedAt: null } } };
    case "SUPPLIER":
      return { partner: { is: { isSupplier: true, deletedAt: null } } };
    case "SERVICE":
      return { partner: { is: { isService: true, deletedAt: null } } };
  }
}

const addressesInclude = {
  orderBy: [{ isDefault: "desc" as const }, { createdAt: "asc" as const }],
};
const include = {
  addresses: addressesInclude,
  // the invoice tax gate asks a partner mirror for a tax number (card aaf4f09d); the roles are derived from the flags
  partner: {
    select: { id: true, isSupplier: true, isService: true, deletedAt: true },
  },
} satisfies Prisma.CustomerInclude;

type CustomerWithAddresses = Prisma.CustomerGetPayload<{
  include: typeof include;
}>;

function toAddress(
  row: CustomerWithAddresses["addresses"][number],
): CustomerAddress {
  return {
    id: row.id,
    type: row.type,
    name: row.name ?? undefined,
    country: row.country,
    postalCode: row.postalCode,
    city: row.city,
    line1: row.line1,
    line2: row.line2 ?? undefined,
    isDefault: row.isDefault,
  };
}

function formatAddress(
  addresses: CustomerWithAddresses["addresses"],
): string | null {
  const primary =
    addresses.find((address) => address.isDefault) ??
    addresses.find((address) => address.type === "BILLING") ??
    addresses[0];
  if (!primary) return null;
  // hiányos cím (az akváriumhoz felvitt ügyfélnél csak a név kötelező): a
  // hiányzó rész nem hagy üres helyet vagy árva vesszőt
  return [`${primary.postalCode} ${primary.city}`.trim(), primary.line1.trim()]
    .filter(Boolean)
    .join(", ");
}

@Injectable()
export class CustomersRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async list(query: CustomerListQueryDto): Promise<CustomerListResponse> {
    // Source (UNAS/MANUAL) has no persisted column on Customer - it's derived
    // from ExternalReference existence (see ADR-0009) - so a source filter
    // resolves the matching id set first, then narrows the where-clause with
    // it. This keeps pagination/totalItems correct, unlike filtering the
    // already-paged result in memory.
    const unasCustomerIds = query.source
      ? await this.loadUnasCustomerIds()
      : null;
    const searchCustomerIds = query.search?.trim()
      ? await this.searchCustomerIds(query.search)
      : null;
    // Two id sets can apply at once (origin and search), so each is its own
    // AND term: a spread `id` key would let the second silently replace the
    // first.
    const idFilters: Prisma.CustomerWhereInput[] = [
      ...(query.source === "UNAS" ? [{ id: { in: unasCustomerIds! } }] : []),
      ...(query.source === "MANUAL"
        ? [{ id: { notIn: unasCustomerIds! } }]
        : []),
      ...(searchCustomerIds ? [{ id: { in: searchCustomerIds } }] : []),
    ];
    const where: Prisma.CustomerWhereInput = {
      /**
       * A service partner carries its worksheets on a customer row of its own
       * (see `Supplier.customerId`). That row is a detail of the partner, not
       * somebody who bought something, so it has no place on a list of buyers
       * -- and a colleague who found it there would reasonably think we had
       * created a duplicate.
       *
       * Expressed as a relation filter rather than an id set, unlike the UNAS
       * origin below: this one IS a real relation, so the database does the
       * work and nothing has to be loaded into memory first.
       *
       * THE BILLING PICKER ASKS FOR THEM (card aaf4f09d; Balázs, 2026-11-04 14:23
       * UTC: the zoo's old UNAS row could not take the tax number): on an invoice the
       * mirror IS the right buyer, it carries the partner's tax number, term and
       * billing e-mail. The summary marks it, so the picker can tell the two apart.
       */
      ...partnerFilter(query.role, query.includePartnerMirrors === "true"),
      ...(query.status === "ALL"
        ? {}
        : { isActive: query.status === "ACTIVE" }),
      ...(idFilters.length > 0 ? { AND: idFilters } : {}),
    };
    const [customers, totalItems] = await Promise.all([
      prisma.customer.findMany({
        where,
        include,
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.customer.count({ where }),
    ]);
    const referencesByCustomerId = await this.loadExternalReferences(
      customers.map((customer) => customer.id),
    );
    const items = customers.map((customer) =>
      this.toSummary(customer, referencesByCustomerId.get(customer.id) ?? null),
    );
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  /**
   * THE SEARCH IGNORES ACCENTS AND CASE (Balázs on stage, 2026-09-30: "a
   * partnerekbol nem talal senkit"). Measured there: "Főv" found the partner,
   * "Fov" did not; "Állat" found three, "allat" none. People type without
   * accents, so a search that folds only the case finds nobody for them.
   *
   * Prisma's `contains` + `mode: "insensitive"` becomes ILIKE, which folds case
   * but not accents. The `unaccent` extension is installed by migration
   * 20260828124000 (for the product search); applied to BOTH sides here, so
   * "fov" finds "Fővárosi" and "Fov" finds "fővárosi". It cannot live in a
   * generated column (`unaccent` is not immutable), so the matching ids are
   * resolved first and narrow the list query, the same shape as the UNAS
   * origin filter above.
   */
  private async searchCustomerIds(search: string): Promise<string[]> {
    const pattern = customerSearchPattern(search);
    const taxKey = taxNumberSearchKey(search);
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Customer"
      WHERE unaccent("displayName") ILIKE unaccent(${pattern}::text)
         OR unaccent(COALESCE("companyName", '')) ILIKE unaccent(${pattern}::text)
         OR unaccent(COALESCE("email", '')) ILIKE unaccent(${pattern}::text)
         OR unaccent("customerNumber") ILIKE unaccent(${pattern}::text)
         ${
           taxKey
             ? Prisma.sql`OR upper(regexp_replace(COALESCE("taxNumber", ''), '[^0-9A-Za-z]', '', 'g')) LIKE ${`%${taxKey}%`}::text`
             : Prisma.empty
         }
    `;
    return rows.map((row) => row.id);
  }

  private async loadUnasCustomerIds(): Promise<string[]> {
    const references = await prisma.externalReference.findMany({
      where: { system: "UNAS", entityType: EXTERNAL_ENTITY_TYPE },
      select: { entityId: true },
    });
    return references.map((reference) => reference.entityId);
  }

  async detail(id: string): Promise<CustomerDetail | null> {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include,
    });
    if (!customer) return null;
    const reference = await prisma.externalReference.findUnique({
      where: {
        system_entityType_entityId: {
          system: "UNAS",
          entityType: EXTERNAL_ENTITY_TYPE,
          entityId: id,
        },
      },
    });
    const detail = {
      ...this.toDetail(customer, reference?.externalId ?? null),
      // the invoice tax gate's reason names where to copy a missing tax number from
      partnerTaxHint:
        customer.taxNumber?.trim() || customer.euTaxNumber?.trim()
          ? null
          : partnerTaxNumberFor(
              customer,
              await prisma.supplier.findMany({
                // a deleted partner is no source (barracuda, #2161)
                where: { taxNumber: { not: null }, deletedAt: null },
                select: { name: true, taxNumber: true },
              }),
            ),
    };
    if (detail.paymentDueDays !== null) return detail;
    // a sor maga üres: ugyanez a cég a Partnerek oldalon viselhet napot
    const partners = await prisma.supplier.findMany({
      where: { paymentDueDays: { not: null }, deletedAt: null },
      select: { name: true, taxNumber: true, paymentDueDays: true },
    });
    return {
      ...detail,
      partnerTerms: partnerTermsFor(
        {
          displayName: customer.displayName,
          companyName: customer.companyName,
          taxNumber: customer.taxNumber,
        },
        partners.map((partner) => ({
          name: partner.name,
          taxNumber: partner.taxNumber,
          paymentDueDays: partner.paymentDueDays!,
        })),
      ),
    };
  }

  /**
   * A VEVOSZAM UTKOZESE UJRAPROBALKOZAST KAP, NEM HIBAUZENETET.
   *
   * Ket vevo akkor kap azonos szamot, ha ugyanabban a masodpercben keszul es a
   * generator ugyanazt a negyjegyu veget huzza. Ritka, de a kimenetel eddig
   * HIBA volt, amit a felhasznalonak kellett ujraprobalnia -- holott a kovetkezo
   * huzas mas kodot ad.
   *
   * A burkolat CSAK a tranzakciot ismetli meg, uj kodddal. Az ismetles nem
   * mehet a tranzakcion BELUL: Postgres az elso elbukott utasitas utan
   * megszakitja, tehat ott mar nincs mit menteni.
   */
  create(input: CreateCustomerDto, actorId: string): Promise<CustomerDetail> {
    return withUniqueCode(
      { prefix: "VEVO", field: "customerNumber" },
      (customerNumber) =>
        prisma.$transaction(
          async (tx) => {
            const customer = await tx.customer.create({
              data: {
                customerNumber,
                type: input.type,
                displayName: input.displayName.trim(),
                companyName: input.companyName?.trim(),
                taxNumber: input.taxNumber?.trim(),
                // normalized by the service (`euTax`)
                euTaxNumber: input.euTaxNumber,
                email: input.email?.trim(),
                billingEmail: input.billingEmail?.trim(),
                phone: input.phone?.trim(),
                marketingEmailConsent: input.marketingEmailConsent ?? false,
                marketingSmsConsent: input.marketingSmsConsent ?? false,
                addresses: {
                  create: input.addresses.map((address) => ({
                    type: address.type,
                    name: address.name?.trim(),
                    country: address.country ?? "HU",
                    postalCode: address.postalCode.trim(),
                    city: address.city.trim(),
                    line1: address.line1.trim(),
                    line2: address.line2?.trim(),
                    isDefault: address.isDefault ?? false,
                  })),
                },
              },
              include,
            });
            await this.event(tx, "customer.created", customer.id, actorId, {
              customerNumber: customer.customerNumber,
              customerType: customer.type,
            });
            return this.toDetail(customer, null);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
    );
  }

  update(
    id: string,
    input: UpdateCustomerDto,
    actorId: string,
  ): Promise<CustomerDetail> {
    return prisma.$transaction(
      async (tx) => {
        const existing = await tx.customer.findUniqueOrThrow({ where: { id } });
        const changed = await tx.customer.updateMany({
          where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
          data: {
            // an edit of the addresses alone must still move `updatedAt`: it is the concurrency token
            updatedAt: new Date(),
            type: input.type,
            displayName: input.displayName?.trim(),
            companyName: input.companyName,
            taxNumber: input.taxNumber,
            euTaxNumber: input.euTaxNumber,
            email: input.email,
            billingEmail: input.billingEmail,
            phone: input.phone,
            marketingEmailConsent: input.marketingEmailConsent,
            marketingSmsConsent: input.marketingSmsConsent,
          },
        });
        if (changed.count !== 1) throw new Error("STALE_UPDATE");
        for (const address of input.addresses ?? []) {
          const data = {
            type: address.type,
            name: address.name?.trim() || null,
            country: address.country?.trim().toUpperCase() || "HU",
            postalCode: address.postalCode.trim(),
            city: address.city.trim(),
            line1: address.line1.trim(),
            line2: address.line2?.trim() || null,
          };
          if (address.id) {
            // only the customer's OWN address: another customer's id matches nothing
            const updated = await tx.customerAddress.updateMany({
              where: { id: address.id, customerId: id },
              data,
            });
            if (updated.count !== 1) throw new Error("ADDRESS_NOT_OWNED");
          } else {
            const hasAny = await tx.customerAddress.count({
              where: { customerId: id },
            });
            await tx.customerAddress.create({
              data: { ...data, customerId: id, isDefault: hasAny === 0 },
            });
          }
        }
        await this.event(tx, "customer.updated", id, actorId, {
          previousDisplayName: existing.displayName,
          displayName: input.displayName ?? existing.displayName,
          // the names of the fields that were sent, never their values (a tax number, an address)
          changedFields: Object.entries(input)
            .filter(
              ([key, value]) =>
                key !== "expectedUpdatedAt" && value !== undefined,
            )
            .map(([key]) => key),
        });
        const customer = await tx.customer.findUniqueOrThrow({
          where: { id },
          include,
        });
        const reference = await tx.externalReference.findUnique({
          where: {
            system_entityType_entityId: {
              system: "UNAS",
              entityType: EXTERNAL_ENTITY_TYPE,
              entityId: id,
            },
          },
        });
        return this.toDetail(customer, reference?.externalId ?? null);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async loadExternalReferences(
    customerIds: string[],
  ): Promise<Map<string, string>> {
    if (customerIds.length === 0) return new Map();
    const references = await prisma.externalReference.findMany({
      where: {
        system: "UNAS",
        entityType: EXTERNAL_ENTITY_TYPE,
        entityId: { in: customerIds },
      },
    });
    return new Map(
      references.map((reference) => [reference.entityId, reference.externalId]),
    );
  }

  private toSummary(
    customer: CustomerWithAddresses,
    unasExternalId: string | null,
  ): CustomerSummary {
    return {
      id: customer.id,
      customerNumber: customer.customerNumber,
      partnerCode: unasExternalId ?? customer.customerNumber,
      source: unasExternalId ? "UNAS" : "MANUAL",
      type: customer.type,
      displayName: customer.displayName,
      companyName: customer.companyName ?? undefined,
      email: customer.email ?? undefined,
      billingEmail: customer.billingEmail ?? undefined,
      phone: customer.phone ?? undefined,
      isActive: customer.isActive,
      archivedAt: customer.archivedAt?.toISOString(),
      address: formatAddress(customer.addresses),
      taxNumber: customer.taxNumber ?? undefined,
      partnerMirror: isPartnerMirror(customer.partner),
      ...partnerRolesOf(customer.partner),
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    };
  }

  private toDetail(
    customer: CustomerWithAddresses,
    unasExternalId: string | null,
  ): CustomerDetail {
    return {
      ...this.toSummary(customer, unasExternalId),
      taxNumber: customer.taxNumber ?? undefined,
      euTaxNumber: customer.euTaxNumber ?? undefined,
      paymentDueDays: customer.paymentDueDays ?? null,
      partnerMirror: isPartnerMirror(customer.partner),
      marketingEmailConsent: customer.marketingEmailConsent,
      marketingSmsConsent: customer.marketingSmsConsent,
      addresses: customer.addresses.map(toAddress),
    };
  }

  private event(
    tx: Prisma.TransactionClient,
    eventType: string,
    aggregateId: string,
    actorUserId: string,
    payload: Prisma.JsonObject,
  ) {
    return tx.domainEvent.create({
      data: {
        id: randomUUID(),
        eventType,
        aggregateType: "Customer",
        aggregateId,
        actorUserId,
        payload,
        occurredAt: new Date(),
        schemaVersion: 1,
      },
    });
  }
}
