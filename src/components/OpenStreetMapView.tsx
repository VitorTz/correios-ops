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
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildStopPopupHtml(
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

  const renderPkgRows = (items: MapPackage[]) =>
    items
      .map(
        (pkg) => `
      <li style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px solid #e2e8f0;font-size:12px;">
        <span style="font-family:monospace;font-weight:600;color:${pkg.isDelivered ? "#64748b" : "#0f172a"};${pkg.isDelivered ? "text-decoration:line-through;" : ""}">${escapeHtml(pkg.trackingCode)}</span>
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
          <ul style="list-style:none;margin:4px 0 0;padding:0;">
            ${renderPkgRows(childPkgs)}
          </ul>
        </div>`;
    })
    .join("");

  return `
    <div style="min-width:230px;max-width:300px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
      <div style="font-weight:700;font-size:13px;color:#0f172a;">${escapeHtml(title)}</div>
      <div style="font-size:11.5px;color:#64748b;margin:2px 0 8px;">${escapeHtml(stop.label ?? "")}</div>
      <ul style="list-style:none;margin:0;padding:0;max-height:180px;overflow-y:auto;">
        ${renderPkgRows(directPkgs)}
      </ul>
      ${childrenHtml}
      <div style="display:flex;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:11.5px;">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving" target="_blank" rel="noopener noreferrer" style="color:#1d4ed8;font-weight:600;text-decoration:none;">Google Maps &rarr;</a>
        <a href="https://waze.com/ul?ll=${stop.lat},${stop.lng}&navigate=yes" target="_blank" rel="noopener noreferrer" style="color:#0d9488;font-weight:600;text-decoration:none;">Waze &rarr;</a>
      </div>
    </div>`;
}

/**
 * OpenStreetMap (Leaflet) interactive route map hardened against `_leaflet_pos`:
 * - Stores `onPinMoved` in a ref so parent re-renders (e.g. typing in inputs) never redraw the map
 * - Disables zoom/fade/markerZoom/inertia/autoPan animations that race with React DOM lifecycles
 * - Skips redundant redraws using a data fingerprint and checks container.isConnected before every op
 */
