import type { Prisma } from "@acropora/database";
import type { UserListSortField } from "@acropora/types";

import type { ListSortSpec } from "../common/list-sort.js";

/**
 * The user list's sort: the whitelist of `USER_LIST_SORT_FIELDS`, the last name, the first name and `id` as the default. In a chosen
 * sort `id` follows the direction as the tie breaker. The name column prints the nickname when there is one, but the sort follows the
 * display name (the nickname is not a stored, sortable field of its own): a user with a nickname is placed by the display name.
 */
export const USER_LIST_SORT: ListSortSpec<
  UserListSortField,
  Prisma.UserOrderByWithRelationInput
> = {
  fields: {
    displayName: (direction) => ({ displayName: direction }),
    email: (direction) => ({ email: direction }),
  },
  fallback: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
  tieBreaker: (direction) => ({ id: direction }),
};
