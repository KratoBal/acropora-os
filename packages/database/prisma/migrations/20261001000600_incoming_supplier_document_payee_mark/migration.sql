-- A szövegréteg nélküli számla vevőjének kézi jelölése (acrobot 25633).
ALTER TABLE "IncomingSupplierDocument" ADD COLUMN "payeeMarkedAt" TIMESTAMP(3);
ALTER TABLE "IncomingSupplierDocument" ADD COLUMN "payeeMarkedByUserId" TEXT;
