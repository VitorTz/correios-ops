import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { routes } from "@/db/schema";

const patchRouteSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["em_andamento", "completa"]).optional(),
  ceeArrivalAt: z.string().datetime().nullable().optional(),
  departedAt: z.string().datetime().nullable().optional(),
  returnedAt: z.string().datetime().nullable().optional(),
  actualKm: z.number().nonnegative().max(2000).nullable().optional(),
  walkRadiusMeters: z.number().int().min(20).max(1000).optional(),
  kmPerLiter: z.number().positive().max(100).optional(),
  fuelPriceBrl: z.number().nonnegative().max(50).optional(),
  ratePerPackageBrl: z.number().nonnegative().max(100).optional(),
  depotLat: z.number().min(-28.0).max(-27.0).optional(),
  depotLng: z.number().min(-49.0).max(-48.0).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const [route] = await db.select().from(routes).where(eq(routes.id, id));
    if (!route) {
      return NextResponse.json({ error: "Rota nao encontrada" }, { status: 404 });
    }
    return NextResponse.json({ route });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const parsed = patchRouteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Parametros invalidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = getDb();
    const [existing] = await db.select().from(routes).where(eq(routes.id, id));
    if (!existing) {
      return NextResponse.json({ error: "Rota nao encontrada" }, { status: 404 });
    }

    const d = parsed.data;
    const routingParamChanged =
      (d.walkRadiusMeters !== undefined &&
        d.walkRadiusMeters !== existing.walkRadiusMeters) ||
      (d.depotLat !== undefined && d.depotLat !== existing.depotLat) ||
      (d.depotLng !== undefined && d.depotLng !== existing.depotLng);

    const [updated] = await db
      .update(routes)
      .set({
        ...(d.name !== undefined && { name: d.name.trim() }),
        ...(d.description !== undefined && {
          description: d.description ? d.description.trim() : null,
        }),
        ...(d.status !== undefined && { status: d.status }),
        ...(d.ceeArrivalAt !== undefined && {
          ceeArrivalAt: d.ceeArrivalAt ? new Date(d.ceeArrivalAt) : null,
        }),
        ...(d.departedAt !== undefined && {
          departedAt: d.departedAt ? new Date(d.departedAt) : null,
        }),
        ...(d.returnedAt !== undefined && {
          returnedAt: d.returnedAt ? new Date(d.returnedAt) : null,
        }),
        ...(d.actualKm !== undefined && {
          actualKm: d.actualKm !== null ? d.actualKm.toFixed(2) : null,
        }),
        ...(d.walkRadiusMeters !== undefined && {
          walkRadiusMeters: d.walkRadiusMeters,
        }),
        ...(d.kmPerLiter !== undefined && {
          kmPerLiter: d.kmPerLiter.toFixed(2),
        }),
        ...(d.fuelPriceBrl !== undefined && {
          fuelPriceBrl: d.fuelPriceBrl.toFixed(2),
        }),
        ...(d.ratePerPackageBrl !== undefined && {
          ratePerPackageBrl: d.ratePerPackageBrl.toFixed(2),
        }),
        ...(d.depotLat !== undefined && { depotLat: d.depotLat }),
        ...(d.depotLng !== undefined && { depotLng: d.depotLng }),
        ...(routingParamChanged && { isStale: true }),
        updatedAt: new Date(),
      })
      .where(eq(routes.id, id))
      .returning();

    return NextResponse.json({ route: updated });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const [deleted] = await db
      .delete(routes)
      .where(eq(routes.id, id))
      .returning();
    if (!deleted) {
      return NextResponse.json({ error: "Rota nao encontrada" }, { status: 404 });
    }
    return NextResponse.json({ deletedId: deleted.id });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
