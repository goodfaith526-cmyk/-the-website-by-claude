window.SEO_SERVICES = window.SEO_SERVICES || {};

window.SEO_SERVICES.excelImport = {
  ruleId: "cbos-2025-excel-rowtyped-v1",
  parserVersion: "excel-rowtyped-v1",
  importableSheets: [
    "annual_exports_summary",
    "annual_imports_summary",
    "monthly_exports",
    "monthly_imports",
    "quarterly_exports",
    "quarterly_imports",
  ],
  deferredSheets: [
    "exports_by_country_monthly",
    "imports_by_country_monthly",
    "exports_country_commodity",
    "imports_country_commodity",
  ],

  async readWorkbook(file) {
    if (!window.XLSX) throw new Error("XLSX library is not loaded. Check the SheetJS script connection.");
    const buffer = await file.arrayBuffer();
    return window.XLSX.read(buffer, { type: "array" });
  },

  sheetRows(workbook, sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    return window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false })
      .map((row) => this.normalizeRowKeys(row));
  },

  normalizeRowKeys(row) {
    return Object.entries(row || {}).reduce((acc, [key, value]) => {
      const cleanKey = this.canonicalFieldName(key);
      acc[cleanKey] = value;
      return acc;
    }, {});
  },

  canonicalFieldName(key) {
    return String(key || "")
      .replace(/^\uFEFF/, "")
      .replace(/\u00a0/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  },

  getField(row, fieldName) {
    if (!row) return "";
    const target = this.canonicalFieldName(fieldName);
    if (Object.prototype.hasOwnProperty.call(row, target)) return row[target];
    const found = Object.keys(row).find((key) => this.canonicalFieldName(key) === target);
    return found ? row[found] : "";
  },

  parseNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const cleaned = String(value).replace(/,/g, "").trim();
    if (!cleaned || cleaned === "-") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  },

  safeSlug(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "unknown";
  },

  normalizeRowType(row) {
    return String(this.getField(row, "row_type") || "").trim().toLowerCase();
  },

  shouldImportRow(row) {
    const value = String(this.getField(row, "include_in_observations") || "").trim().toLowerCase();
    return value === "1" || value === "1.0" || value === "true" || value === "yes";
  },

  makeSourceFile(file, metadata) {
    const now = new Date().toISOString();
    const year = metadata.covered_year || metadata.publication_year || "unknown";
    return {
      id: window.SEO_SERVICES.trade.makeId("source", [year, file.name, Date.now()]),
      originalFilename: file.name,
      mimeType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: file.size || 0,
      sourceOrg: metadata.institution || "Central Bank of Sudan",
      publicationTitle: metadata.source_title || "Foreign Trade Statistical Digest",
      publicationYear: Number(metadata.publication_year || year) || null,
      coveredYear: Number(year) || null,
      origin: "excel-rowtyped-upload",
      uploadedAt: now,
      checksum: null,
      notes: "Imported from validated row-typed Excel workbook; draft-only.",
    };
  },

  makeBatch(sourceFile, metadata, summary) {
    const now = new Date().toISOString();
    return {
      id: window.SEO_SERVICES.trade.makeId("batch", [metadata.covered_year || sourceFile.coveredYear || "unknown", "excel", Date.now()]),
      sourceFileId: sourceFile.id,
      targetYear: String(metadata.covered_year || sourceFile.coveredYear || ""),
      status: "draft",
      parserVersion: this.parserVersion,
      ruleFamilyId: "cbos-validated-excel-rowtyped",
      extractionRuleId: this.ruleId,
      importedAt: now,
      reviewedAt: null,
      approvedAt: null,
      notes: "Excel upload converted to draft observations only. No automatic approval or publishing.",
      parseSummary: summary,
    };
  },

  createObservation(row, context) {
    const flow = String(this.getField(row, "flow") || context.flow || "").trim().toLowerCase();
    const year = Number(this.getField(row, "year") || context.year || 0) || null;
    const periodType = String(this.getField(row, "period_type") || context.periodType || "annual").trim().toLowerCase();
    const valueUsdThousand = this.parseNumber(this.getField(row, "value_usd_thousand"));
    const quantity = this.parseNumber(this.getField(row, "quantity"));
    const commodityRaw = this.getField(row, "commodity_raw_en") || this.getField(row, "commodity_group_raw_en") || "";
    const commodityAr = this.getField(row, "commodity_raw_ar") || this.getField(row, "commodity_group_raw_ar") || "";
    const countryRaw = this.getField(row, "country_raw_en") || "";
    const countryAr = this.getField(row, "country_raw_ar") || "";
    const suppliedCommodityId = String(this.getField(row, "commodity_id") || "").trim();
    const normalizedCommodity = commodityRaw ? window.SEO_SERVICES.commodity?.normalizeCommodityName(commodityRaw) : null;
    const commodityId = suppliedCommodityId || normalizedCommodity?.commodityId || (commodityRaw ? `excel-${this.safeSlug(commodityRaw)}` : null);
    const commodityName = normalizedCommodity?.commodityName || commodityRaw || commodityAr || null;
    const countryName = countryRaw || countryAr || null;
    const sourceRowLabel = this.getField(row, "source_row_label") || commodityRaw || countryRaw || "";
    return {
      id: window.SEO_SERVICES.trade.makeId("draftobs", [context.batchId, context.sheetName, row.__rowIndex || context.index]),
      reporterCountry: "SDN",
      partnerCountryId: countryName ? `country-${this.safeSlug(countryName)}` : null,
      flow,
      commodityId,
      commodityName,
      commodityCanonicalEnglishName: normalizedCommodity?.commodityCanonicalEnglishName || null,
      commodityCanonicalArabicName: normalizedCommodity?.commodityCanonicalArabicName || null,
      commodityNormalizationStatus: normalizedCommodity?.status || (commodityRaw ? "excel_fallback" : null),
      countryName,
      countryRawArabicName: countryAr || null,
      region: null,
      year,
      month: periodType === "monthly" ? Number(this.getField(row, "month_number") || 0) || null : null,
      monthLabel: periodType === "monthly" ? this.getField(row, "month_name") || null : null,
      quarter: periodType === "quarterly" ? Number(this.getField(row, "quarter") || 0) || null : null,
      periodType,
      valueUsd: valueUsdThousand === null ? null : valueUsdThousand * 1000,
      valueUsdThousand,
      quantity,
      unit: this.getField(row, "unit") || null,
      sourceFileId: context.sourceFileId,
      importBatchId: context.batchId,
      sourcePageNumber: Number(this.getField(row, "source_page") || 0) || null,
      sourceTableLabel: this.getField(row, "source_table") || context.sheetName,
      sourceDataset: context.sheetName,
      sourceRowLabel,
      rawCommodityName: commodityRaw || null,
      rawCommodityArabicName: commodityAr || null,
      rawCountryName: countryRaw || null,
      rowType: this.normalizeRowType(row) || "detail",
      includeInObservations: true,
      validationStatus: this.getField(row, "validation_status") || null,
      notes: this.getField(row, "notes") || "",
      extractionRuleId: this.ruleId,
      extractionVersion: this.parserVersion,
      publicationIssue: metadataIssue(context.metadata),
      coveredEconomicPeriod: this.coveredPeriod(row),
      extractionConfidence: 1,
      reviewStatus: "draft",
      isPublished: false,
    };
  },

  coveredPeriod(row) {
    const year = this.getField(row, "year") || "";
    const periodType = String(this.getField(row, "period_type") || "").toLowerCase();
    if (periodType === "monthly") return `${this.getField(row, "month_name") || this.getField(row, "month_number") || ""} ${year}`.trim();
    if (periodType === "quarterly") return `Q${this.getField(row, "quarter") || ""} ${year}`.trim();
    return `Annual ${year}`.trim();
  },

  buildValidation(workbook, batchId, sourceFileId, metadata, sheetSummaries, observations) {
    const validationRows = this.sheetRows(workbook, "validation_report");
    const reviewRows = this.sheetRows(workbook, "review_required");
    const failed = validationRows.filter((row) => String(row.status || "").toLowerCase() !== "pass");
    return {
      id: window.SEO_SERVICES.trade.makeId("validation", [batchId, this.ruleId]),
      importBatchId: batchId,
      sourceFileId,
      extractionRuleId: this.ruleId,
      extractionVersion: this.parserVersion,
      year: Number(metadata.covered_year || metadata.publication_year || 0) || null,
      status: failed.length ? "warning" : "pass",
      checkedAt: new Date().toISOString(),
      observationsCount: observations.length,
      validationChecksCount: validationRows.length,
      validationChecksFailedCount: failed.length,
      reviewRequiredRowsCount: reviewRows.length,
      sheetSummaries,
      validationReport: validationRows.slice(0, 40),
      notes: failed.length
        ? "Workbook imported as draft with non-pass validation rows. Review before approval."
        : "Workbook validation_report rows are pass. Draft still requires human review before approval.",
    };
  },

  buildApprovalReadiness(normalized, validation, observations) {
    const shaped = window.SEO_SERVICES.trade.ensureNormalizedShape(normalized || {});
    const year = Number(validation.year || observations[0]?.year || 0) || null;
    const ruleId = validation.extractionRuleId || this.ruleId;
    const activeRows = (shaped.observations || []).filter((row) =>
      row.isPublished &&
      String(row.year) === String(year) &&
      row.extractionRuleId === ruleId
    );
    const duplicateKeys = this.findDuplicateObservationKeys(observations);
    const periodLayers = [...new Set(observations.map((row) => row.periodType).filter(Boolean))].sort();
    const blockingReasons = [];
    const warningReasons = [];
    if (validation.status !== "pass") blockingReasons.push("validation status is not pass");
    if (!observations.length) blockingReasons.push("no draft observations were created");
    if (validation.validationChecksFailedCount) blockingReasons.push(`${validation.validationChecksFailedCount} validation checks failed`);
    if (activeRows.length) blockingReasons.push(`active published observations already exist for ${year}/${ruleId}`);
    if (duplicateKeys.length) blockingReasons.push(`${duplicateKeys.length} duplicate observation keys detected`);
    if (!periodLayers.length) blockingReasons.push("no period layers found in draft observations");
    if (validation.reviewRequiredRowsCount) warningReasons.push(`${validation.reviewRequiredRowsCount} workbook rows are marked review_required; these are warnings until classified as blockers`);
    return {
      isReady: blockingReasons.length === 0,
      checkedAt: new Date().toISOString(),
      year,
      ruleId,
      rowCount: observations.length,
      activeRowsCount: activeRows.length,
      periodLayers,
      blockingReasons,
      warningReasons,
      validationStatus: validation.status,
      validationChecksCount: validation.validationChecksCount,
      validationChecksFailedCount: validation.validationChecksFailedCount,
      reviewRequiredRowsCount: validation.reviewRequiredRowsCount,
      duplicateKeysCount: duplicateKeys.length,
      duplicateKeyExamples: duplicateKeys.slice(0, 10),
      draftIsolationStatus: activeRows.length ? "blocked_active_rows_exist" : "pass_no_active_rows_for_rule",
      approvalDesignStatus: "design_only_no_approval_button_no_publishing",
    };
  },

  findDuplicateObservationKeys(observations) {
    const counts = new Map();
    observations.forEach((row) => {
      const key = [
        row.year,
        row.flow,
        row.periodType,
        row.month || "",
        row.quarter || "",
        row.commodityId || "",
        row.countryName || "",
        row.sourceDataset || "",
      ].join("|");
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));
  },

  async importWorkbookDraft(file, normalized = null) {
    const workbook = await this.readWorkbook(file);
    const metadata = this.sheetRows(workbook, "metadata")[0] || {};
    const sourceFile = this.makeSourceFile(file, metadata);
    const sheetSummaries = [];
    const observations = [];
    const batchId = window.SEO_SERVICES.trade.makeId("batch", [metadata.covered_year || metadata.publication_year || "unknown", "excel", Date.now()]);

    this.importableSheets.forEach((sheetName) => {
      const rows = this.sheetRows(workbook, sheetName).map((row, index) => ({ ...row, __rowIndex: index + 2 }));
      const includeRows = rows.filter((row) => this.shouldImportRow(row));
      const excludedRows = rows.length - includeRows.length;
      includeRows.forEach((row, index) => {
        observations.push(this.createObservation(row, {
          batchId,
          sourceFileId: sourceFile.id,
          sheetName,
          index,
          metadata,
        }));
      });
      sheetSummaries.push({
        sheetName,
        totalRows: rows.length,
        includedRows: includeRows.length,
        excludedRows,
        rowTypes: this.rowTypeCounts(rows),
      });
    });

    const summary = {
      workbookSheets: workbook.SheetNames,
      importedSheets: this.importableSheets,
      deferredSheets: this.deferredSheets,
      draftObservations: observations.length,
      includedRows: observations.length,
      excludedRows: sheetSummaries.reduce((sum, row) => sum + row.excludedRows, 0),
      rowTyped: true,
      storagePolicy: "Core commodity sheets only in the first Excel trial; country sheets deferred to avoid localStorage quota pressure.",
    };
    const batch = this.makeBatch(sourceFile, metadata, summary);
    batch.id = batchId;
    const validation = this.buildValidation(workbook, batchId, sourceFile.id, metadata, sheetSummaries, observations);
    validation.excelApprovalReadiness = this.buildApprovalReadiness(normalized, validation, observations);
    return { sourceFile, batch, observations, validation, metadata, sheetSummaries };
  },

  rowTypeCounts(rows) {
    return rows.reduce((acc, row) => {
      const type = this.normalizeRowType(row) || "blank";
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
  },
};

function metadataIssue(metadata) {
  const issue = metadata?.issue ? `Q${metadata.issue}` : "";
  const year = metadata?.covered_year || metadata?.publication_year || "";
  return [issue, year].filter(Boolean).join(" ");
}
