-- CreateIndex
CREATE INDEX "contents_companyId_status_createdAt_idx" ON "contents"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "playlists_companyId_updatedAt_idx" ON "playlists"("companyId", "updatedAt");

-- CreateIndex
CREATE INDEX "screens_companyId_createdAt_idx" ON "screens"("companyId", "createdAt");
