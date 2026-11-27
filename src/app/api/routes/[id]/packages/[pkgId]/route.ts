import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { routeJobs, routePackages, routes } from "@/db/schema";
import { dispatchRouteRecalculation } from "@/lib/route-calculator";

const updatePackageSchema = z.object({
  inAbsentList: z.boolean().optional(),
  inInsufficientList: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isDelivered: z.boolean().optional(),
  autoRecalculate: z.boolean().optional().default(true),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; pkgId: string }> }
) {
  try {
    const { id: routeId, pkgId } = await context.params;
    const body = await request.json();
    const parsed = updatePackageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Operacao invalida", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(routePackages)
      .where(
        and(eq(routePackages.id, pkgId), eq(routePackages.routeId, routeId))
      );

    if (!existing) {
      return NextResponse.json(
        { error: "Encomenda nao encontrada nesta rota" },
        { status: 404 }
      );
    }

    const d = parsed.data;
    const activeChanged =
      d.isActive !== undefined && d.isActive !== existing.isActive;

    const [updated] = await db
      .update(routePackages)
      .set({
        ...(d.inAbsentList !== undefined && { inAbsentList: d.inAbsentList }),
        ...(d.inInsufficientList !== undefined && {
          inInsufficientList: d.inInsufficientList,
        }),
        ...(d.isActive !== undefined && {
          isActive: d.isActive,
          ...(d.isActive === false ? { stopId: null } : {}),
        }),
        ...(d.isDelivered !== undefined && { isDelivered: d.isDelivered }),
        updatedAt: new Date(),
      })
      .where(eq(routePackages.id, pkgId))
      .returning();

    let triggeredJobId: string | null = null;

    if (activeChanged) {
      await db
        .update(routes)
        .set({ isStale: true, updatedAt: new Date() })
        .where(eq(routes.id, routeId));

      if (d.autoRecalculate) {
        await db
          .update(routeJobs)
          .set({ status: "cancelled", finishedAt: new Date() })
          .where(
            and(
              eq(routeJobs.routeId, routeId),
              inArray(routeJobs.status, ["queued", "processing"])
            )
          );
        const [job] = await db
          .insert(routeJobs)
          .values({ routeId, status: "queued", stage: "queued" })
          .returning();

        await dispatchRouteRecalculation(routeId, job.id);
        triggeredJobId = job.id;
      }
    }

    return NextResponse.json({
      package: updated,
      routeIsStale: activeChanged,
      triggeredJobId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
