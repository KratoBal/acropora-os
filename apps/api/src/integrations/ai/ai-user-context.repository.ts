import { Injectable } from "@nestjs/common";
import { Repository, prisma } from "@acropora/database";

/**
 * The identity of one customer, and deliberately nothing else.
 *
 * The select list is the privacy boundary of this feature. `Customer` carries
 * name, e-mail, phone, tax number and addresses; none of them is read here,
 * so none of them can be returned by accident. Reusing the customers module's
 * `detail()` would have loaded all of it, because that method exists to serve
 * a screen where the operator is looking at the person on purpose.
 */
export interface CustomerIdentity {
  id: string;
  customerNumber: string;
}

@Injectable()
export class AiUserContextRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /** `null` when no customer carries this id. */
  async findCustomerIdentity(id: string): Promise<CustomerIdentity | null> {
    return this.database.customer.findUnique({
      where: { id },
      select: { id: true, customerNumber: true },
    });
  }
}
