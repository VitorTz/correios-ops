import {
  isValidIslandCep,
  normalizeCep,
  normalizeStreetNumber,
} from "./cep";

export const TRACKING_CODE_REGEX = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

export interface ParsedPackageRow {
  lineNumber: number;
  trackingCode: string;
  cep: string;
  numeroRaw: string | null;
  numeroNorm: string;
  isAr: boolean;
  sourceAddress: string | null;
}

export interface RejectedPackageRow {
  lineNumber: number;
  rawLine: string;
  reason: string;
}

export interface CorreiosParseSummary {
  packages: ParsedPackageRow[];
  rejected: RejectedPackageRow[];
  stats: {
    totalValid: number;
    uniqueAddresses: number;
    uniqueCeps: number;
    arCount: number;
    snCount: number;
    rejectedCount: number;
  };
}

/**
 * Extracts the trailing house/building number from a Correios address string.
 * Handles range suffixes like "Rua Leonel Pereira - ate 1186/1187 946",
 * "de 1188/1189 ao fim 1880", alphanumeric numbers ("285B"), "S/N", and "-".
 */
export function extractNumberFromCorreiosAddress(address: string): {
  numeroRaw: string | null;
  numeroNorm: string;
} {
  const trimmed = address.trim();
  if (!trimmed) return { numeroRaw: null, numeroNorm: "SN" };

  // Strip trailing S/N or standalone dash
  if (/(?:^|\s)(?:s\/?n\.?|-)$/i.test(trimmed)) {
    return { numeroRaw: null, numeroNorm: "SN" };
  }

  // Match trailing alphanumeric house number token (must start with a digit)
  const match = trimmed.match(/(?:^|\s)(\d+[A-Za-z]?)$/);
  if (match && match[1]) {
    return normalizeStreetNumber(match[1]);
  }

  return { numeroRaw: null, numeroNorm: "SN" };
}

/**
 * Parses either a tab-separated Correios table (like correios-lista.txt) or
 * simple manual lines ("AD123456789BR 88056-300 946").
 * Highlights only the AR column per operational requirements.
 */
export function parseCorreiosList(rawInput: string): CorreiosParseSummary {
  const lines = rawInput.split(/\r?\n/);
  const packages: ParsedPackageRow[] = [];
  const rejected: RejectedPackageRow[] = [];
  const seenTracking = new Set<string>();

  for (let idx = 0; idx < lines.length; idx += 1) {
    const lineNumber = idx + 1;
    const rawLine = lines[idx];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip Correios table header row
    if (/^objeto/i.test(trimmed) && /cep/i.test(trimmed)) {
      continue;
    }

    const isTsv = rawLine.includes("\t");

    if (isTsv) {
      const cols = rawLine.split("\t").map((c) => c.trim());
      const trackingCode = (cols[0] ?? "").toUpperCase();
      const sourceAddress = cols[2] ?? "";
      const rawCep = cols[3] ?? "";
      const arCol = (cols[4] ?? "").toUpperCase();

      if (!TRACKING_CODE_REGEX.test(trackingCode)) {
        rejected.push({
          lineNumber,
          rawLine: trimmed,
          reason: `Codigo de objeto invalido: "${trackingCode || "(vazio)"}"`,
        });
        continue;
      }

      if (seenTracking.has(trackingCode)) {
        rejected.push({
          lineNumber,
          rawLine: trimmed,
          reason: `Codigo duplicado na mesma lista: ${trackingCode}`,
        });
        continue;
      }

      const cep = normalizeCep(rawCep);
      if (!isValidIslandCep(cep)) {
        rejected.push({
          lineNumber,
          rawLine: trimmed,
          reason: `CEP "${rawCep}" fora do range permitido (88010-000 ate 88059-999)`,
        });
        continue;
      }

      const { numeroRaw, numeroNorm } =
        extractNumberFromCorreiosAddress(sourceAddress);

      seenTracking.add(trackingCode);
      packages.push({
        lineNumber,
        trackingCode,
        cep,
        numeroRaw,
        numeroNorm,
        isAr: arCol === "X" || arCol === "SIM" || arCol === "1",
        sourceAddress: sourceAddress || null,
      });
    } else {
      // Simple line format: "<TRACKING_CODE> <CEP> [NUMBER] [AR]"
      const tokens = trimmed.split(/[\s,;]+/).filter(Boolean);
      const trackingCode = (tokens[0] ?? "").toUpperCase();
      const rawCep = tokens[1] ?? "";
      const rawNumber = tokens[2] ?? null;
      const isAr = tokens.slice(3).some((t) => t.toUpperCase() === "AR");

      if (!TRACKING_CODE_REGEX.test(trackingCode)) {
        rejected.push({
          lineNumber,
          rawLine: trimmed,
          reason: `Codigo de objeto invalido: "${trackingCode || "(vazio)"}"`,
        });
        continue;
      }

      if (seenTracking.has(trackingCode)) {
        rejected.push({
          lineNumber,
          rawLine: trimmed,
          reason: `Codigo duplicado na mesma lista: ${trackingCode}`,
        });
        continue;
      }

      const cep = normalizeCep(rawCep);
      if (!isValidIslandCep(cep)) {
        rejected.push({
          lineNumber,
          rawLine: trimmed,
          reason: `CEP "${rawCep}" fora do range permitido (88010-000 ate 88059-999)`,
        });
        continue;
      }

      const { numeroRaw, numeroNorm } = normalizeStreetNumber(rawNumber);
      seenTracking.add(trackingCode);
      packages.push({
        lineNumber,
        trackingCode,
        cep,
        numeroRaw,
        numeroNorm,
        isAr,
        sourceAddress: null,
      });
    }
  }

  const uniqueCeps = new Set(packages.map((p) => p.cep));
  const uniqueAddresses = new Set(
    packages.map((p) => `${p.cep}::${p.numeroNorm}`)
  );

  return {
    packages,
    rejected,
    stats: {
      totalValid: packages.length,
      uniqueAddresses: uniqueAddresses.size,
      uniqueCeps: uniqueCeps.size,
      arCount: packages.filter((p) => p.isAr).length,
      snCount: packages.filter((p) => p.numeroNorm === "SN").length,
      rejectedCount: rejected.length,
    },
  };
}
