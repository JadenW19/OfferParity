import {
  BatchXRayItemInputSchema,
  FixtureScenarioIdSchema,
  MAX_BATCH_ITEMS,
  type BatchXRayItemInput,
  type BatchXRayResponse,
} from "@/lib/schemas";

export const SAMPLE_AGENCY_CAMPAIGN_CSV = `ad_name,ad_copy,landing_page_url,daily_budget
"Lumina Bottle - Q4 Launch","Stay cold for 36 hours. Lumina 32oz Insulated Bottle in Obsidian Black — Now $36.00 (was $45.00, 20% OFF). Use code HYDRATE20 at checkout! Free shipping on orders over $75.","https://demo.offerparity.app/products/lumina-32oz-bottle?variant=obsidian-black&utm_source=meta&utm_medium=paid_social&utm_campaign=q4_lumina_launch",600
"Veloce Boots - BFCM Retargeting","Recover faster after every run. Veloce Recovery Boots — 25% OFF today! Now $149.25 (reg $199.00) with code BFCM25 at checkout.","https://demo.offerparity.app/products/veloce-recovery-boots?utm_source=meta&utm_medium=paid_social&utm_campaign=bfcm_veloce_retargeting",1200
"Kova Hoodie - Cold Weather Prospecting","Ultralight warmth for cold-weather miles. Kova Merino Trail Hoodie in Alpine Olive (Size L) — just $68.00 today.","https://demo.offerparity.app/products/kova-merino-hoodie?variant=alpine-olive-l&utm_source=meta&utm_medium=paid_social",850
"Lumina Arctic White - Missing UTMs","Crisp hydration all day. Lumina 32oz Insulated Bottle in Arctic White — Now $36.00 with code HYDRATE20.","https://demo.offerparity.app/products/lumina-32oz-bottle?variant=arctic-white",400`;

export interface CsvParseResult {
  items: BatchXRayItemInput[];
  errors: string[];
}

/**
 * RFC-4180 compliant CSV tokenizer supporting quoted fields, escaped quotes (""),
 * and newlines inside quoted ad copy.
 */
