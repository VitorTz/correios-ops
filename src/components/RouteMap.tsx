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
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildInfoWindowHtml(
  stop: MapStop,
  allStops: MapStop[],
  packages: MapPackage[]
): string {
  const directPkgs = packages.filter((p) => p.stopId === stop.id);
  const childStops =
    stop.stopType === "anchor"
      ? allStops.filter((s) => s.parentAnchorId === stop.id)
      : [];

  const title =
    stop.stopType === "anchor"
      ? `Ancora #${stop.sequenceOrder} (${directPkgs.length} pct)`
      : `Adjacente (${stop.walkDistanceMeters ?? 0}m a pe · ${directPkgs.length} pct)`;

  const renderRows = (items: MapPackage[]) =>
    items
      .map(
        (pkg) => `
      <li style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px solid #e2e8f0;font-size:12px;">
        <span style="font-family:monospace;font-weight:600;color:#0f172a;">${escapeHtml(pkg.trackingCode)}</span>
        <span style="color:#475569;">${escapeHtml(pkg.numeroRaw ?? "S/N")}${
          pkg.isAr
            ? ' <span style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:999px;padding:1px 5px;font-size:10px;font-weight:700;">AR</span>'
            : ""
        }</span>
      </li>`
      )
      .join("");

  const childrenHtml = childStops
    .map((child) => {
      const childPkgs = packages.filter((p) => p.stopId === child.id);
      return `
        <div style="margin-top:8px;padding-left:8px;border-left:2px solid #0d9488;">
          <div style="font-size:11px;font-weight:600;color:#0f766e;">
            + ${child.walkDistanceMeters ?? 0}m a pe · ${escapeHtml(child.label ?? "")} (${childPkgs.length})
          </div>
          <ul style="list-style:none;margin:4px 0 0;padding:0;">${renderRows(childPkgs)}</ul>
        </div>`;
    })
    .join("");

  return `
    <div style="min-width:220px;max-width:290px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
      <div style="font-weight:700;font-size:13px;color:#0f172a;">${escapeHtml(title)}</div>
      <div style="font-size:11.5px;color:#64748b;margin:2px 0 8px;">${escapeHtml(stop.label ?? "")}</div>
      <ul style="list-style:none;margin:0;padding:0;max-height:180px;overflow-y:auto;">${renderRows(directPkgs)}</ul>
      ${childrenHtml}
      <div style="display:flex;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:11.5px;">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving" target="_blank" rel="noopener noreferrer" style="color:#1d4ed8;font-weight:600;text-decoration:none;">Google Maps &rarr;</a>
        <a href="https://waze.com/ul?ll=${stop.lat},${stop.lng}&navigate=yes" target="_blank" rel="noopener noreferrer" style="color:#0d9488;font-weight:600;text-decoration:none;">Waze &rarr;</a>
      </div>
    </div>`;
}

export function RouteMap({
  depotLat,
  depotLng,
  encodedPolyline,
  stops,
  packages,
  onPinMoved,
}: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
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

      const infoWindow = new google.maps.InfoWindow();
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: depotLat, lng: depotLng });

      // CEE Depot marker
      const ceeMarker = new google.maps.Marker({
        position: { lat: depotLat, lng: depotLng },
        map,
        title: "CEE Correios (Partida e Retorno)",
        label: {
          text: "CEE",
          color: "#FFFFFF",
          fontSize: "10px",
          fontWeight: "700",
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 15,
          fillColor: "#0F172A",
          fillOpacity: 1,
          strokeColor: "#FFFFFF",
          strokeWeight: 2,
        },
      });
      ceeMarker.addListener("click", () => {
        infoWindow.setContent(
          "<strong>CEE Correios</strong><br/>Ponto de partida e retorno"
        );
        infoWindow.open({ map, anchor: ceeMarker });
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

        const linkedStopIds =
          stop.stopType === "anchor"
            ? new Set([
                stop.id,
                ...stops
                  .filter((s) => s.parentAnchorId === stop.id)
                  .map((s) => s.id),
              ])
            : new Set([stop.id]);

        const groupPkgs = packages.filter(
          (p) => p.stopId !== null && linkedStopIds.has(p.stopId)
        );
        const directPkgs = packages.filter((p) => p.stopId === stop.id);
        const hasAr = groupPkgs.some((p) => p.isAr);

        if (stop.stopType === "anchor") {
          const marker = new google.maps.Marker({
            position: pos,
            map,
            title: `Ancora #${stop.sequenceOrder} (${directPkgs.length} pct) — ${stop.label ?? ""}`,
            label: {
              text: `${stop.sequenceOrder}·${directPkgs.length}`,
              color: "#FFFFFF",
              fontSize: "10px",
              fontWeight: "700",
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 16,
              fillColor: hasAr ? "#DC2626" : "#1D4ED8",
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 2,
            },
            draggable: directPkgs.length === 1 && Boolean(onPinMoved),
          });

          marker.addListener("click", () => {
            infoWindow.setContent(buildInfoWindowHtml(stop, stops, packages));
            infoWindow.open({ map, anchor: marker });
          });

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

            if (stop.walkDistanceMeters !== null) {
              new google.maps.Marker({
                position: {
                  lat: (parent.lat + stop.lat) / 2,
                  lng: (parent.lng + stop.lng) / 2,
                },
                map,
                clickable: false,
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 0,
                },
                label: {
                  text: `${stop.walkDistanceMeters}m`,
                  color: "#0F766E",
                  fontSize: "10px",
                  fontWeight: "700",
                },
              });
            }
          }

          const marker = new google.maps.Marker({
            position: pos,
            map,
            title: `Adjacente (${stop.walkDistanceMeters ?? 0}m a pe · ${directPkgs.length} pct) — ${stop.label ?? ""}`,
            label: {
              text: String(directPkgs.length),
              color: "#FFFFFF",
              fontSize: "10px",
              fontWeight: "700",
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 11,
              fillColor: hasAr ? "#DC2626" : "#0D9488",
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 1.5,
            },
            draggable: directPkgs.length === 1 && Boolean(onPinMoved),
          });

          marker.addListener("click", () => {
            infoWindow.setContent(buildInfoWindowHtml(stop, stops, packages));
            infoWindow.open({ map, anchor: marker });
          });

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

  return (
    <div>
      <div
        ref={mapRef}
        style={{
          width: "100%",
          height: 480,
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
    </div>
  );
}
