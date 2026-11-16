-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX "leads_customerId_idx" ON "leads"("customerId");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX "products_modelFileKey_idx" ON "products"("modelFileKey");

-- CreateIndex
CREATE INDEX "quotation_lines_productId_idx" ON "quotation_lines"("productId");

-- CreateIndex
CREATE INDEX "stock_movements_printJobId_idx" ON "stock_movements"("printJobId");

-- CreateIndex
CREATE INDEX "stock_movements_pieceId_idx" ON "stock_movements"("pieceId");

-- CreateIndex
CREATE INDEX "stock_movements_productId_idx" ON "stock_movements"("productId");

-- CreateIndex
CREATE INDEX "uploads_uploadedById_createdAt_idx" ON "uploads"("uploadedById", "createdAt");
