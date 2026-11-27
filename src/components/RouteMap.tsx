"use client";

import { useEffect, useRef, useState } from "react";
import { Loader } from "@googlemaps/js-api-loader";

export interface MapStop {
  id: string;
  stopType: string; // "anchor" | "adjacent"
  parentAnchorId: string | null;
  sequenceOrder: number;
  walkDistanceMeters: number | null;
  lat: number;
  lng: number;
  label: string | null;
}

export interface MapPackage {
  id: string;
  stopId: string | null;
  trackingCode: string;
  cep: string;
  numeroRaw: string | null;
  logradouro: string | null;
  lat: number | null;
  lng: number | null;
  isAr: boolean;
  isManualPin: boolean;
  isActive: boolean;
  isDelivered: boolean;
  inAbsentList: boolean;
  inInsufficientList: boolean;
}

interface RouteMapProps {
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

export function RouteMap({
  depotLat,
  depotLng,
  encodedPolyline,
  stops,
  packages,
  onPinMoved,
  onToggleDelivered,
}: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [selectedStop, setSelectedStop] = useState<MapStop | null>(null);
  const [pendingDrag, setPendingDrag] = useState<{
    pkgId: string;
    trackingCode: string;
    lat: number;
    lng: number;
  } | null>(null);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey || !mapRef.current) return;

    let cancelled = false;
    const loader = new Loader({
      apiKey,
      version: "weekly",
      libraries: ["geometry"],
    });

    loader.load().then((google) => {
      if (cancelled || !mapRef.current) return;

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: depotLat, lng: depotLng },
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
      });

      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: depotLat, lng: depotLng });

      // CEE Depot marker (Start & End)
      new google.maps.Marker({
        position: { lat: depotLat, lng: depotLng },
        map,
        title: "CEE Correios (Partida e Retorno)",
        label: {
          text: "CEE",
          color: "#FFFFFF",
          fontSize: "11px",
          fontWeight: "700",
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 14,
          fillColor: "#0F172A",
          fillOpacity: 1,
          strokeColor: "#FFFFFF",
          strokeWeight: 2,
        },
      });

      if (encodedPolyline && google.maps.geometry?.encoding) {
        const path = google.maps.geometry.encoding.decodePath(encodedPolyline);
        if (path.length > 1) {
          const splitIndex = Math.max(1, Math.floor(path.length * 0.78));
          const outboundPath = path.slice(0, splitIndex + 1);
          const returnPath = path.slice(splitIndex);

          const arrowSymbol: google.maps.Symbol = {
            path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 3,
            strokeColor: "#FFFFFF",
            fillColor: "#1E3A8A",
            fillOpacity: 1,
          };

          new google.maps.Polyline({
            path: outboundPath,
            map,
            strokeColor: "#1D4ED8",
            strokeOpacity: 0.9,
            strokeWeight: 4,
            icons: [{ icon: arrowSymbol, offset: "24px", repeat: "90px" }],
          });

          new google.maps.Polyline({
            path: returnPath,
            map,
            strokeColor: "#D97706",
            strokeOpacity: 0.9,
            strokeWeight: 4,
            icons: [
              {
                icon: { ...arrowSymbol, fillColor: "#92400E" },
                offset: "24px",
                repeat: "90px",
              },
            ],
          });

          for (const pt of path) bounds.extend(pt);
        }
      }

      const anchorById = new Map(
        stops.filter((s) => s.stopType === "anchor").map((s) => [s.id, s])
      );

      for (const stop of stops) {
        const pos = { lat: stop.lat, lng: stop.lng };
        bounds.extend(pos);

        // Anchor badge turns red if EITHER anchor OR any of its adjacent walking points has an AR package
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
          const marker = new google.maps.Marker({
            position: pos,
            map,
            title: `Ancora #${stop.sequenceOrder} (${stopPkgs.length} pct) — ${stop.label ?? ""}`,
            label: {
              text: String(stop.sequenceOrder),
              color: "#FFFFFF",
              fontSize: "12px",
              fontWeight: "700",
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 13,
              fillColor: hasAr ? "#DC2626" : "#1D4ED8",
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 2,
            },
            draggable: directPkgs.length === 1 && Boolean(onPinMoved),
          });

          marker.addListener("click", () => setSelectedStop(stop));

          if (directPkgs.length === 1 && onPinMoved) {
            marker.addListener("dragend", (ev: google.maps.MapMouseEvent) => {
              if (!ev.latLng) return;
              setPendingDrag({
                pkgId: directPkgs[0].id,
                trackingCode: directPkgs[0].trackingCode,
                lat: ev.latLng.lat(),
                lng: ev.latLng.lng(),
              });
            });
          }
        } else {
          const parent = stop.parentAnchorId
            ? anchorById.get(stop.parentAnchorId)
            : null;
          if (parent) {
            new google.maps.Polyline({
              path: [{ lat: parent.lat, lng: parent.lng }, pos],
              map,
              strokeColor: "#0D9488",
              strokeOpacity: 0,
              icons: [
                {
                  icon: {
                    path: "M 0,-1 0,1",
                    strokeOpacity: 0.9,
                    strokeColor: "#0D9488",
                    scale: 2.5,
                  },
                  offset: "0",
                  repeat: "10px",
                },
              ],
            });
          }

          const marker = new google.maps.Marker({
            position: pos,
            map,
            title: `Adjacente (${stop.walkDistanceMeters ?? 0}m a pe) — ${stop.label ?? ""}`,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: hasAr ? "#DC2626" : "#0D9488",
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 1.5,
            },
            draggable: directPkgs.length === 1 && Boolean(onPinMoved),
          });
          marker.addListener("click", () => setSelectedStop(stop));

          if (directPkgs.length === 1 && onPinMoved) {
            marker.addListener("dragend", (ev: google.maps.MapMouseEvent) => {
              if (!ev.latLng) return;
              setPendingDrag({
                pkgId: directPkgs[0].id,
                trackingCode: directPkgs[0].trackingCode,
                lat: ev.latLng.lat(),
                lng: ev.latLng.lng(),
              });
            });
          }
        }
      }

      if (stops.length > 0) {
        map.fitBounds(bounds, 48);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [depotLat, depotLng, encodedPolyline, stops, packages, onPinMoved]);

  // When an Anchor is selected, show BOTH its own packages AND all linked Adjacent walking packages
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
        ref={mapRef}
        style={{
          width: "100%",
          height: 460,
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "#e2e8f0",
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
              className="tab-btn"
              onClick={() => setPendingDrag(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="tab-btn"
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
                className="tab-btn"
                href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStop.lat},${selectedStop.lng}&travelmode=driving`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Maps
              </a>
              <a
                className="tab-btn"
                href={`https://waze.com/ul?ll=${selectedStop.lat},${selectedStop.lng}&navigate=yes`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Waze
              </a>
              <button
                type="button"
                className="tab-btn"
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
