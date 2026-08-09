ALTER TABLE "SalesOrder"
ADD COLUMN "discountPercent" DECIMAL(5,2);

ALTER TABLE "SalesOrderLine"
ADD COLUMN "discountPercent" DECIMAL(5,2);

ALTER TABLE "SalesOrder"
ADD CONSTRAINT "SalesOrder_discountPercent_check"
CHECK ("discountPercent" IS NULL OR "discountPercent" BETWEEN 0 AND 100);

ALTER TABLE "SalesOrderLine"
ADD CONSTRAINT "SalesOrderLine_discountPercent_check"
CHECK ("discountPercent" IS NULL OR "discountPercent" BETWEEN 0 AND 100);
