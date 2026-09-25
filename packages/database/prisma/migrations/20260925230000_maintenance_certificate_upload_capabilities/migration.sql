-- AZ ALAIRT MEGRENDELOLAP ES TELJESITESI IGAZOLAS FELTOLTESE, A PARTNER
-- PORTALON -- felhasznalonkenti jelolo (ServiceCapability), NEM
-- szerep-szintu jog. Lasd a schema.prisma ServiceCapability enum
-- MAINTENANCE_ORDER_UPLOAD_SIGNED es COMPLETION_CERTIFICATE_UPLOAD_SIGNED
-- ertekenek fejleceert a teljes indoklast (acrobot jovahagyasa, msg_id
-- 23868, 2026-09-25 22:17 UTC).
ALTER TYPE "ServiceCapability" ADD VALUE 'MAINTENANCE_ORDER_UPLOAD_SIGNED';
ALTER TYPE "ServiceCapability" ADD VALUE 'COMPLETION_CERTIFICATE_UPLOAD_SIGNED';
