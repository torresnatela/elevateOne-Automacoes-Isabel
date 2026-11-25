-- CreateTable
CREATE TABLE "microsoft_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "folder_drive_id" TEXT,
    "folder_item_id" TEXT,
    "folder_name" TEXT,
    "folder_web_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "microsoft_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "microsoft_accounts_user_id_key" ON "microsoft_accounts"("user_id");

-- AddForeignKey
ALTER TABLE "microsoft_accounts" ADD CONSTRAINT "microsoft_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
