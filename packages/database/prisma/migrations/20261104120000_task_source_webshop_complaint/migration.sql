-- V1.2: a customer's shipment-problem report from the webshop becomes a task. An enum value goes in its own migration.

-- AlterEnum
ALTER TYPE "TaskSource" ADD VALUE 'WEBSHOP_COMPLAINT';