export function OpenStreetMapView({
  depotLat,
  depotLng,
  encodedPolyline,
  stops,
  packages,
  onPinMoved,
}: OpenStreetMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerGroupRef = useRef<import("leaflet").LayerGroup | null>(null);
  const onPinMovedRef = useRef(onPinMoved);
  const lastRenderKeyRef = useRef<string>("");
  const lastFitKeyRef = useRef<string>("");
  const [mapReady, setMapReady] = useState(false);

  const [pendingDrag, setPendingDrag] = useState<{
    pkgId: string;
    trackingCode: string;
    lat: number;
    lng: number;
  } | null>(null);

  useEffect(() => {
    onPinMovedRef.current = onPinMoved;
  }, [onPinMoved]);

  // 1. Initialize Leaflet map ONCE on mount and clean up safely on unmount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || !containerRef.current.isConnected || mapRef.current) {
        return;
      }

      // Clear stale Leaflet internal ID if React StrictMode / Fast Refresh recycled the DOM node
      const containerWithId = containerRef.current as HTMLDivElement & {
        _leaflet_id?: number;
      };
      if (containerWithId._leaflet_id !== undefined) {
        delete containerWithId._leaflet_id;
      }

      const map = L.map(containerRef.current, {
        center: [depotLat, depotLng],
        zoom: 12,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
        inertia: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const layerGroup = L.layerGroup().addTo(map);
      leafletRef.current = L;
      mapRef.current = map;
      layerGroupRef.current = layerGroup;
      lastRenderKeyRef.current = "";
      lastFitKeyRef.current = "";
      setMapReady(true);
    });

    return () => {
      cancelled = true;
      const map = mapRef.current;
      mapRef.current = null;
      layerGroupRef.current = null;
      lastRenderKeyRef.current = "";
      lastFitKeyRef.current = "";
      setMapReady(false);
      if (map) {
        try {
          map.stop();
          map.closePopup();
          map.off();
          map.remove();
        } catch {
          // Ignore teardown errors if DOM node was already detached
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Redraw LayerGroup ONLY when actual route/package data changes
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    const container = containerRef.current;

    if (!mapReady || !L || !map || !layerGroup || !container || !container.isConnected) {
      return;
    }

    const renderKey = JSON.stringify({
      depotLat,
      depotLng,
      encodedPolyline,
      stops: stops.map((s) => [s.id, s.sequenceOrder, s.lat, s.lng, s.walkDistanceMeters]),
      pkgs: packages.map((p) => [p.id, p.stopId, p.isAr, p.isDelivered]),
    });

    if (lastRenderKeyRef.current === renderKey) {
      return;
    }
    lastRenderKeyRef.current = renderKey;

    try {
      map.stop();
      map.closePopup();
      layerGroup.clearLayers();
    } catch {
      return;
    }

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
    })
      .bindPopup("<strong>CEE Correios</strong><br/>Ponto de partida e retorno", {
        autoPan: false,
      })
      .addTo(layerGroup);

    // Outbound (cobalt) & Return (amber) polylines with directional arrows
    if (encodedPolyline) {
      const pts = decodePolyline(encodedPolyline);
      if (pts.length > 1) {
        const splitIndex = Math.max(1, Math.floor(pts.length * 0.78));
        const outbound = pts.slice(0, splitIndex + 1);
        const ret = pts.slice(splitIndex);

        L.polyline(
          outbound.map((p) => [p.lat, p.lng] as [number, number]),
          { color: "#1D4ED8", weight: 4, opacity: 0.9 }
        ).addTo(layerGroup);

        L.polyline(
          ret.map((p) => [p.lat, p.lng] as [number, number]),
          { color: "#D97706", weight: 4, opacity: 0.9 }
        ).addTo(layerGroup);

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
            }).addTo(layerGroup);
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

    const canDrag = Boolean(onPinMovedRef.current);

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

      const groupPkgs = packages.filter(
        (p) => p.stopId !== null && linkedStopIds.has(p.stopId)
      );
      const directPkgs = packages.filter((p) => p.stopId === stop.id);
      const hasAr = groupPkgs.some((p) => p.isAr);
      const popupHtml = buildStopPopupHtml(stop, stops, packages);

      if (stop.stopType === "anchor") {
        const bg = hasAr ? "#DC2626" : "#1D4ED8";
        const icon = L.divIcon({
          className: "",
          html: `<div style="position:relative;width:30px;height:30px;border-radius:999px;background:${bg};color:#FFF;border:2px solid #FFF;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.28);">
            ${stop.sequenceOrder}
            <span style="position:absolute;top:-7px;right:-9px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:#0F172A;color:#FFF;border:1.5px solid #FFF;font-size:9.5px;font-weight:700;display:flex;align-items:center;justify-content:center;">${directPkgs.length}</span>
          </div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });

        const marker = L.marker([stop.lat, stop.lng], {
          icon,
          title: `Ancora #${stop.sequenceOrder} (${directPkgs.length} pct) — ${stop.label ?? ""}`,
          draggable: directPkgs.length === 1 && canDrag,
        })
          .bindPopup(popupHtml, { maxWidth: 320, autoPan: false })
          .addTo(layerGroup);

        if (directPkgs.length === 1 && canDrag) {
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
          ).addTo(layerGroup);

          if (stop.walkDistanceMeters !== null) {
            const midLat = (parent.lat + stop.lat) / 2;
            const midLng = (parent.lng + stop.lng) / 2;
            const distIcon = L.divIcon({
              className: "",
              html: `<div style="display:inline-block;transform:translate(-50%,-50%);background:#FFFFFF;color:#0F766E;border:1px solid #0D9488;border-radius:999px;padding:1px 6px;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.15);">${stop.walkDistanceMeters}m</div>`,
              iconSize: [0, 0],
            });
            L.marker([midLat, midLng], {
              icon: distIcon,
              interactive: false,
            }).addTo(layerGroup);
          }
        }

        const bg = hasAr ? "#DC2626" : "#0D9488";
        const icon = L.divIcon({
          className: "",
          html: `<div style="width:22px;height:22px;border-radius:999px;background:${bg};color:#FFF;border:2px solid #FFF;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,0.25);">${directPkgs.length}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });

        const marker = L.marker([stop.lat, stop.lng], {
          icon,
          title: `Adjacente (${stop.walkDistanceMeters ?? 0}m a pe · ${directPkgs.length} pct) — ${stop.label ?? ""}`,
          draggable: directPkgs.length === 1 && canDrag,
        })
          .bindPopup(popupHtml, { maxWidth: 320, autoPan: false })
          .addTo(layerGroup);

        if (directPkgs.length === 1 && canDrag) {
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

    const fitKey = `${depotLat},${depotLng}|${encodedPolyline ?? ""}|${stops.map((s) => s.id).join(",")}`;
    if (stops.length > 0 && lastFitKeyRef.current !== fitKey) {
      lastFitKeyRef.current = fitKey;
      requestAnimationFrame(() => {
        if (mapRef.current === map && containerRef.current?.isConnected) {
          try {
            map.invalidateSize(false);
            map.fitBounds(bounds, { padding: [40, 40], animate: false });
          } catch {
            // Ignore if unmounted before animation frame
          }
        }
      });
    }
  }, [mapReady, depotLat, depotLng, encodedPolyline, stops, packages]);

  return (
    <div>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: 480,
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "#e2e8f0",
          zIndex: 1,
        }}
      />

      {pendingDrag && onPinMovedRef.current && (
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
                await onPinMovedRef.current?.(
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
                await onPinMovedRef.current?.(
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