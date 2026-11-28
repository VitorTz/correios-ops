"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCep } from "@/lib/cep";
import { parseCorreiosList } from "@/lib/correios-parser";
import { calculateRouteFinancials } from "@/lib/financials";
import { buildGoogleMapsLegLinks } from "@/lib/google-maps-links";
import { OpenStreetMapView } from "./OpenStreetMapView";
import { MapPackage, MapStop, RouteMap } from "./RouteMap";

interface RouteRecord {
  id: string;
  routeDate: string;
  name: string;
  description: string | null;
  status: "em_andamento" | "completa";
  isStale: boolean;
  depotLat: number;
  depotLng: number;
  walkRadiusMeters: number;
  kmPerLiter: string;
  ratePerPackageBrl: string;
  fuelPriceBrl: string;
  ceeArrivalAt: string | null;
  departedAt: string | null;
  returnedAt: string | null;
  predictedKm: string | null;
  actualKm: string | null;
  predictedDurationSec: number | null;
  polylineEncoded: string | null;
}

interface RouteJobRecord {
  id: string;
  status: string;
  stage: string;
  processedCount: number;
  totalCount: number;
  errorMessage: string | null;
}

interface RouteLogRecord {
  id: string;
  occurredAt: string;
  message: string;
}

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatEstimatedDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "--";
  const totalMin = Math.round(seconds / 60);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${String(mins).padStart(2, "0")}min`;
}

function formatEstimatedReturn(
  departedAt: string | null,
  durationSec: number | null
): string | null {
  if (!departedAt || !durationSec || durationSec <= 0) return null;
  const eta = new Date(new Date(departedAt).getTime() + durationSec * 1000);
  return eta.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RoutesTab() {
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [dayRoutes, setDayRoutes] = useState<RouteRecord[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);

  const [routeDetail, setRouteDetail] = useState<RouteRecord | null>(null);
  const [latestJob, setLatestJob] = useState<RouteJobRecord | null>(null);
  const [stops, setStops] = useState<MapStop[]>([]);
  const [packages, setPackages] = useState<MapPackage[]>([]);
  const [logs, setLogs] = useState<RouteLogRecord[]>([]);

  const [newRouteName, setNewRouteName] = useState("");
  const [newRouteDesc, setNewRouteDesc] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [manualCep, setManualCep] = useState("");
  const [manualNum, setManualNum] = useState("");
  const [manualAr, setManualAr] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [newLogMsg, setNewLogMsg] = useState("");
  const [actualKmDraft, setActualKmDraft] = useState("");

  const [activeListTab, setActiveListTab] = useState<1 | 2 | 3 | 4>(1);
  const [viewMode, setViewMode] = useState<"map" | "field">("map");
  const [mapProvider, setMapProvider] = useState<"google" | "osm">(() => {
    if (typeof window === "undefined") return "osm";
    return window.localStorage.getItem("correios_map_provider") === "google"
      ? "google"
      : "osm";
  });

  function selectMapProvider(provider: "google" | "osm") {
    setMapProvider(provider);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("correios_map_provider", provider);
    }
  }
  const [feedback, setFeedback] = useState<string | null>(null);
  const [copiedLeg, setCopiedLeg] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const loadDayRoutes = useCallback(async (dateStr: string) => {
    const res = await fetch(`/api/routes?date=${dateStr}`);
    if (!res.ok) return;
    const data = (await res.json()) as { routes: RouteRecord[] };
    setDayRoutes(data.routes);
    if (data.routes.length > 0) {
      setActiveRouteId((prev) =>
        data.routes.some((r) => r.id === prev) ? prev : data.routes[0].id
      );
    } else {
      setActiveRouteId(null);
      setRouteDetail(null);
      setStops([]);
      setPackages([]);
      setLogs([]);
    }
  }, []);

  const loadRouteStatus = useCallback(async (routeId: string) => {
    const [statusRes, logsRes] = await Promise.all([
      fetch(`/api/routes/${routeId}/status`),
      fetch(`/api/routes/${routeId}/logs`),
    ]);
    if (statusRes.ok) {
      const data = (await statusRes.json()) as {
        route: RouteRecord;
        latestJob: RouteJobRecord | null;
        stops: MapStop[];
        packages: MapPackage[];
      };
      setRouteDetail(data.route);
      setLatestJob(data.latestJob);
      setStops(data.stops);
      setPackages(data.packages);
      setActualKmDraft(data.route.actualKm ?? "");
    }
    if (logsRes.ok) {
      const logData = (await logsRes.json()) as { logs: RouteLogRecord[] };
      setLogs(logData.logs);
    }
  }, []);

  useEffect(() => {
    loadDayRoutes(selectedDate);
  }, [selectedDate, loadDayRoutes]);

  useEffect(() => {
    setConfirmingDelete(false);
    if (activeRouteId) {
      loadRouteStatus(activeRouteId);
    }
  }, [activeRouteId, loadRouteStatus]);

  // Poll every 2 seconds while async Inngest job is queued or processing
  useEffect(() => {
    if (
      !activeRouteId ||
      !latestJob ||
      !["queued", "processing"].includes(latestJob.status)
    ) {
      return;
    }
    const timer = setInterval(() => {
      loadRouteStatus(activeRouteId);
    }, 2000);
    return () => clearInterval(timer);
  }, [activeRouteId, latestJob, loadRouteStatus]);

  const bulkPreview = useMemo(() => parseCorreiosList(bulkText), [bulkText]);

  const financials = useMemo(() => {
    if (!routeDetail) return null;
    return calculateRouteFinancials({
      packages,
      predictedKm: routeDetail.predictedKm
        ? Number.parseFloat(routeDetail.predictedKm)
        : null,
      actualKm: routeDetail.actualKm
        ? Number.parseFloat(routeDetail.actualKm)
        : null,
      kmPerLiter: Number.parseFloat(routeDetail.kmPerLiter),
      fuelPriceBrl: Number.parseFloat(routeDetail.fuelPriceBrl),
      ratePerPackageBrl: Number.parseFloat(routeDetail.ratePerPackageBrl),
    });
  }, [routeDetail, packages]);

  async function handleCreateRoute(e: React.FormEvent) {
    e.preventDefault();
    if (!newRouteName.trim()) return;
    const res = await fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeDate: selectedDate,
        name: newRouteName.trim(),
        description: newRouteDesc.trim() || null,
      }),
    });
    if (res.ok) {
      const { route } = (await res.json()) as { route: RouteRecord };
      setNewRouteName("");
      setNewRouteDesc("");
      await loadDayRoutes(selectedDate);
      setActiveRouteId(route.id);
    }
  }

  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault();
    if (!activeRouteId) return;
    setFeedback(null);
    const res = await fetch(`/api/routes/${activeRouteId}/packages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "manual",
        trackingCode: manualCode,
        cep: manualCep,
        numero: manualNum || null,
        isAr: manualAr,
      }),
    });
    const data = (await res.json()) as { error?: string; insertedCount?: number };
    if (!res.ok) {
      setFeedback(data.error ?? "Erro ao adicionar encomenda.");
      return;
    }
    setManualCode("");
    setManualCep("");
    setManualNum("");
    setManualAr(false);
    setFeedback("Encomenda adicionada. Clique em Atualizar Rota para recalcular.");
    await loadRouteStatus(activeRouteId);
  }

  async function handleAddBulk() {
    if (!activeRouteId || !bulkText.trim()) return;
    setFeedback(null);
    const res = await fetch(`/api/routes/${activeRouteId}/packages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "bulk", rawText: bulkText }),
    });
    const data = (await res.json()) as {
      error?: string;
      insertedCount?: number;
      skippedDuplicatesCount?: number;
      rejected?: Array<{ lineNumber: number; reason: string }>;
    };
    if (!res.ok) {
      setFeedback(data.error ?? "Erro ao importar lista.");
      return;
    }
    setBulkText("");
    setFeedback(
      `${data.insertedCount ?? 0} inseridas, ${data.skippedDuplicatesCount ?? 0} duplicadas ignoradas, ${data.rejected?.length ?? 0} rejeitadas. Clique em Atualizar Rota.`
    );
    await loadRouteStatus(activeRouteId);
  }

  async function handleTriggerRecalculate() {
    if (!activeRouteId) return;
    setFeedback(null);
    const res = await fetch(`/api/routes/${activeRouteId}/recalculate`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setFeedback(data.error ?? `Erro HTTP ${res.status} ao iniciar recalculo.`);
      return;
    }
    await loadRouteStatus(activeRouteId);
  }

  async function handlePatchRoute(patch: Record<string, unknown>) {
    if (!activeRouteId) return;
    const res = await fetch(`/api/routes/${activeRouteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      await loadRouteStatus(activeRouteId);
      await loadDayRoutes(selectedDate);
    }
  }

  async function handleDeleteRoute() {
    if (!activeRouteId) return;
    setFeedback(null);
    const res = await fetch(`/api/routes/${activeRouteId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setFeedback(data.error ?? "Erro ao excluir a rota.");
      return;
    }
    setConfirmingDelete(false);
    await loadDayRoutes(selectedDate);
  }

  async function handlePatchPackage(
    pkgId: string,
    patch: Record<string, unknown>
  ) {
    if (!activeRouteId) return;
    const res = await fetch(`/api/routes/${activeRouteId}/packages/${pkgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      await loadRouteStatus(activeRouteId);
    }
  }

  async function handlePinMoved(
    pkgId: string,
    lat: number,
    lng: number,
    propagateToFutureCache: boolean
  ) {
    if (!activeRouteId) return;
    await fetch(`/api/routes/${activeRouteId}/packages/${pkgId}/pin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, propagateToFutureCache }),
    });
    await loadRouteStatus(activeRouteId);
  }

  async function handleAddLog(e: React.FormEvent) {
    e.preventDefault();
    if (!activeRouteId || !newLogMsg.trim()) return;
    const res = await fetch(`/api/routes/${activeRouteId}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: newLogMsg.trim() }),
    });
    if (res.ok) {
      setNewLogMsg("");
      await loadRouteStatus(activeRouteId);
    }
  }

  const list1 = packages.filter((p) => p.isActive);
  const list2 = packages.filter((p) => p.isActive && p.inAbsentList);
  const list3 = packages.filter((p) => p.isActive && p.inInsufficientList);
  const list4 = packages.filter((p) => !p.isActive);

  const anchors = stops
    .filter((s) => s.stopType === "anchor")
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder);

  const deliveredList1Count = list1.filter((p) => p.isDelivered).length;

  const googleMapsLegs = useMemo(() => {
    if (!routeDetail || anchors.length === 0) return [];
    return buildGoogleMapsLegLinks({
      depotLat: routeDetail.depotLat,
      depotLng: routeDetail.depotLng,
      anchors,
    });
  }, [routeDetail, anchors]);

  async function handleCopyLegLink(legNumber: number, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLeg(legNumber);
      setTimeout(() => setCopiedLeg((prev) => (prev === legNumber ? null : prev)), 2000);
    } catch {
      setFeedback("Nao foi possivel copiar automaticamente. Use o botao Abrir no Maps.");
    }
  }

  return (
    <div>
      {/* Day selector + create route */}
      <section className="panel">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
              Dia das rotas
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
            />
          </div>

          <form
            onSubmit={handleCreateRoute}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: 1, justifyContent: "flex-end" }}
          >
            <input
              type="text"
              placeholder="Nome da nova rota (ex: Manha Ingleses)"
              value={newRouteName}
              onChange={(e) => setNewRouteName(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", minWidth: 220 }}
            />
            <input
              type="text"
              placeholder="Descricao opcional"
              value={newRouteDesc}
              onChange={(e) => setNewRouteDesc(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", minWidth: 180 }}
            />
            <button type="submit" className="btn-primary">
              + Nova Rota
            </button>
          </form>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          {dayRoutes.length === 0 && (
            <span className="subtitle">Nenhuma rota cadastrada para {selectedDate}.</span>
          )}
          {dayRoutes.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`tab-btn ${r.id === activeRouteId ? "active" : ""}`}
              onClick={() => setActiveRouteId(r.id)}
            >
              {r.name} · {r.status === "completa" ? "Completa" : "Em andamento"}
            </button>
          ))}
        </div>
      </section>

      {routeDetail && (
        <>
          {/* Stale / Async Progress Banner */}
          {(routeDetail.isStale ||
            (latestJob && ["queued", "processing"].includes(latestJob.status))) && (
            <div className="stale-banner" role="status">
              <div>
                {latestJob && ["queued", "processing"].includes(latestJob.status) ? (
                  <>
                    <strong>Calculando rota em segundo plano:</strong> etapa{" "}
                    <code>{latestJob.stage}</code> ({latestJob.processedCount}/
                    {latestJob.totalCount} pacotes). Voce pode fechar o site que o
                    processo continua.
                  </>
                ) : (
                  <>
                    <strong>Rota desatualizada:</strong> ha alteracoes pendentes.
                    Clique para recalcular no Google Maps (Caminho A).
                  </>
                )}
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  latestJob !== null &&
                  ["queued", "processing"].includes(latestJob.status)
                }
                onClick={handleTriggerRecalculate}
              >
                Atualizar Rota
              </button>
            </div>
          )}

          {latestJob?.status === "failed" && latestJob.errorMessage && (
            <div
              className="stale-banner"
              style={{ background: "#fee2e2", color: "#991b1b", borderColor: "#ef4444" }}
            >
              <span>
                <strong>Erro no ultimo calculo:</strong> {latestJob.errorMessage}
              </span>
              <button
                type="button"
                className="btn-primary"
                onClick={handleTriggerRecalculate}
              >
                Tentar novamente
              </button>
            </div>
          )}

          {/* Route Status, Timestamps & Real KM Closing Report */}
          <section className="panel">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>{routeDetail.name}</h2>
                {routeDetail.description && (
                  <p className="subtitle">{routeDetail.description}</p>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={
                    routeDetail.status === "completa" ? "btn-primary" : "tab-btn"
                  }
                  onClick={() =>
                    handlePatchRoute({
                      status:
                        routeDetail.status === "completa"
                          ? "em_andamento"
                          : "completa",
                    })
                  }
                >
                  {routeDetail.status === "completa"
                    ? "Status: Completa (reabrir)"
                    : "Marcar rota como Completa"}
                </button>
                {confirmingDelete ? (
                  <>
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="btn-outline"
                      style={{
                        background: "var(--ar-bg)",
                        color: "var(--ar-ink)",
                        borderColor: "var(--ar-border)",
                        fontWeight: 600,
                      }}
                      onClick={handleDeleteRoute}
                    >
                      Confirmar exclusao
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-outline"
                    style={{ color: "var(--ar-ink)", borderColor: "var(--ar-border)" }}
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Excluir rota
                  </button>
                )}
              </div>
            </div>

            <div className="kpi-grid">
              <div className="kpi-box">
                <div className="kpi-label">KM Previsto / KM Real</div>
                <div className="kpi-value" style={{ fontSize: 17 }}>
                  {routeDetail.predictedKm ?? "--"} km /{" "}
                  <input
                    type="number"
                    step="0.1"
                    value={actualKmDraft}
                    onChange={(e) => setActualKmDraft(e.target.value)}
                    onBlur={() =>
                      handlePatchRoute({
                        actualKm: actualKmDraft
                          ? Number.parseFloat(actualKmDraft)
                          : null,
                      })
                    }
                    placeholder="Real"
                    style={{ width: 72, padding: "2px 6px", fontSize: 14 }}
                  />{" "}
                  km
                </div>
              </div>
              <div className="kpi-box">
                <div className="kpi-label">Tempo Estimado Total</div>
                <div className="kpi-value">
                  {formatEstimatedDuration(routeDetail.predictedDurationSec)}
                </div>
                {formatEstimatedReturn(
                  routeDetail.departedAt,
                  routeDetail.predictedDurationSec
                ) && (
                  <div className="kpi-sub">
                    Prev. retorno ~
                    {formatEstimatedReturn(
                      routeDetail.departedAt,
                      routeDetail.predictedDurationSec
                    )}
                  </div>
                )}
              </div>
              <div className="kpi-box">
                <div className="kpi-label">Pagas (R$ {routeDetail.ratePerPackageBrl})</div>
                <div className="kpi-value">
                  {financials?.billableCount ?? 0} / {list1.length}
                </div>
              </div>
              <div className="kpi-box">
                <div className="kpi-label">Receita Bruta</div>
                <div className="kpi-value">
                  R$ {(financials?.grossRevenueBrl ?? 0).toFixed(2)}
                </div>
              </div>
              <div className="kpi-box">
                <div className="kpi-label">Combustivel ({routeDetail.kmPerLiter} km/L)</div>
                <div className="kpi-value">
                  R${" "}
                  {(
                    financials?.actualFuelCostBrl ??
                    financials?.predictedFuelCostBrl ??
                    0
                  ).toFixed(2)}
                </div>
              </div>
              <div className="kpi-box">
                <div className="kpi-label">Lucro Liquido</div>
                <div className="kpi-value" style={{ color: "var(--teal)" }}>
                  R$ {(financials?.netProfitBrl ?? 0).toFixed(2)}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 14,
                fontSize: 13,
              }}
            >
              <button
                type="button"
                className="tab-btn"
                onClick={() =>
                  handlePatchRoute({ ceeArrivalAt: new Date().toISOString() })
                }
              >
                Chegada CEE:{" "}
                {routeDetail.ceeArrivalAt
                  ? new Date(routeDetail.ceeArrivalAt).toLocaleTimeString("pt-BR")
                  : "Registrar agora"}
              </button>
              <button
                type="button"
                className="tab-btn"
                onClick={() =>
                  handlePatchRoute({ departedAt: new Date().toISOString() })
                }
              >
                Partida:{" "}
                {routeDetail.departedAt
                  ? new Date(routeDetail.departedAt).toLocaleTimeString("pt-BR")
                  : "Registrar agora"}
              </button>
              <button
                type="button"
                className="tab-btn"
                onClick={() =>
                  handlePatchRoute({ returnedAt: new Date().toISOString() })
                }
              >
                Volta CEE:{" "}
                {routeDetail.returnedAt
                  ? new Date(routeDetail.returnedAt).toLocaleTimeString("pt-BR")
                  : "Registrar agora"}
              </button>
            </div>
          </section>

          {/* Interactive Map vs Mobile Field Mode */}
          <section className="panel">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <h2 style={{ margin: 0 }}>
                Mapa Interativo &amp; Modo de Campo ({anchors.length} ancoras)
              </h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {viewMode === "map" && (
                  <div className="tabs" aria-label="Provedor do mapa">
                    <button
                      type="button"
                      className={`tab-btn ${mapProvider === "google" ? "active" : ""}`}
                      onClick={() => selectMapProvider("google")}
                    >
                      Google Maps
                    </button>
                    <button
                      type="button"
                      className={`tab-btn ${mapProvider === "osm" ? "active" : ""}`}
                      onClick={() => selectMapProvider("osm")}
                    >
                      OpenStreetMap
                    </button>
                  </div>
                )}
                <div className="tabs">
                  <button
                    type="button"
                    className={`tab-btn ${viewMode === "map" ? "active" : ""}`}
                    onClick={() => setViewMode("map")}
                  >
                    Mapa Completo
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${viewMode === "field" ? "active" : ""}`}
                    onClick={() => setViewMode("field")}
                  >
                    Modo de Campo (Mobile)
                  </button>
                </div>
              </div>
            </div>

            {viewMode === "map" ? (
              <>
                {mapProvider === "osm" ? (
                  <OpenStreetMapView
                    depotLat={routeDetail.depotLat}
                    depotLng={routeDetail.depotLng}
                    encodedPolyline={routeDetail.polylineEncoded}
                    stops={stops}
                    packages={packages}
                    onPinMoved={handlePinMoved}
                  />
                ) : (
                  <RouteMap
                    depotLat={routeDetail.depotLat}
                    depotLng={routeDetail.depotLng}
                    encodedPolyline={routeDetail.polylineEncoded}
                    stops={stops}
                    packages={packages}
                    onPinMoved={handlePinMoved}
                  />
                )}
                <div className="map-legend">
                  <span className="legend-item">
                    <span className="legend-dot" style={{ background: "#0F172A" }} />
                    CEE (Partida/Retorno)
                  </span>
                  <span className="legend-item">
                    <span className="legend-dot" style={{ background: "#1D4ED8" }} />
                    Ida / Ponto Ancora
                  </span>
                  <span className="legend-item">
                    <span className="legend-dot" style={{ background: "#D97706" }} />
                    Trecho de Volta
                  </span>
                  <span className="legend-item">
                    <span className="legend-dot" style={{ background: "#0D9488" }} />
                    Ponto Adjacente (a pe)
                  </span>
                  <span className="legend-item">
                    <span className="legend-dot" style={{ background: "#DC2626" }} />
                    Encomenda com AR
                  </span>
                </div>

                {googleMapsLegs.length > 0 && (
                  <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                      Links para seguir no Google Maps (celular · ate 10 paradas por trecho)
                    </div>
                    <div className="maps-links-grid">
                      {googleMapsLegs.map((leg) => (
                        <div key={leg.legNumber} className="maps-leg-card">
                          <div>
                            <strong style={{ fontSize: 13 }}>{leg.title}</strong>
                            <div className="subtitle" style={{ marginTop: 2 }}>
                              {leg.stopsRange} ({leg.stopCount} ancoras)
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <a
                              className="btn-accent"
                              href={leg.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Abrir no Maps
                            </a>
                            <button
                              type="button"
                              className="btn-outline"
                              onClick={() => handleCopyLegLink(leg.legNumber, leg.url)}
                            >
                              {copiedLeg === leg.legNumber ? "Copiado!" : "Copiar link"}
                            </button>
                            <a
                              className="btn-outline"
                              href={`https://wa.me/?text=${encodeURIComponent(`${routeDetail.name} - ${leg.title} (${leg.stopsRange}): ${leg.url}`)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              WhatsApp
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div>
                {anchors.length === 0 && (
                  <p className="subtitle">
                    Clique em Atualizar Rota para gerar a sequencia de pontos ancora.
                  </p>
                )}
                {anchors.map((anchor) => {
                  const childStops = stops.filter(
                    (s) => s.parentAnchorId === anchor.id
                  );
                  const groupIds = new Set([
                    anchor.id,
                    ...childStops.map((c) => c.id),
                  ]);
                  const groupPkgs = packages.filter(
                    (p) => p.stopId !== null && groupIds.has(p.stopId)
                  );
                  const hasAr = groupPkgs.some((p) => p.isAr);

                  return (
                    <div
                      key={anchor.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 14,
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <strong>Ancora #{anchor.sequenceOrder}</strong> ·{" "}
                          {anchor.label}{" "}
                          {hasAr && <span className="ar-badge">AR</span>}
                          {childStops.length > 0 && (
                            <span className="subtitle" style={{ marginLeft: 8 }}>
                              (+{childStops.length} adjacente(s) a pe)
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <a
                            className="tab-btn"
                            href={`https://www.google.com/maps/dir/?api=1&destination=${anchor.lat},${anchor.lng}&travelmode=driving`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Maps
                          </a>
                          <a
                            className="tab-btn"
                            href={`https://waze.com/ul?ll=${anchor.lat},${anchor.lng}&navigate=yes`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Waze
                          </a>
                        </div>
                      </div>

                      <div style={{ marginTop: 10 }}>
                        {groupPkgs.map((pkg) => (
                          <div
                            key={pkg.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "6px 0",
                              borderTop: "1px solid #e2e8f0",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <input
                                type="checkbox"
                                checked={pkg.isDelivered}
                                onChange={(e) =>
                                  handlePatchPackage(pkg.id, {
                                    isDelivered: e.target.checked,
                                  })
                                }
                              />
                              <code>{pkg.trackingCode}</code>
                              <span>
                                {pkg.logradouro}, {pkg.numeroRaw ?? "S/N"}
                              </span>
                              {pkg.isAr && <span className="ar-badge">AR</span>}
                            </label>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                type="button"
                                className="tab-btn"
                                onClick={() =>
                                  handlePatchPackage(pkg.id, {
                                    inAbsentList: !pkg.inAbsentList,
                                  })
                                }
                              >
                                {pkg.inAbsentList ? "Remover Ausente" : "Ausente"}
                              </button>
                              <button
                                type="button"
                                className="tab-btn"
                                onClick={() =>
                                  handlePatchPackage(pkg.id, {
                                    inInsufficientList: !pkg.inInsufficientList,
                                  })
                                }
                              >
                                {pkg.inInsufficientList
                                  ? "Remover Insuf."
                                  : "End. Insuf."}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Add packages (manual + bulk) */}
          <section className="panel">
            <h2>Adicionar Encomendas (Range 88010-000 ate 88059-999)</h2>
            {feedback && (
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--primary-dark)" }}>
                {feedback}
              </p>
            )}
            <form
              onSubmit={handleAddManual}
              style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}
            >
              <input
                type="text"
                placeholder="Codigo (ex: AD123456789BR)"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                required
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
              />
              <input
                type="text"
                placeholder="CEP (ex: 88056-300)"
                value={manualCep}
                onChange={(e) => setManualCep(e.target.value)}
                required
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", width: 150 }}
              />
              <input
                type="text"
                placeholder="Numero ou S/N"
                value={manualNum}
                onChange={(e) => setManualNum(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", width: 140 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={manualAr}
                  onChange={(e) => setManualAr(e.target.checked)}
                />
                AR
              </label>
              <button type="submit" className="btn-primary">
                Adicionar Manual
              </button>
            </form>

            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="Ou cole aqui a lista copiada dos Correios (correios-lista.txt)..."
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 10,
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <span className="subtitle">
                Previa: {bulkPreview.stats.totalValid} validas ·{" "}
                {bulkPreview.stats.uniqueAddresses} enderecos unicos ·{" "}
                {bulkPreview.stats.arCount} AR ·{" "}
                {bulkPreview.stats.rejectedCount} rejeitadas
              </span>
              <button
                type="button"
                className="btn-primary"
                disabled={bulkPreview.stats.totalValid === 0}
                onClick={handleAddBulk}
              >
                Importar Lista Colada
              </button>
            </div>
          </section>

          {/* 4 Lists Panel */}
          <section className="panel">
            <h2>Listas da Rota</h2>
            <div className="tabs" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className={`tab-btn ${activeListTab === 1 ? "active" : ""}`}
                onClick={() => setActiveListTab(1)}
              >
                Lista 1 · Ativas ({deliveredList1Count}/{list1.length} entregues)
              </button>
              <button
                type="button"
                className={`tab-btn ${activeListTab === 2 ? "active" : ""}`}
                onClick={() => setActiveListTab(2)}
              >
                Lista 2 · Ausentes ({list2.length})
              </button>
              <button
                type="button"
                className={`tab-btn ${activeListTab === 3 ? "active" : ""}`}
                onClick={() => setActiveListTab(3)}
              >
                Lista 3 · End. Insuf. ({list3.length})
              </button>
              <button
                type="button"
                className={`tab-btn ${activeListTab === 4 ? "active" : ""}`}
                onClick={() => setActiveListTab(4)}
              >
                Lista 4 · Desativadas ({list4.length})
              </button>
            </div>

            {activeListTab === 1 && anchors.length > 0 ? (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                {anchors.map((anchor) => {
                  const anchorPkgs = list1.filter((p) => p.stopId === anchor.id);
                  const childStops = stops.filter(
                    (s) => s.parentAnchorId === anchor.id
                  );
                  const totalGroupCount =
                    anchorPkgs.length +
                    childStops.reduce(
                      (sum, c) =>
                        sum + list1.filter((p) => p.stopId === c.id).length,
                      0
                    );

                  return (
                    <div key={anchor.id} className="field-card" style={{ marginBottom: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          marginBottom: 8,
                        }}
                      >
                        <div>
                          <strong>Ancora #{anchor.sequenceOrder}</strong> ·{" "}
                          {anchor.label}{" "}
                          <span className="sn-badge">
                            {anchorPkgs.length} no ancora · {totalGroupCount} total
                          </span>
                        </div>
                      </div>

                      {anchorPkgs.length > 0 && (
                        <div className="table-scroll">
                          <table style={{ marginTop: 4 }}>
                            <thead>
                              <tr>
                                <th>Objeto</th>
                                <th>CEP</th>
                                <th>Logradouro / Numero</th>
                                <th>AR</th>
                                <th>Acoes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {anchorPkgs.map((pkg) => (
                                <tr key={pkg.id} className={pkg.isDelivered ? "pkg-row-delivered" : undefined}>
                                  <td>
                                    <code className={pkg.isDelivered ? "pkg-delivered-text" : undefined}>
                                      {pkg.trackingCode}
                                    </code>{" "}
                                    {pkg.isDelivered && <span className="delivered-badge">Entregue</span>}
                                  </td>
                                  <td>{formatCep(pkg.cep)}</td>
                                  <td className={pkg.isDelivered ? "pkg-delivered-text" : undefined}>
                                    {pkg.logradouro ?? "-"}, {pkg.numeroRaw ?? "S/N"}
                                  </td>
                                  <td>{pkg.isAr ? <span className="ar-badge">AR</span> : "-"}</td>
                                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    <button
                                      type="button"
                                      className={pkg.isDelivered ? "btn-delivered-done" : "btn-outline"}
                                      onClick={() => handlePatchPackage(pkg.id, { isDelivered: !pkg.isDelivered })}
                                    >
                                      {pkg.isDelivered ? "Entregue ✓" : "Entregue"}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-outline"
                                      onClick={() => handlePatchPackage(pkg.id, { inAbsentList: true })}
                                    >
                                      + Ausente
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-outline"
                                      onClick={() => handlePatchPackage(pkg.id, { inInsufficientList: true })}
                                    >
                                      + End. Insuf.
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-outline"
                                      onClick={() => handlePatchPackage(pkg.id, { isActive: false, autoRecalculate: true })}
                                    >
                                      Desativar &rarr; L4
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {childStops.map((adj) => {
                        const adjPkgs = list1.filter((p) => p.stopId === adj.id);
                        return (
                          <div
                            key={adj.id}
                            style={{
                              marginTop: 12,
                              marginLeft: 14,
                              paddingLeft: 14,
                              borderLeft: "3px solid var(--teal)",
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--teal)" }}>
                              &crarr; Adjacente ({adj.walkDistanceMeters ?? 0}m a pe) ·{" "}
                              <span style={{ color: "var(--ink)" }}>{adj.label}</span>{" "}
                              <span className="sn-badge">{adjPkgs.length} pct</span>
                            </div>
                            <div className="table-scroll">
                              <table style={{ marginTop: 4 }}>
                                <thead>
                                  <tr>
                                    <th>Objeto</th>
                                    <th>CEP</th>
                                    <th>Logradouro / Numero</th>
                                    <th>AR</th>
                                    <th>Acoes</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {adjPkgs.map((pkg) => (
                                    <tr key={pkg.id} className={pkg.isDelivered ? "pkg-row-delivered" : undefined}>
                                      <td>
                                        <code className={pkg.isDelivered ? "pkg-delivered-text" : undefined}>
                                          {pkg.trackingCode}
                                        </code>{" "}
                                        {pkg.isDelivered && <span className="delivered-badge">Entregue</span>}
                                      </td>
                                      <td>{formatCep(pkg.cep)}</td>
                                      <td className={pkg.isDelivered ? "pkg-delivered-text" : undefined}>
                                        {pkg.logradouro ?? "-"}, {pkg.numeroRaw ?? "S/N"}
                                      </td>
                                      <td>{pkg.isAr ? <span className="ar-badge">AR</span> : "-"}</td>
                                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                        <button
                                          type="button"
                                          className={pkg.isDelivered ? "btn-delivered-done" : "btn-outline"}
                                          onClick={() => handlePatchPackage(pkg.id, { isDelivered: !pkg.isDelivered })}
                                        >
                                          {pkg.isDelivered ? "Entregue ✓" : "Entregue"}
                                        </button>
                                        <button
                                          type="button"
                                          className="btn-outline"
                                          onClick={() => handlePatchPackage(pkg.id, { inAbsentList: true })}
                                        >
                                          + Ausente
                                        </button>
                                        <button
                                          type="button"
                                          className="btn-outline"
                                          onClick={() => handlePatchPackage(pkg.id, { inInsufficientList: true })}
                                        >
                                          + End. Insuf.
                                        </button>
                                        <button
                                          type="button"
                                          className="btn-outline"
                                          onClick={() => handlePatchPackage(pkg.id, { isActive: false, autoRecalculate: true })}
                                        >
                                          Desativar &rarr; L4
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {list1.filter((p) => p.stopId === null).length > 0 && (
                  <div className="field-card" style={{ marginBottom: 0 }}>
                    <strong>Aguardando calculo da rota ({list1.filter((p) => p.stopId === null).length} pct)</strong>
                    <div className="table-scroll">
                      <table style={{ marginTop: 6 }}>
                        <thead>
                          <tr>
                            <th>Objeto</th>
                            <th>CEP</th>
                            <th>Logradouro / Numero</th>
                            <th>AR</th>
                            <th>Acoes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list1
                            .filter((p) => p.stopId === null)
                            .map((pkg) => (
                              <tr key={pkg.id} className={pkg.isDelivered ? "pkg-row-delivered" : undefined}>
                                <td>
                                  <code className={pkg.isDelivered ? "pkg-delivered-text" : undefined}>
                                    {pkg.trackingCode}
                                  </code>{" "}
                                  {pkg.isDelivered && <span className="delivered-badge">Entregue</span>}
                                </td>
                                <td>{formatCep(pkg.cep)}</td>
                                <td className={pkg.isDelivered ? "pkg-delivered-text" : undefined}>
                                  {pkg.logradouro ?? "-"}, {pkg.numeroRaw ?? "S/N"}
                                </td>
                                <td>{pkg.isAr ? <span className="ar-badge">AR</span> : "-"}</td>
                                <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    className={pkg.isDelivered ? "btn-delivered-done" : "btn-outline"}
                                    onClick={() => handlePatchPackage(pkg.id, { isDelivered: !pkg.isDelivered })}
                                  >
                                    {pkg.isDelivered ? "Entregue ✓" : "Entregue"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-outline"
                                    onClick={() => handlePatchPackage(pkg.id, { inAbsentList: true })}
                                  >
                                    + Ausente
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-outline"
                                    onClick={() => handlePatchPackage(pkg.id, { inInsufficientList: true })}
                                  >
                                    + End. Insuf.
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-outline"
                                    onClick={() => handlePatchPackage(pkg.id, { isActive: false, autoRecalculate: true })}
                                  >
                                    Desativar &rarr; L4
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Objeto</th>
                      <th>CEP</th>
                      <th>Logradouro / Numero</th>
                      <th>AR</th>
                      <th>Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeListTab === 1
                      ? list1
                      : activeListTab === 2
                        ? list2
                        : activeListTab === 3
                          ? list3
                          : list4
                    ).map((pkg) => (
                      <tr key={pkg.id} className={activeListTab === 1 && pkg.isDelivered ? "pkg-row-delivered" : undefined}>
                        <td>
                          <code className={activeListTab === 1 && pkg.isDelivered ? "pkg-delivered-text" : undefined}>
                            {pkg.trackingCode}
                          </code>{" "}
                          {activeListTab === 1 && pkg.isDelivered && (
                            <span className="delivered-badge">Entregue</span>
                          )}
                        </td>
                        <td>{formatCep(pkg.cep)}</td>
                        <td className={activeListTab === 1 && pkg.isDelivered ? "pkg-delivered-text" : undefined}>
                          {pkg.logradouro ?? "-"}, {pkg.numeroRaw ?? "S/N"}
                        </td>
                        <td>{pkg.isAr ? <span className="ar-badge">AR</span> : "-"}</td>
                        <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {activeListTab === 1 && (
                            <>
                              <button
                                type="button"
                                className={pkg.isDelivered ? "btn-delivered-done" : "btn-outline"}
                                onClick={() => handlePatchPackage(pkg.id, { isDelivered: !pkg.isDelivered })}
                              >
                                {pkg.isDelivered ? "Entregue ✓" : "Entregue"}
                              </button>
                              <button
                                type="button"
                                className="btn-outline"
                                onClick={() => handlePatchPackage(pkg.id, { inAbsentList: true })}
                              >
                                + Ausente
                              </button>
                              <button
                                type="button"
                                className="btn-outline"
                                onClick={() => handlePatchPackage(pkg.id, { inInsufficientList: true })}
                              >
                                + End. Insuf.
                              </button>
                              <button
                                type="button"
                                className="btn-outline"
                                onClick={() => handlePatchPackage(pkg.id, { isActive: false, autoRecalculate: true })}
                              >
                                Desativar &rarr; L4
                              </button>
                            </>
                          )}
                          {activeListTab === 2 && (
                            <button
                              type="button"
                              className="btn-outline"
                              onClick={() => handlePatchPackage(pkg.id, { inAbsentList: false })}
                            >
                              Remover copia
                            </button>
                          )}
                          {activeListTab === 3 && (
                            <button
                              type="button"
                              className="btn-outline"
                              onClick={() => handlePatchPackage(pkg.id, { inInsufficientList: false })}
                            >
                              Remover copia
                            </button>
                          )}
                          {activeListTab === 4 && (
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => handlePatchPackage(pkg.id, { isActive: true, autoRecalculate: true })}
                            >
                              Reativar &rarr; L1
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Occurrence Logs */}
          <section className="panel">
            <h2>Log de Ocorrencias da Rota</h2>
            <form
              onSubmit={handleAddLog}
              style={{ display: "flex", gap: 8, marginBottom: 12 }}
            >
              <input
                type="text"
                placeholder="Ex: Chuva forte nos Ingleses, rua interditada..."
                value={newLogMsg}
                onChange={(e) => setNewLogMsg(e.target.value)}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              />
              <button type="submit" className="btn-primary">
                Registrar
              </button>
            </form>
            <ul>
              {logs.map((log) => (
                <li key={log.id} style={{ marginBottom: 6, fontSize: 14 }}>
                  <strong>
                    {new Date(log.occurredAt).toLocaleTimeString("pt-BR")}
                  </strong>{" "}
                  — {log.message}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
