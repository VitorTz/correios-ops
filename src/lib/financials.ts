/**
 * Financial calculations for completed routes and biweekly (quinzena) reporting.
 * Uses 10 km/L default consumption and discounts Lists 2, 3, and 4 from R$ 2.11 revenue.
 */

export interface PackageBillingFlags {
  isActive: boolean; // List 1 (true) vs List 4 Deactivated (false)
  inAbsentList: boolean; // List 2 copy
  inInsufficientList: boolean; // List 3 copy
}

export interface RouteFinancialInput {
  packages: PackageBillingFlags[];
  predictedKm: number | null;
  actualKm: number | null;
  kmPerLiter: number;
  fuelPriceBrl: number;
  ratePerPackageBrl: number;
}

export interface RouteFinancialSummary {
  totalActiveCount: number;
  absentCount: number;
  insufficientCount: number;
  deactivatedCount: number;
  billableCount: number;
  grossRevenueBrl: number;
  predictedFuelLiters: number | null;
  predictedFuelCostBrl: number | null;
  actualFuelLiters: number | null;
  actualFuelCostBrl: number | null;
  kmVariance: number | null;
  netProfitBrl: number | null;
}

export interface DateRangePreset {
  startDate: string;
  endDate: string;
  label: string;
}

export function isBillablePackage(pkg: PackageBillingFlags): boolean {
  return pkg.isActive && !pkg.inAbsentList && !pkg.inInsufficientList;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateRouteFinancials(
  input: RouteFinancialInput
): RouteFinancialSummary {
  const totalActiveCount = input.packages.filter((p) => p.isActive).length;
  const deactivatedCount = input.packages.filter((p) => !p.isActive).length;
  const absentCount = input.packages.filter(
    (p) => p.isActive && p.inAbsentList
  ).length;
  const insufficientCount = input.packages.filter(
    (p) => p.isActive && p.inInsufficientList
  ).length;
  const billableCount = input.packages.filter(isBillablePackage).length;

  const grossRevenueBrl = round2(billableCount * input.ratePerPackageBrl);

  const predictedFuelLiters =
    input.predictedKm !== null && input.kmPerLiter > 0
      ? round2(input.predictedKm / input.kmPerLiter)
      : null;
  const predictedFuelCostBrl =
    predictedFuelLiters !== null
      ? round2(predictedFuelLiters * input.fuelPriceBrl)
      : null;

  const actualFuelLiters =
    input.actualKm !== null && input.kmPerLiter > 0
      ? round2(input.actualKm / input.kmPerLiter)
      : null;
  const actualFuelCostBrl =
    actualFuelLiters !== null
      ? round2(actualFuelLiters * input.fuelPriceBrl)
      : null;

  const kmVariance =
    input.actualKm !== null && input.predictedKm !== null
      ? round2(input.actualKm - input.predictedKm)
      : null;

  const netProfitBrl =
    actualFuelCostBrl !== null
      ? round2(grossRevenueBrl - actualFuelCostBrl)
      : predictedFuelCostBrl !== null
        ? round2(grossRevenueBrl - predictedFuelCostBrl)
        : null;

  return {
    totalActiveCount,
    absentCount,
    insufficientCount,
    deactivatedCount,
    billableCount,
    grossRevenueBrl,
    predictedFuelLiters,
    predictedFuelCostBrl,
    actualFuelLiters,
    actualFuelCostBrl,
    kmVariance,
    netProfitBrl,
  };
}

export function getQuinzenaRange(referenceDate: Date): DateRangePreset {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const day = referenceDate.getUTCDate();
  const mm = String(month + 1).padStart(2, "0");

  if (day <= 15) {
    return {
      startDate: `${year}-${mm}-01`,
      endDate: `${year}-${mm}-15`,
      label: `1a Quinzena (${mm}/${year})`,
    };
  }

  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    startDate: `${year}-${mm}-16`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
    label: `2a Quinzena (${mm}/${year})`,
  };
}

/** Returns the previous closed quinzena relative to referenceDate. */
export function getPreviousQuinzenaRange(referenceDate: Date): DateRangePreset {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const day = referenceDate.getUTCDate();

  if (day > 15) {
    const mm = String(month + 1).padStart(2, "0");
    return {
      startDate: `${year}-${mm}-01`,
      endDate: `${year}-${mm}-15`,
      label: `1a Quinzena (${mm}/${year})`,
    };
  }

  const prevMonthDate = new Date(Date.UTC(year, month, 0)); // last day of previous month
  const py = prevMonthDate.getUTCFullYear();
  const pm = String(prevMonthDate.getUTCMonth() + 1).padStart(2, "0");
  const lastDay = String(prevMonthDate.getUTCDate()).padStart(2, "0");
  return {
    startDate: `${py}-${pm}-16`,
    endDate: `${py}-${pm}-${lastDay}`,
    label: `2a Quinzena (${pm}/${py})`,
  };
}

/** Returns the full calendar month range for referenceDate. */
export function getCurrentMonthRange(referenceDate: Date): DateRangePreset {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const mm = String(month + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
    label: `Mes Completo (${mm}/${year})`,
  };
}

/** Computes worked hours between shift start (CEE arrival or departure) and return. */
export function computeWorkedHours(
  startIso: Date | string | null,
  endIso: Date | string | null
): number | null {
  if (!startIso || !endIso) return null;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  return round2((endMs - startMs) / (1000 * 60 * 60));
}
