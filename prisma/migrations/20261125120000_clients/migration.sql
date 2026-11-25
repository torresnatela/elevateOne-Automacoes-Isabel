-- CreateEnum
CREATE TYPE "ClientEntityType" AS ENUM ('SOCIEDADE', 'ENI', 'PARTICULAR', 'ASSOCIACAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "VatRegime" AS ENUM ('NORMAL_MENSAL', 'NORMAL_TRIMESTRAL', 'ISENTO_ART53', 'PEQUENOS_RETALHISTAS', 'NAO_SUJEITO');

-- CreateEnum
CREATE TYPE "AccountingRegime" AS ENUM ('ORGANIZADA', 'SIMPLIFICADO', 'NAO_ORGANIZADA');

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trade_name" TEXT,
    "nif" TEXT,
    "contact_emails" TEXT[],
    "email_domains" TEXT[],
    "entity_type" "ClientEntityType" NOT NULL DEFAULT 'SOCIEDADE',
    "vat_regime" "VatRegime",
    "accounting_regime" "AccountingRegime",
    "cae_principal" TEXT,
    "niss" TEXT,
    "address" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'PT',
    "responsible_user_id" UUID,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_nif_key" ON "clients"("nif");

-- CreateIndex
CREATE INDEX "clients_contact_emails_idx" ON "clients" USING GIN ("contact_emails");

-- CreateIndex
CREATE INDEX "clients_email_domains_idx" ON "clients" USING GIN ("email_domains");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
