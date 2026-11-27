import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { addressCache, routePackages, routes } from "@/db/schema";

const updatePinSchema = z.object({
  lat: z.number().min(-28.0).max(-27.0),
  lng: z.number().min(-49.0).max(-48.0),
  /**
   * Default is false: moving a pin only affects this package inside the current route.
   * When explicitly set to true ("Propagar mudanca"), updates address_cache for future routes only.
   */
  propagateToFutureCache: z.boolean().optional().default(false),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; pkgId: string }> }
) {
  try {
    const { id: routeId, pkgId } = await context.params;
    const body = await request.json();
    const parsed = updatePinSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Coordenadas invalidas", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = getDb();
    const [updatedPkg] = await db
      .update(routePackages)
      .set({
        lat: parsed.data.lat,
        lng: parsed.data.lng,
        isManualPin: true,
        updatedAt: new Date(),
      })
      .where(and(eq(routePackages.id, pkgId), eq(routePackages.routeId, routeId)))
      .returning();

    if (!updatedPkg) {
      return NextResponse.json(
        { error: "Encomenda nao encontrada nesta rota" },
        { status: 404 }
      );
    }

    // Propagate to address_cache ONLY when explicitly requested by the user (affects future routes).
    if (parsed.data.propagateToFutureCache) {
      await db
        .insert(addressCache)
        .values({
          cep: updatedPkg.cep,
          numeroNorm: updatedPkg.numeroNorm,
          logradouro: updatedPkg.logradouro ?? "",
          lat: parsed.data.lat,
          lng: parsed.data.lng,
          isManualOverride: true,
          cachedAt: new Date(),
          expiresAt: null,
        })
        .onConflictDoUpdate({
          target: [addressCache.cep, addressCache.numeroNorm],
          set: {
            lat: parsed.data.lat,
            lng: parsed.data.lng,
            isManualOverride: true,
            cachedAt: new Date(),
            expiresAt: null,
          },
        });
    }

    // Mark current route stale so the user can trigger "Atualizar Rota" when ready.
    await db
      .update(routes)
      .set({ isStale: true, updatedAt: new Date() })
      .where(eq(routes.id, routeId));

    return NextResponse.json({
      package: updatedPkg,
      propagatedToFutureCache: parsed.data.propagateToFutureCache,
      routeIsStale: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
