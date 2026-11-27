import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  cepCache,
  routeJobs,
  routePackages,
  routeStops,
  routes,
} from "@/db/schema";
import { fetchCepWithFallback } from "@/lib/cep";
import { AddressNode, clusterRouteAddresses } from "@/lib/clustering";
import { geocodeAddressWithCache } from "@/lib/google-geocoding";
import { optimizeAnchorRoute } from "@/lib/google-route-optimization";

const GEOCODE_BATCH_SIZE = 10;

export type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>;

const localStepRunner: StepRunner = async (_id, fn) => fn();

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Returns true strictly when IS_PROD is set to "true" (or "1"). */
export function isProdMode(): boolean {
  const raw = (process.env.IS_PROD ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

/**
 * Marks a route_jobs row as failed with the error message.
 */
export async function markJobFailed(jobId: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? "Erro desconhecido");
  const db = getDb();
  await db
    .update(routeJobs)
    .set({
      status: "failed",
      stage: "failed",
      errorMessage: message.slice(0, 1000),
      finishedAt: new Date(),
    })
    .where(eq(routeJobs.id, jobId));
}

/**
 * Shared multi-stage route recalculation pipeline.
 * - On Vercel (IS_PROD=true): receives Inngest's `step.run` for durable serverless steps.
 * - On localhost:3000 (IS_PROD=false): runs asynchronously in the Node process using `localStepRunner`.
 */
export async function executeRecalculateRoute(
  routeId: string,
  jobId: string,
  runStep: StepRunner = localStepRunner
) {
  const context = await runStep("load-route-context", async () => {
    const db = getDb();
    const [route] = await db
      .select()
      .from(routes)
      .where(eq(routes.id, routeId));
    if (!route) throw new Error(`Route ${routeId} not found.`);

    const activePackages = await db
      .select()
      .from(routePackages)
      .where(
        and(
          eq(routePackages.routeId, routeId),
          eq(routePackages.isActive, true)
        )
      );

    await db
      .update(routeJobs)
      .set({
        status: "processing",
        stage: "cep_and_geocoding",
        processedCount: 0,
        totalCount: activePackages.length,
      })
      .where(eq(routeJobs.id, jobId));

    return { route, activePackages };
  });

  if (context.activePackages.length === 0) {
    await runStep("clear-empty-route", async () => {
      const db = getDb();
      await db.delete(routeStops).where(eq(routeStops.routeId, routeId));
      await db
        .update(routes)
        .set({
          predictedKm: "0.00",
          predictedDurationSec: 0,
          polylineEncoded: null,
          isStale: false,
          updatedAt: new Date(),
        })
        .where(eq(routes.id, routeId));
      await db
        .update(routeJobs)
        .set({
          status: "completed",
          stage: "completed",
          finishedAt: new Date(),
        })
        .where(eq(routeJobs.id, jobId));
    });
    return { status: "empty" as const };
  }

  const packagesNeedingGeo = context.activePackages.filter(
    (pkg) => !pkg.isManualPin && (pkg.lat === null || pkg.lng === null)
  );

  const uniqueAddressGroups = new Map<
    string,
    { cep: string; numeroNorm: string; logradouro: string | null; pkgIds: string[] }
  >();

  for (const pkg of packagesNeedingGeo) {
    const key = `${pkg.cep}::${pkg.numeroNorm}`;
    const existing = uniqueAddressGroups.get(key);
    if (existing) {
      existing.pkgIds.push(pkg.id);
    } else {
      uniqueAddressGroups.set(key, {
        cep: pkg.cep,
        numeroNorm: pkg.numeroNorm,
        logradouro: pkg.logradouro,
        pkgIds: [pkg.id],
      });
    }
  }

  const batches = chunkArray(
    Array.from(uniqueAddressGroups.values()),
    GEOCODE_BATCH_SIZE
  );
  let processedSoFar =
    context.activePackages.length - packagesNeedingGeo.length;

  for (let bIdx = 0; bIdx < batches.length; bIdx += 1) {
    const batch = batches[bIdx];
    const newlyProcessed = await runStep(
      `geocode-batch-${bIdx + 1}`,
      async () => {
        const db = getDb();
        let count = 0;

        for (const group of batch) {
          let street = group.logradouro;
          if (!street) {
            const [cachedCep] = await db
              .select()
              .from(cepCache)
              .where(eq(cepCache.cep, group.cep));
            if (cachedCep) {
              street = cachedCep.logradouro;
            } else {
              const fetched = await fetchCepWithFallback(group.cep);
              await db
                .insert(cepCache)
                .values({
                  cep: fetched.cep,
                  logradouro: fetched.logradouro,
                  bairro: fetched.bairro,
                  localidade: fetched.localidade,
                  uf: fetched.uf,
                  source: fetched.source,
                })
                .onConflictDoNothing();
              street = fetched.logradouro;
            }
          }

          const geo = await geocodeAddressWithCache({
            cep: group.cep,
            numeroNorm: group.numeroNorm,
            logradouro: street,
          });

          for (const pkgId of group.pkgIds) {
            await db
              .update(routePackages)
              .set({
                logradouro: street,
                lat: geo.lat,
                lng: geo.lng,
                updatedAt: new Date(),
              })
              .where(eq(routePackages.id, pkgId));
            count += 1;
          }
        }

        await db
          .update(routeJobs)
          .set({
            stage: `geocoding_batch_${bIdx + 1}_of_${batches.length}`,
            processedCount: processedSoFar + count,
          })
          .where(eq(routeJobs.id, jobId));

        return count;
      }
    );
    processedSoFar += newlyProcessed;
  }

  const persistedAnchors = await runStep(
    "cluster-anchor-and-adjacent-stops",
    async () => {
      const db = getDb();
      await db
        .update(routeJobs)
        .set({ stage: "clustering_walk" })
        .where(eq(routeJobs.id, jobId));

      const refreshed = await db
        .select()
        .from(routePackages)
        .where(
          and(
            eq(routePackages.routeId, routeId),
            eq(routePackages.isActive, true)
          )
        );

      const nodeMap = new Map<string, AddressNode>();
      for (const pkg of refreshed) {
        if (pkg.lat === null || pkg.lng === null) continue;
        const key = pkg.isManualPin
          ? `manual::${pkg.id}`
          : `${pkg.cep}::${pkg.numeroNorm}`;
        const existing = nodeMap.get(key);
        if (existing) {
          existing.packageCount += 1;
          existing.packageIds.push(pkg.id);
        } else {
          const numLabel =
            pkg.numeroNorm === "SN" ? "S/N" : (pkg.numeroRaw ?? pkg.numeroNorm);
          nodeMap.set(key, {
            key,
            lat: pkg.lat,
            lng: pkg.lng,
            label: `${pkg.logradouro ?? pkg.cep}, ${numLabel}`,
            packageCount: 1,
            packageIds: [pkg.id],
          });
        }
      }

      const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
      if (!apiKey) {
        throw new Error("GOOGLE_MAPS_SERVER_API_KEY is not configured.");
      }

      const clusters = await clusterRouteAddresses(
        Array.from(nodeMap.values()),
        context.route.walkRadiusMeters,
        apiKey
      );

      await db.delete(routeStops).where(eq(routeStops.routeId, routeId));

      const anchorSummaries: Array<{
        anchorId: string;
        label: string;
        lat: number;
        lng: number;
        packageCount: number;
      }> = [];

      for (let idx = 0; idx < clusters.length; idx += 1) {
        const cluster = clusters[idx];
        const [anchorRow] = await db
          .insert(routeStops)
          .values({
            routeId,
            stopType: "anchor",
            parentAnchorId: null,
            sequenceOrder: idx + 1,
            walkDistanceMeters: 0,
            lat: cluster.anchor.lat,
            lng: cluster.anchor.lng,
            label: cluster.anchor.label,
          })
          .returning();

        for (const pkgId of cluster.anchor.packageIds) {
          await db
            .update(routePackages)
            .set({ stopId: anchorRow.id })
            .where(eq(routePackages.id, pkgId));
        }

        let totalClusterPackages = cluster.anchor.packageCount;

        for (const adj of cluster.adjacents) {
          const [adjRow] = await db
            .insert(routeStops)
            .values({
              routeId,
              stopType: "adjacent",
              parentAnchorId: anchorRow.id,
              sequenceOrder: idx + 1,
              walkDistanceMeters: adj.walkDistanceMeters,
              lat: adj.node.lat,
              lng: adj.node.lng,
              label: adj.node.label,
            })
            .returning();

          for (const pkgId of adj.node.packageIds) {
            await db
              .update(routePackages)
              .set({ stopId: adjRow.id })
              .where(eq(routePackages.id, pkgId));
          }
          totalClusterPackages += adj.node.packageCount;
        }

        anchorSummaries.push({
          anchorId: anchorRow.id,
          label: cluster.anchor.label,
          lat: cluster.anchor.lat,
          lng: cluster.anchor.lng,
          packageCount: totalClusterPackages,
        });
      }

      return anchorSummaries;
    }
  );

  const optimization = await runStep("optimize-anchor-sequence", async () => {
    const db = getDb();
    await db
      .update(routeJobs)
      .set({ stage: "optimizing_drive" })
      .where(eq(routeJobs.id, jobId));

    const result = await optimizeAnchorRoute({
      depotLat: context.route.depotLat,
      depotLng: context.route.depotLng,
      anchors: persistedAnchors,
      kmPerLiter: Number.parseFloat(context.route.kmPerLiter),
      fuelPriceBrl: Number.parseFloat(context.route.fuelPriceBrl),
    });

    for (let seq = 0; seq < result.orderedAnchorIds.length; seq += 1) {
      const anchorId = result.orderedAnchorIds[seq];
      const order = seq + 1;
      await db
        .update(routeStops)
        .set({ sequenceOrder: order })
        .where(eq(routeStops.id, anchorId));
      await db
        .update(routeStops)
        .set({ sequenceOrder: order })
        .where(eq(routeStops.parentAnchorId, anchorId));
    }

    await db
      .update(routes)
      .set({
        predictedKm: result.totalDistanceKm.toFixed(2),
        predictedDurationSec: result.totalDurationSec,
        polylineEncoded: result.encodedPolyline,
        isStale: false,
        updatedAt: new Date(),
      })
      .where(eq(routes.id, routeId));

    await db
      .update(routeJobs)
      .set({
        status: "completed",
        stage: "completed",
        processedCount: context.activePackages.length,
        finishedAt: new Date(),
      })
      .where(eq(routeJobs.id, jobId));

    return result;
  });

  return {
    status: "completed" as const,
    anchorsCount: persistedAnchors.length,
    predictedKm: optimization.totalDistanceKm,
    engineUsed: optimization.engineUsed,
  };
}

/**
 * Dispatches route calculation according to IS_PROD:
 * - IS_PROD=true (Vercel): sends event to Inngest for durable execution.
 * - IS_PROD=false (localhost:3000): runs asynchronously inside the local Node process.
 */
export async function dispatchRouteRecalculation(
  routeId: string,
  jobId: string
): Promise<"inngest" | "local"> {
  if (isProdMode()) {
    const { inngest } = await import("@/inngest/client");
    await inngest.send({
      name: "route/recalculate.requested",
      data: { routeId, jobId },
    });
    return "inngest";
  }

  // Fire-and-forget in local Node.js process (survives browser close while `npm run dev` stays running)
  void executeRecalculateRoute(routeId, jobId).catch(async (err) => {
    console.error("[local-route-calculator] failed:", err);
    await markJobFailed(jobId, err);
  });

  return "local";
}
