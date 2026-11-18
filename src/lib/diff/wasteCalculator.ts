import type {
  OverallVerdict,
  ParityCheck,
  WasteEstimate,
  WasteFactor,
} from "@/lib/schemas";

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) {
    return 0;
  }
  return Math.min(1, Math.max(0, weight));
}

function computeSurvivalComplement(factors: WasteFactor[]): number {
  if (factors.length === 0) {
    return 0;
  }
  const survivalProduct = factors.reduce((acc, factor) => acc * (1 - factor.weight), 1);
  const rawRate = 1 - survivalProduct;
  return Math.min(1, Math.max(0, Math.round(rawRate * 1_000_000) / 1_000_000));
}

/**
 * Estimates daily and 30-day wasted ad spend using a bounded survival-complement
 * model `1 - Π(1 - w_i)` across failing checks, plus separate at-risk spend from
 * warnings. Returns $0 waste when WAF blocks automated inspection.
 */
export function calculateWaste(
  checks: ParityCheck[],
  dailyBudget: number,
  overallStatus: OverallVerdict
): WasteEstimate {
  const safeBudget = Number.isFinite(dailyBudget) && dailyBudget > 0 ? dailyBudget : 0;

  const failingFactors: WasteFactor[] = checks
    .filter((check) => check.status === "FAIL")
    .map((check) => ({
      id: check.id,
      label: check.label,
      weight: clampWeight(check.impactWeight),
    }));

  const warningFactors: WasteFactor[] = checks
    .filter((check) => check.status === "WARN")
    .map((check) => ({
      id: check.id,
      label: check.label,
      weight: clampWeight(check.impactWeight),
    }));

  if (overallStatus === "WAF_CHALLENGE_MANUAL_CHECK") {
    return {
      estimatedDailyWaste: 0,
      projectedMonthlyWaste: 0,
      atRiskDailySpend: 0,
      effectiveWasteRate: 0,
      breakdown: {
        formula:
          "WAF_CHALLENGE_MANUAL_CHECK — automated waste calculation paused ($0.00 reported until manual verification)",
        failingFactors,
        warningFactors,
      },
    };
  }

  const effectiveWasteRate = computeSurvivalComplement(failingFactors);
  const estimatedDailyWaste = roundCurrency(safeBudget * effectiveWasteRate);
  const projectedMonthlyWaste = roundCurrency(estimatedDailyWaste * 30);

  const warnRate = computeSurvivalComplement(warningFactors);
  const remainingNonWastedBudget = Math.max(0, safeBudget - estimatedDailyWaste);
  const atRiskDailySpend = roundCurrency(remainingNonWastedBudget * warnRate);

  const formula =
    failingFactors.length === 0
      ? "effectiveWasteRate = 0% (no failing checks)"
      : `effectiveWasteRate = 1 - ${failingFactors
          .map((factor) => `(1 - ${factor.weight.toFixed(2)})`)
          .join(" * ")} = ${(effectiveWasteRate * 100).toFixed(2)}%`;

  return {
    estimatedDailyWaste,
    projectedMonthlyWaste,
    atRiskDailySpend,
    effectiveWasteRate,
    breakdown: {
      formula,
      failingFactors,
      warningFactors,
    },
  };
}
