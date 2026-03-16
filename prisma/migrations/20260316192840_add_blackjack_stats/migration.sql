-- CreateTable
CREATE TABLE "BlackjackStats" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "pushes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlackjackStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlackjackStats_userId_key" ON "BlackjackStats"("userId");

-- CreateIndex
CREATE INDEX "BlackjackStats_userId_idx" ON "BlackjackStats"("userId");
