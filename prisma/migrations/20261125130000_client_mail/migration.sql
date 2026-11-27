-- CreateEnum
CREATE TYPE "InvoiceDocType" AS ENUM ('FT', 'FS', 'FR', 'NC', 'ND', 'RC', 'OUTRO');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('EXTRAIDA', 'A_REVER', 'CONFIRMADA', 'REJEITADA');

-- CreateEnum
CREATE TYPE "InvoiceDirection" AS ENUM ('COMPRA', 'VENDA', 'DESCONHECIDA');

-- CreateTable
CREATE TABLE "client_emails" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "google_account_id" UUID,
    "mailbox" TEXT NOT NULL,
    "gmail_message_id" TEXT NOT NULL,
    "gmail_thread_id" TEXT,
    "rfc_message_id" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action_needed" BOOLEAN NOT NULL DEFAULT false,
    "attachment_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "email_id" UUID NOT NULL,
    "attachment_part_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "doc_type" "InvoiceDocType" NOT NULL DEFAULT 'OUTRO',
    "direction" "InvoiceDirection" NOT NULL DEFAULT 'DESCONHECIDA',
    "number" TEXT,
    "atcud" TEXT,
    "issue_date" DATE,
    "issuer_name" TEXT,
    "issuer_nif" TEXT,
    "buyer_name" TEXT,
    "buyer_nif" TEXT,
    "net_total" DECIMAL(14,2),
    "vat_total" DECIMAL(14,2),
    "total" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "vat_breakdown" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'A_REVER',
    "review_reasons" TEXT[],
    "raw" JSONB NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_sync_states" (
    "google_account_id" UUID NOT NULL,
    "synced_until" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_error" TEXT,

    CONSTRAINT "mail_sync_states_pkey" PRIMARY KEY ("google_account_id")
);

-- CreateTable
CREATE TABLE "mail_seen_messages" (
    "google_account_id" UUID NOT NULL,
    "gmail_message_id" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_seen_messages_pkey" PRIMARY KEY ("google_account_id","gmail_message_id")
);

-- CreateTable
CREATE TABLE "job_locks" (
    "name" TEXT NOT NULL,
    "locked_until" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_locks_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_emails_rfc_message_id_key" ON "client_emails"("rfc_message_id");

-- CreateIndex
CREATE INDEX "client_emails_client_id_received_at_idx" ON "client_emails"("client_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_emails_google_account_id_gmail_message_id_key" ON "client_emails"("google_account_id", "gmail_message_id");

-- CreateIndex
CREATE INDEX "invoices_client_id_issue_date_idx" ON "invoices"("client_id", "issue_date");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_email_id_attachment_part_id_key" ON "invoices"("email_id", "attachment_part_id");

-- AddForeignKey
ALTER TABLE "client_emails" ADD CONSTRAINT "client_emails_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_emails" ADD CONSTRAINT "client_emails_google_account_id_fkey" FOREIGN KEY ("google_account_id") REFERENCES "google_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "client_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_sync_states" ADD CONSTRAINT "mail_sync_states_google_account_id_fkey" FOREIGN KEY ("google_account_id") REFERENCES "google_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_seen_messages" ADD CONSTRAINT "mail_seen_messages_google_account_id_fkey" FOREIGN KEY ("google_account_id") REFERENCES "google_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

