-- THE REEFCLUB CODE REDEMPTION, AS ONE FUNCTION (barracuda #1748, acrobot 33848).
--
-- The ReefClub role redeemed a code by reading the code table and writing the claim and the link
-- itself. Row-level security bounded those writes, but a mistake or an injection in the ReefClub
-- process could still read any open code's hash and claim it, and so link the account to a
-- customer and read that customer's shop aquariums. With this function the role neither reads nor
-- writes the code table and does not insert links: it hands over the hash and the account, and the
-- function (running with its owner's rights) does the rest. Without a code's hash nothing can be
-- claimed, and the role can no longer read one.
--
-- The rules are the ones the process applied: an unused, unexpired code of an active person
-- customer is claimed once; an active link of the same account and customer is answered with that
-- link (the code is spent either way); otherwise a new active link is written. Two redemptions at
-- the same moment meet on the partial unique index (ReefClubCustomerLink_active_key), and the
-- second gets the first one's link. No row: the code is unknown, used, expired or not a person's.
--
-- The times are timestamps without time zone in UTC, as Prisma writes them: now() is converted
-- explicitly (the session's time zone would be hours off). The link's id is a uuid; nothing reads
-- its shape.
--
-- Additive: back is DROP FUNCTION "reefclub_redeem_link_code"(text, text).

CREATE OR REPLACE FUNCTION "reefclub_redeem_link_code"(p_code_hash text, p_account_id text)
RETURNS TABLE ("linkId" text, "createdAt" timestamp(3), "customerName" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamp(3) := (now() AT TIME ZONE 'UTC');
  v_code_id text;
  v_customer_id text;
BEGIN
  UPDATE "ReefClubLinkCode" AS c
     SET "usedAt" = v_now, "usedByAccountId" = p_account_id
   WHERE c."codeHash" = p_code_hash
     AND c."usedAt" IS NULL
     AND c."expiresAt" > v_now
     AND EXISTS (
       SELECT 1 FROM "Customer" AS cu
        WHERE cu."id" = c."customerId" AND cu."type" = 'PERSON' AND cu."isActive"
     )
  RETURNING c."id", c."customerId" INTO v_code_id, v_customer_id;
  IF v_code_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO "ReefClubCustomerLink" ("id", "accountId", "customerId", "status", "codeId", "createdAt")
  VALUES (gen_random_uuid()::text, p_account_id, v_customer_id, 'ACTIVE', v_code_id, v_now)
  ON CONFLICT ("accountId", "customerId") WHERE "status" = 'ACTIVE' DO NOTHING;

  RETURN QUERY
    SELECT l."id", l."createdAt", cu."displayName"
      FROM "ReefClubCustomerLink" AS l
      JOIN "Customer" AS cu ON cu."id" = l."customerId"
     WHERE l."accountId" = p_account_id
       AND l."customerId" = v_customer_id
       AND l."status" = 'ACTIVE';
END;
$$;

-- Only the roles granted below (packages/database/sql/reefclub-role.sql) and the owner run it.
REVOKE ALL ON FUNCTION "reefclub_redeem_link_code"(text, text) FROM PUBLIC;
