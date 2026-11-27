import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { routePackages, routes } from "@/db/schema";
import {
  calculateRouteFinancials,
  computeWorkedHours,
  getQuinzenaRange,
} from "@/lib/financials";

function csvEscape(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (/[",\n;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const defaultRange = getQuinzenaRange(new Date());
    const start = searchParams.get("start") || defaultRange.startDate;
    const end = searchParams.get("end") || defaultRange.endDate;
    const format = searchParams.get("format");

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(end)
    ) {
      return NextResponse.json(
        { error: "Datas invalidas. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }

    const db = getDb();

    // Strictly include ONLY routes with status = 'completa' in the selected range
    const completedRoutes = await db
      .select()
      .from(routes)
      .where(
        and(
          eq(routes.status, "completa"),
          gte(routes.routeDate, start),
          lte(routes.routeDate, end)
        )
      )
      .orderBy(asc(routes.routeDate), asc(routes.createdAt));

    const routeIds = completedRoutes.map((r) => r.id);
    const allPackages =
      routeIds.length > 0
        ? await db
            .select()
            .from(routePackages)
            .where(inArray(routePackages.routeId, routeIds))
        : [];

    const pkgsByRoute = new Map<string, typeof allPackages>();
    for (const pkg of allPackages) {
      const list = pkgsByRoute.get(pkg.routeId) ?? [];
      list.push(pkg);
      pkgsByRoute.set(pkg.routeId, list);
    }

    const routeBreakdown = completedRoutes.map((route) => {
      const pkgs = pkgsByRoute.get(route.id) ?? [];
      const fin = calculateRouteFinancials({
        packages: pkgs,
        predictedKm: route.predictedKm
          ? Number.parseFloat(route.predictedKm)
          : null,
        actualKm: route.actualKm ? Number.parseFloat(route.actualKm) : null,
        kmPerLiter: Number.parseFloat(route.kmPerLiter),
        fuelPriceBrl: Number.parseFloat(route.fuelPriceBrl),
        ratePerPackageBrl: Number.parseFloat(route.ratePerPackageBrl),
      });

      const workedHours = computeWorkedHours(
        route.ceeArrivalAt ?? route.departedAt,
        route.returnedAt
      );

      const effectiveFuelCost =
        fin.actualFuelCostBrl ?? fin.predictedFuelCostBrl ?? 0;
      const effectiveFuelLiters =
        fin.actualFuelLiters ?? fin.predictedFuelLiters ?? 0;
      const effectiveNetProfit =
        fin.netProfitBrl ?? Number((fin.grossRevenueBrl - effectiveFuelCost).toFixed(2));

      return {
        id: route.id,
        routeDate: route.routeDate,
        name: route.name,
        billableCount: fin.billableCount,
        absentCount: fin.absentCount,
        insufficientCount: fin.insufficientCount,
        deactivatedCount: fin.deactivatedCount,
        predictedKm: route.predictedKm ? Number.parseFloat(route.predictedKm) : 0,
        actualKm: route.actualKm ? Number.parseFloat(route.actualKm) : null,
        kmVariance: fin.kmVariance,
        fuelLiters: effectiveFuelLiters,
        fuelCostBrl: effectiveFuelCost,
        grossRevenueBrl: fin.grossRevenueBrl,
        netProfitBrl: effectiveNetProfit,
        workedHours,
        usedActualKm: route.actualKm !== null,
      };
    });

    const totals = routeBreakdown.reduce(
      (acc, r) => {
        acc.completedRoutesCount += 1;
        acc.billablePackages += r.billableCount;
        acc.absentPackages += r.absentCount;
        acc.insufficientPackages += r.insufficientCount;
        acc.deactivatedPackages += r.deactivatedCount;
        acc.predictedKm += r.predictedKm;
        acc.actualKm += r.actualKm ?? r.predictedKm;
        acc.fuelLiters += r.fuelLiters;
        acc.fuelCostBrl += r.fuelCostBrl;
        acc.grossRevenueBrl += r.grossRevenueBrl;
        acc.netProfitBrl += r.netProfitBrl;
        if (r.workedHours !== null) {
          acc.workedHours += r.workedHours;
        }
        return acc;
      },
      {
        completedRoutesCount: 0,
        billablePackages: 0,
        absentPackages: 0,
        insufficientPackages: 0,
        deactivatedPackages: 0,
        predictedKm: 0,
        actualKm: 0,
        fuelLiters: 0,
        fuelCostBrl: 0,
        grossRevenueBrl: 0,
        netProfitBrl: 0,
        workedHours: 0,
      }
    );

    // Group daily net profit & revenue for bar chart
    const dayMap = new Map<
      string,
      { date: string; grossRevenueBrl: number; fuelCostBrl: number; netProfitBrl: number; billableCount: number }
    >();
    for (const r of routeBreakdown) {
      const existing = dayMap.get(r.routeDate) ?? {
        date: r.routeDate,
        grossRevenueBrl: 0,
        fuelCostBrl: 0,
        netProfitBrl: 0,
        billableCount: 0,
      };
      existing.grossRevenueBrl = Number(
        (existing.grossRevenueBrl + r.grossRevenueBrl).toFixed(2)
      );
      existing.fuelCostBrl = Number(
        (existing.fuelCostBrl + r.fuelCostBrl).toFixed(2)
      );
      existing.netProfitBrl = Number(
        (existing.netProfitBrl + r.netProfitBrl).toFixed(2)
      );
      existing.billableCount += r.billableCount;
      dayMap.set(r.routeDate, existing);
    }

    const summary = {
      start,
      end,
      completedRoutesCount: totals.completedRoutesCount,
      billablePackages: totals.billablePackages,
      absentPackages: totals.absentPackages,
      insufficientPackages: totals.insufficientPackages,
      deactivatedPackages: totals.deactivatedPackages,
      predictedKm: Number(totals.predictedKm.toFixed(2)),
      actualKm: Number(totals.actualKm.toFixed(2)),
      kmVariance: Number((totals.actualKm - totals.predictedKm).toFixed(2)),
      fuelLiters: Number(totals.fuelLiters.toFixed(2)),
      fuelCostBrl: Number(totals.fuelCostBrl.toFixed(2)),
      grossRevenueBrl: Number(totals.grossRevenueBrl.toFixed(2)),
      netProfitBrl: Number(totals.netProfitBrl.toFixed(2)),
      netPerPackageBrl:
        totals.billablePackages > 0
          ? Number((totals.netProfitBrl / totals.billablePackages).toFixed(2))
          : 0,
      workedHours: Number(totals.workedHours.toFixed(2)),
      netPerHourBrl:
        totals.workedHours > 0
          ? Number((totals.netProfitBrl / totals.workedHours).toFixed(2))
          : null,
    };

    if (format === "csv") {
      const headers = [
        "Data",
        "Rota",
        "Pagas",
        "Ausentes (L2)",
        "End. Insuficiente (L3)",
        "Desativadas (L4)",
        "KM Previsto",
        "KM Real",
        "Combustivel (L)",
        "Custo Combustivel (R$)",
        "Receita Bruta (R$)",
        "Lucro Liquido (R$)",
        "Horas Trabalhadas",
      ];
      const csvRows = [
        headers.join(";"),
        ...routeBreakdown.map((r) =>
          [
            r.routeDate,
            r.name,
            r.billableCount,
            r.absentCount,
            r.insufficientCount,
            r.deactivatedCount,
            r.predictedKm.toFixed(2),
            r.actualKm !== null ? r.actualKm.toFixed(2) : "",
            r.fuelLiters.toFixed(2),
            r.fuelCostBrl.toFixed(2),
            r.grossRevenueBrl.toFixed(2),
            r.netProfitBrl.toFixed(2),
            r.workedHours !== null ? r.workedHours.toFixed(2) : "",
          ]
            .map(csvEscape)
            .join(";")
        ),
      ];

      // Prepend UTF-8 BOM for clean Portuguese display in Excel
      const csvContent = "\uFEFF" + csvRows.join("\r\n");
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="financeiro-correios-${start}-a-${end}.csv"`,
        },
      });
    }

    return NextResponse.json({
      summary,
      byDay: Array.from(dayMap.values()),
      routes: routeBreakdown,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
