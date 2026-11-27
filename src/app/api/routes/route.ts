import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { appSettings, routes } from "@/db/schema";

const createRouteSchema = z.object({
  routeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato YYYY-MM-DD"),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
  ceeArrivalAt: z.string().datetime().optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const routeDate = searchParams.get("date");
    const db = getDb();

    const list = routeDate
      ? await db
          .select()
          .from(routes)
          .where(eq(routes.routeDate, routeDate))
          .orderBy(desc(routes.createdAt))
      : await db.select().from(routes).orderBy(desc(routes.routeDate), desc(routes.createdAt)).limit(50);

    return NextResponse.json({ routes: list });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createRouteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados invalidos para criar rota", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = getDb();
    let [settings] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1));

    if (!settings) {
      [settings] = await db.insert(appSettings).values({ id: 1 }).returning();
    }

    const [created] = await db
      .insert(routes)
      .values({
        routeDate: parsed.data.routeDate,
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
        status: "em_andamento",
        isStale: false,
        depotLat: settings.depotLat,
        depotLng: settings.depotLng,
        walkRadiusMeters: settings.walkRadiusMeters,
        kmPerLiter: settings.kmPerLiter,
        ratePerPackageBrl: settings.ratePerPackageBrl,
        fuelPriceBrl: settings.fuelPriceBrl,
        ceeArrivalAt: parsed.data.ceeArrivalAt
          ? new Date(parsed.data.ceeArrivalAt)
          : null,
      })
      .returning();

    return NextResponse.json({ route: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