export function tokenizeCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  const normalized = csvText.replace(/^\uFEFF/, "");

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      currentRow.push(currentField);
      currentField = "";
    } else if (ch === "\r") {
      if (normalized[i + 1] === "\n") {
        i += 1;
      }
      currentRow.push(currentField);
      currentField = "";
      if (currentRow.some((cell) => cell.trim() !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else if (ch === "\n") {
      currentRow.push(currentField);
      currentField = "";
      if (currentRow.some((cell) => cell.trim() !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += ch;
    }
  }

  currentRow.push(currentField);
  if (currentRow.some((cell) => cell.trim() !== "")) {
    rows.push(currentRow);
  }

  return rows;
}

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parses a campaign CSV export into validated `BatchXRayItemInput[]` items.
 */
export function parseCampaignCsv(csvText: string): CsvParseResult {
  const rows = tokenizeCsvRows(csvText);
  if (rows.length < 2) {
    return {
      items: [],
      errors: [
        "CSV must include a header row and at least one ad row (columns: ad_name, ad_copy, landing_page_url, daily_budget).",
      ],
    };
  }

  const headers = rows[0]!.map(normalizeHeader);
  const nameIdx = findColumnIndex(headers, [
    "ad_name",
    "name",
    "ad",
    "ad_set",
    "campaign",
    "creative_name",
  ]);
  const copyIdx = findColumnIndex(headers, [
    "ad_copy",
    "copy",
    "body",
    "primary_text",
    "ad_text",
    "headline",
    "script",
  ]);
  const urlIdx = findColumnIndex(headers, [
    "landing_page_url",
    "url",
    "final_url",
    "destination_url",
    "website_url",
    "link",
  ]);
  const budgetIdx = findColumnIndex(headers, [
    "daily_budget",
    "budget",
    "spend",
    "daily_spend",
  ]);
  const fixtureIdx = findColumnIndex(headers, ["fixture_id", "fixture", "scenario"]);

  const missingCols: string[] = [];
  if (copyIdx === -1) missingCols.push("ad_copy");
  if (urlIdx === -1) missingCols.push("landing_page_url");
  if (budgetIdx === -1) missingCols.push("daily_budget");

  if (missingCols.length > 0) {
    return {
      items: [],
      errors: [`Missing required CSV header column(s): ${missingCols.join(", ")}.`],
    };
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_BATCH_ITEMS) {
    return {
      items: [],
      errors: [
        `CSV contains ${dataRows.length} data rows, exceeding the maximum batch size of ${MAX_BATCH_ITEMS} ads.`,
      ],
    };
  }

  const items: BatchXRayItemInput[] = [];
  const errors: string[] = [];

  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i]!;
    const rowNum = i + 2;

    const rawName = nameIdx !== -1 ? (row[nameIdx]?.trim() ?? "") : "";
    const rawCopy = row[copyIdx]?.trim() ?? "";
    const rawUrl = row[urlIdx]?.trim() ?? "";
    const rawBudget = (row[budgetIdx] ?? "").replace(/[$,\s]/g, "").trim();
    const rawFixture = fixtureIdx !== -1 ? (row[fixtureIdx]?.trim() ?? "") : "";

    const numericBudget = rawBudget === "" ? Number.NaN : Number(rawBudget);
    const parsedFixture = rawFixture
      ? FixtureScenarioIdSchema.safeParse(rawFixture)
      : null;

    if (parsedFixture && !parsedFixture.success) {
      errors.push(`Row ${rowNum}: Invalid fixture_id "${rawFixture}".`);
      continue;
    }

    const candidate = {
      adName: rawName || `Ad Row ${i + 1}`,
      adCopy: rawCopy,
      landingPageUrl: rawUrl,
      dailyBudget: numericBudget,
      ...(parsedFixture?.success ? { fixtureId: parsedFixture.data } : {}),
    };

    const validated = BatchXRayItemInputSchema.safeParse(candidate);
    if (!validated.success) {
      const msg = validated.error.issues.map((iss) => iss.message).join("; ");
      errors.push(`Row ${rowNum} (${candidate.adName}): ${msg}`);
      continue;
    }

    items.push(validated.data);
  }

  return { items, errors };
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serializes a completed `BatchXRayResponse` into an exportable CSV audit sheet.
 */
export function serializeBatchAuditCsv(batch: BatchXRayResponse): string {
  const header = [
    "ad_name",
    "overall_status",
    "daily_budget_usd",
    "estimated_daily_waste_usd",
    "projected_30d_waste_usd",
    "at_risk_daily_spend_usd",
    "landing_page_url",
    "advertised_price",
    "storefront_price",
    "promo_code",
    "hero_variant",
    "failed_checks",
    "top_remediation",
  ];

  const lines = [header.join(",")];

  for (const row of batch.results) {
    if (!row.ok || !row.report) {
      lines.push(
        [
          escapeCsvCell(row.adName),
          "ERROR",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          escapeCsvCell(row.errorCode ?? "AUDIT_ERROR"),
          escapeCsvCell(row.error ?? "Audit failed"),
        ].join(",")
      );
      continue;
    }

    const r = row.report;
    const failedChecks = r.checks
      .filter((c) => c.status !== "PASS")
      .map((c) => `${c.id}:${c.status}`)
      .join(" | ");
    const topAction =
      r.checks.find((c) => c.status === "FAIL")?.remediation ??
      r.checks.find((c) => c.status === "WARN")?.remediation ??
      "No action needed.";

    lines.push(
      [
        escapeCsvCell(row.adName),
        escapeCsvCell(r.overallStatus),
        escapeCsvCell(r.request.dailyBudget.toFixed(2)),
        escapeCsvCell(r.waste.estimatedDailyWaste.toFixed(2)),
        escapeCsvCell(r.waste.projectedMonthlyWaste.toFixed(2)),
        escapeCsvCell(r.waste.atRiskDailySpend.toFixed(2)),
        escapeCsvCell(r.request.landingPageUrl),
        escapeCsvCell(
          r.extractedClaims.advertisedPrice !== null
            ? r.extractedClaims.advertisedPrice.toFixed(2)
            : ""
        ),
        escapeCsvCell(
          r.storefront.basePrice !== null ? r.storefront.basePrice.toFixed(2) : ""
        ),
        escapeCsvCell(r.extractedClaims.promoCode ?? ""),
        escapeCsvCell(
          r.extractedClaims.variantName ?? r.extractedClaims.variantId ?? ""
        ),
        escapeCsvCell(failedChecks || "NONE"),
        escapeCsvCell(topAction),
      ].join(",")
    );
  }

  return lines.join("\n");
}
