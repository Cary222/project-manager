CREATE TABLE "pm"."PiSessionOwnership" (
  "id" TEXT NOT NULL,
  "piSessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "ticketId" TEXT,
  "source" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PiSessionOwnership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PiSessionOwnership_piSessionId_key" ON "pm"."PiSessionOwnership"("piSessionId");
CREATE INDEX "PiSessionOwnership_userId_updatedAt_idx" ON "pm"."PiSessionOwnership"("userId", "updatedAt" DESC);
CREATE INDEX "PiSessionOwnership_projectId_idx" ON "pm"."PiSessionOwnership"("projectId");
CREATE INDEX "PiSessionOwnership_ticketId_idx" ON "pm"."PiSessionOwnership"("ticketId");

ALTER TABLE "pm"."PiSessionOwnership"
  ADD CONSTRAINT "PiSessionOwnership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "pm"."User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
