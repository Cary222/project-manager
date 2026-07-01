-- Manual migration: add UploadedFile table for image binary storage
-- Run with: psql "$DATABASE_URL" -f prisma/migrations/manual_add_uploaded_file/migration.sql
-- Prerequisites: Ensure connected to the database and schema "pm" exists.

BEGIN;

CREATE TABLE IF NOT EXISTS pm."UploadedFile" (
    id            TEXT        NOT NULL DEFAULT cuid(),
    "uploaderId"  TEXT        NOT NULL,
    "originalName" TEXT       NOT NULL,
    "mimeType"    TEXT        NOT NULL,
    size          INTEGER     NOT NULL,
    bytes         BYTEA       NOT NULL,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY (id),
    CONSTRAINT "UploadedFile_uploaderId_fkey"
        FOREIGN KEY ("uploaderId") REFERENCES pm."User"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "UploadedFile_uploaderId_createdAt_idx"
    ON pm."UploadedFile" ("uploaderId", "createdAt" DESC);

COMMIT;