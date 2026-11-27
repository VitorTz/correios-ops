"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { computeScreenArrowAngle, decodePolyline } from "@/lib/polyline";
import type { MapPackage, MapStop } from "./RouteMap";

interface OpenStreetMapViewProps {
  depotLat: number;
  depotLng: number;
  encodedPolyline: string | null;
  stops: MapStop[];
  packages: MapPackage[];
  onPinMoved?: (
    pkgId: string,
    lat: number,
    lng: number,
    propagateToFutureCache: boolean
  ) => Promise<void>;
  onToggleDelivered?: (pkgId: string, nextVal: boolean) => Promise<void>;
}

/**
 * OpenStreetMap (Leaflet) interactive route map with outbound/return arrows,
 * numbered Anchor pins, dashed Adjacent walking links, AR badges, and draggable pins.
 */
export function OpenStreetMapView({
  depotLat,
  depotLng,
  encodedPolyline,
  stops,
  packages,
  onPinMoved,
  onToggleDelivered,
}: OpenStreetMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selectedStop, setSelectedStop] = useState<MapStop | null>(null);
  const [pendingDrag, setPendingDrag] = useState<{
    pkgId: string;
    trackingCode: string;
    lat: number;
    lng: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let mapInstance: import("leaflet").Map | null = null;

    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [depotLat, depotLng],
        zoom: 12,
      });
      mapInstance = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const bounds = L.latLngBounds([[depotLat, depotLng]]);

      // CEE Depot marker
      const ceeIcon = L.divIcon({
        className: "",
        html: `<div style="width:30px;height:30px;border-radius:999px;background:#0F172A;color:#FFF;border:2px solid #FFF;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.3);">CEE</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      L.marker([depotLat, depotLng], {
        icon: ceeIcon,
        title: "CEE Correios (Partida e Retorno)",
      }).addTo(map);

      // Decode full polyline into Outbound (cobalt) & Return (amber) with directional arrows
      if (encodedPolyline) {
        const pts = decodePolyline(encodedPolyline);
        if (pts.length > 1) {
          const splitIndex = Math.max(1, Math.floor(pts.length * 0.78));
          const outbound = pts.slice(0, splitIndex + 1);
          const ret = pts.slice(splitIndex);

          L.polyline(
            outbound.map((p) => [p.lat, p.lng] as [number, number]),
            { color: "#1D4ED8", weight: 4, opacity: 0.9 }
          ).addTo(map);

          L.polyline(
            ret.map((p) => [p.lat, p.lng] as [number, number]),
            { color: "#D97706", weight: 4, opacity: 0.9 }
          ).addTo(map);

          const addDirectionArrows = (
            segmentPts: Array<{ lat: number; lng: number }>,
            color: string
          ) => {
            const step = Math.max(8, Math.floor(segmentPts.length / 10));
            for (let i = step; i < segmentPts.length - 1; i += step) {
              const angle = computeScreenArrowAngle(
                segmentPts[i - 1],
                segmentPts[i]
              );
              const arrowIcon = L.divIcon({
                className: "",
                html: `<div style="transform:rotate(${angle}deg);color:${color};font-size:13px;font-weight:900;text-shadow:0 0 3px #FFF;line-height:1;">&#9654;</div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7],
              });
              L.marker([segmentPts[i].lat, segmentPts[i].lng], {
                icon: arrowIcon,
                interactive: false,
              }).addTo(map);
            }
          };

          addDirectionArrows(outbound, "#1E3A8A");
          addDirectionArrows(ret, "#92400E");

          for (const p of pts) bounds.extend([p.lat, p.lng]);
        }
      }

      const anchorById = new Map(
        stops.filter((s) => s.stopType === "anchor").map((s) => [s.id, s])
      );

      for (const stop of stops) {
        bounds.extend([stop.lat, stop.lng]);

        const linkedStopIds =
          stop.stopType === "anchor"
            ? new Set([
                stop.id,
                ...stops
                  .filter((s) => s.parentAnchorId === stop.id)
                  .map((s) => s.id),
              ])
            : new Set([stop.id]);

        const stopPkgs = packages.filter(
          (p) => p.stopId !== null && linkedStopIds.has(p.stopId)
        );
        const directPkgs = packages.filter((p) => p.stopId === stop.id);
        const hasAr = stopPkgs.some((p) => p.isAr);

        if (stop.stopType === "anchor") {
          const bg = hasAr ? "#DC2626" : "#1D4ED8";
          const icon = L.divIcon({
            className: "",
            html: `<div style="width:26px;height:26px;border-radius:999px;background:${bg};color:#FFF;border:2px solid #FFF;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.28);">${stop.sequenceOrder}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          });

          const marker = L.marker([stop.lat, stop.lng], {
            icon,
            title: `Ancora #${stop.sequenceOrder} (${stopPkgs.length} pct) — ${stop.label ?? ""}`,
            draggable: directPkgs.length === 1 && Boolean(onPinMoved),
          }).addTo(map);

          marker.on("click", () => setSelectedStop(stop));

          if (directPkgs.length === 1 && onPinMoved) {
            marker.on("dragend", () => {
              const ll = marker.getLatLng();
              setPendingDrag({
                pkgId: directPkgs[0].id,
                trackingCode: directPkgs[0].trackingCode,
                lat: ll.lat,
                lng: ll.lng,
              });
            });
          }
        } else {
          const parent = stop.parentAnchorId
            ? anchorById.get(stop.parentAnchorId)
            : null;
          if (parent) {
            L.polyline(
              [
                [parent.lat, parent.lng],
                [stop.lat, stop.lng],
              ],
              {
                color: "#0D9488",
                weight: 2.5,
                dashArray: "6, 8",
                opacity: 0.9,
              }
            ).addTo(map);
          }

          const bg = hasAr ? "#DC2626" : "#0D9488";
          const icon = L.divIcon({
            className: "",
            html: `<div style="width:14px;height:14px;border-radius:999px;background:${bg};border:2px solid #FFF;box-shadow:0 1px 4px rgba(0,0,0,0.25);"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });

          const marker = L.marker([stop.lat, stop.lng], {
            icon,
            title: `Adjacente (${stop.walkDistanceMeters ?? 0}m a pe) — ${stop.label ?? ""}`,
            draggable: directPkgs.length === 1 && Boolean(onPinMoved),
          }).addTo(map);

          marker.on("click", () => setSelectedStop(stop));

          if (directPkgs.length === 1 && onPinMoved) {
            marker.on("dragend", () => {
              const ll = marker.getLatLng();
              setPendingDrag({
                pkgId: directPkgs[0].id,
                trackingCode: directPkgs[0].trackingCode,
                lat: ll.lat,
                lng: ll.lng,
              });
            });
          }
        }
      }

      if (stops.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    });

    return () => {
      cancelled = true;
      if (mapInstance) {
        mapInstance.remove();
      }
    };
  }, [depotLat, depotLng, encodedPolyline, stops, packages, onPinMoved]);

  const selectedStopGroup = selectedStop
    ? selectedStop.stopType === "anchor"
      ? [
          selectedStop,
          ...stops.filter((s) => s.parentAnchorId === selectedStop.id),
        ]
      : [selectedStop]
    : [];

  return (
    <div>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: 460,
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "#e2e8f0",
          zIndex: 1,
        }}
      />

      {pendingDrag && onPinMoved && (
        <div className="stale-banner" style={{ marginTop: 12 }}>
          <span>
            Pino ajustado para <code>{pendingDrag.trackingCode}</code>. Por
            padrao altera apenas esta rota.
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setPendingDrag(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={async () => {
                await onPinMoved(
                  pendingDrag.pkgId,
                  pendingDrag.lat,
                  pendingDrag.lng,
                  false
                );
                setPendingDrag(null);
              }}
            >
              Salvar so nesta rota
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                await onPinMoved(
                  pendingDrag.pkgId,
                  pendingDrag.lat,
                  pendingDrag.lng,
                  true
                );
                setPendingDrag(null);
              }}
            >
              Salvar e propagar para rotas futuras
            </button>
          </div>
        </div>
      )}

      {selectedStop && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <strong>
                {selectedStop.stopType === "anchor"
                  ? `Ponto Ancora #${selectedStop.sequenceOrder} (Carro + Adjacentes a pe)`
                  : `Ponto Adjacente (${selectedStop.walkDistanceMeters ?? 0}m a pe)`}
              </strong>{" "}
              — {selectedStop.label}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a
                className="btn-outline"
                href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStop.lat},${selectedStop.lng}&travelmode=driving`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Maps
              </a>
              <a
                className="btn-outline"
                href={`https://waze.com/ul?ll=${selectedStop.lat},${selectedStop.lng}&navigate=yes`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Waze
              </a>
              <button
                type="button"
                className="btn-outline"
                onClick={() => setSelectedStop(null)}
              >
                Fechar
              </button>
            </div>
          </div>

          {selectedStopGroup.map((stopItem) => {
            const items = packages.filter((p) => p.stopId === stopItem.id);
            return (
              <div key={stopItem.id} style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                  {stopItem.stopType === "anchor"
                    ? `No ponto ancora: ${stopItem.label}`
                    : `Adjacente (+${stopItem.walkDistanceMeters ?? 0}m a pe): ${stopItem.label}`}
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Entregue</th>
                      <th>Objeto</th>
                      <th>CEP</th>
                      <th>Numero</th>
                      <th>AR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((pkg) => (
                      <tr key={pkg.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={pkg.isDelivered}
                            onChange={(e) =>
                              onToggleDelivered?.(pkg.id, e.target.checked)
                            }
                          />
                        </td>
                        <td>
                          <code>{pkg.trackingCode}</code>
                        </td>
                        <td>{pkg.cep}</td>
                        <td>{pkg.numeroRaw ?? "S/N"}</td>
                        <td>
                          {pkg.isAr ? <span className="ar-badge">AR</span> : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
