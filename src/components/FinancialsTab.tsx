"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getCurrentMonthRange,
  getPreviousQuinzenaRange,
  getQuinzenaRange,
} from "@/lib/financials";

interface FinancialSummary {
  start: string;
  end: string;
  completedRoutesCount: number;
  billablePackages: number;
  absentPackages: number;
  insufficientPackages: number;
  deactivatedPackages: number;
  predictedKm: number;
  actualKm: number;
  kmVariance: number;
  fuelLiters: number;
  fuelCostBrl: number;
  grossRevenueBrl: number;
  netProfitBrl: number;
  netPerPackageBrl: number;
  workedHours: number;
  netPerHourBrl: number | null;
}

interface DayBreakdown {
  date: string;
  grossRevenueBrl: number;
  fuelCostBrl: number;
  netProfitBrl: number;
  billableCount: number;
}

interface RouteRow {
  id: string;
  routeDate: string;
  name: string;
  billableCount: number;
  absentCount: number;
  insufficientCount: number;
  deactivatedCount: number;
  predictedKm: number;
  actualKm: number | null;
  kmVariance: number | null;
  fuelLiters: number;
  fuelCostBrl: number;
  grossRevenueBrl: number;
  netProfitBrl: number;
  workedHours: number | null;
  usedActualKm: boolean;
}

