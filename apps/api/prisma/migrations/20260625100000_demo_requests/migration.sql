-- CreateEnum
CREATE TYPE "DemoRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'SCHEDULED', 'CLOSED');

-- CreateTable
CREATE TABLE "demo_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "screens" INTEGER,
    "message" TEXT,
    "locale" TEXT,
    "status" "DemoRequestStatus" NOT NULL DEFAULT 'NEW',
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "demo_requests_status_idx" ON "demo_requests"("status");

-- CreateIndex
CREATE INDEX "demo_requests_createdAt_idx" ON "demo_requests"("createdAt");

-- CreateIndex
CREATE INDEX "demo_requests_email_idx" ON "demo_requests"("email");