export function FinancialsTab() {
  const defaultRange = getQuinzenaRange(new Date());
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [byDay, setByDay] = useState<DayBreakdown[]>([]);
  const [rows, setRows] = useState<RouteRow[]>([]);

  const loadFinancials = useCallback(async (start: string, end: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/financials?start=${start}&end=${end}`);
      const data = (await res.json()) as {
        error?: string;
        summary?: FinancialSummary;
        byDay?: DayBreakdown[];
        routes?: RouteRow[];
      };
      if (!res.ok) {
        setError(data.error ?? "Erro ao carregar analise financeira.");
        return;
      }
      setSummary(data.summary ?? null);
      setByDay(data.byDay ?? []);
      setRows(data.routes ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFinancials(startDate, endDate);
  }, [startDate, endDate, loadFinancials]);

  function applyPreset(preset: "current" | "previous" | "month") {
    const now = new Date();
    const range =
      preset === "current"
        ? getQuinzenaRange(now)
        : preset === "previous"
          ? getPreviousQuinzenaRange(now)
          : getCurrentMonthRange(now);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }

  const maxDayGross = Math.max(
    1,
    ...byDay.map((d) => d.grossRevenueBrl)
  );

  return (
    <div>
      {/* Period Selector */}
      <section className="panel">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                De
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                Ate
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
              />
            </div>
            <button
              type="button"
              className="tab-btn"
              onClick={() => applyPreset("current")}
            >
              Quinzena Atual
            </button>
            <button
              type="button"
              className="tab-btn"
              onClick={() => applyPreset("previous")}
            >
              Quinzena Anterior
            </button>
            <button
              type="button"
              className="tab-btn"
              onClick={() => applyPreset("month")}
            >
              Mes Atual
            </button>
          </div>

          <a
            className="btn-primary"
            style={{ textDecoration: "none" }}
            href={`/api/financials?start=${startDate}&end=${endDate}&format=csv`}
          >
            Exportar CSV
          </a>
        </div>

        <p className="subtitle" style={{ marginTop: 10 }}>
          Considera exclusivamente rotas com status <code>completa</code> no
          intervalo. Encomendas nas listas de Ausentes (L2), Endereco Insuficiente
          (L3) e Desativadas (L4) sao descontadas automaticamente dos R$ 2,11.
        </p>
      </section>

      {error && (
        <div
          className="stale-banner"
          style={{ background: "#fee2e2", color: "#991b1b", borderColor: "#ef4444" }}
        >
          {error}
        </div>
      )}

      {loading && (
        <p className="subtitle" style={{ marginTop: 16 }}>
          Carregando consolidado financeiro...
        </p>
      )}

      {summary && !loading && (
        <>
          <section className="panel">
            <h2>Consolidado do Periodo ({summary.completedRoutesCount} rotas completas)</h2>
            <div className="kpi-grid">
              <div className="kpi-box">
                <div className="kpi-label">Lucro Liquido</div>
                <div className="kpi-value" style={{ color: "var(--teal)" }}>
                  R$ {summary.netProfitBrl.toFixed(2)}
                </div>
              </div>
              <div className="kpi-box">
                <div className="kpi-label">Receita Bruta</div>
                <div className="kpi-value">
                  R$ {summary.grossRevenueBrl.toFixed(2)}
                </div>
              </div>
              <div className="kpi-box">
                <div className="kpi-label">Combustivel ({summary.fuelLiters} L)</div>
                <div className="kpi-value" style={{ color: "#b45309" }}>
                  R$ {summary.fuelCostBrl.toFixed(2)}
                </div>
              </div>
              <div className="kpi-box">
                <div className="kpi-label">Pacotes Pagos / Descontados</div>
                <div className="kpi-value">
                  {summary.billablePackages} /{" "}
                  {summary.absentPackages +
                    summary.insufficientPackages +
                    summary.deactivatedPackages}
                </div>
              </div>
              <div className="kpi-box">
                <div className="kpi-label">KM Real vs. Previsto</div>
                <div className="kpi-value" style={{ fontSize: 18 }}>
                  {summary.actualKm} / {summary.predictedKm} km (
                  {summary.kmVariance >= 0 ? "+" : ""}
                  {summary.kmVariance})
                </div>
              </div>
              <div className="kpi-box">
                <div className="kpi-label">Liquido / Pacote · Liquido / Hora</div>
                <div className="kpi-value" style={{ fontSize: 18 }}>
                  R$ {summary.netPerPackageBrl.toFixed(2)} ·{" "}
                  {summary.netPerHourBrl !== null
                    ? `R$ ${summary.netPerHourBrl.toFixed(2)}/h`
                    : "--"}
                </div>
              </div>
            </div>
          </section>

          {/* Daily visual breakdown */}
          {byDay.length > 0 && (
            <section className="panel">
              <h2>Evolucao Diaria (Lucro Liquido vs. Combustivel)</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {byDay.map((d) => {
                  const netPct = Math.max(
                    0,
                    Math.round((d.netProfitBrl / maxDayGross) * 100)
                  );
                  const fuelPct = Math.max(
                    0,
                    Math.round((d.fuelCostBrl / maxDayGross) * 100)
                  );
                  return (
                    <div key={d.date}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 13,
                          marginBottom: 4,
                        }}
                      >
                        <strong>
                          {d.date} ({d.billableCount} pcts)
                        </strong>
                        <span>
                          Liquido: <strong>R$ {d.netProfitBrl.toFixed(2)}</strong>{" "}
                          · Comb.: R$ {d.fuelCostBrl.toFixed(2)}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          height: 12,
                          background: "#e2e8f0",
                          borderRadius: 6,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{ width: `${netPct}%`, background: "var(--teal)" }}
                          title={`Lucro liquido: R$ ${d.netProfitBrl.toFixed(2)}`}
                        />
                        <div
                          style={{ width: `${fuelPct}%`, background: "#f59e0b" }}
                          title={`Combustivel: R$ ${d.fuelCostBrl.toFixed(2)}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Completed routes table */}
          <section className="panel">
            <h2>Rotas Completas no Periodo</h2>
            {rows.length === 0 ? (
              <p className="subtitle">
                Nenhuma rota marcada como <code>completa</code> entre {startDate} e{" "}
                {endDate}.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Rota</th>
                    <th>Pagas</th>
                    <th>Descontadas (L2/L3/L4)</th>
                    <th>KM Prev. / Real</th>
                    <th>Combustivel</th>
                    <th>Receita Bruta</th>
                    <th>Lucro Liquido</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.routeDate}</td>
                      <td>{r.name}</td>
                      <td>
                        <strong>{r.billableCount}</strong>
                      </td>
                      <td>
                        {r.absentCount}/{r.insufficientCount}/{r.deactivatedCount}
                      </td>
                      <td>
                        {r.predictedKm} /{" "}
                        {r.actualKm !== null ? r.actualKm : "(prev.)"} km
                      </td>
                      <td>R$ {r.fuelCostBrl.toFixed(2)}</td>
                      <td>R$ {r.grossRevenueBrl.toFixed(2)}</td>
                      <td style={{ fontWeight: 700, color: "var(--teal)" }}>
                        R$ {r.netProfitBrl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
