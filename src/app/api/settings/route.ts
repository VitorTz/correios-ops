import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { isValidIslandCep, normalizeCep } from "@/lib/cep";

const updateSettingsSchema = z.object({
  depotName: z.string().min(3).max(160).optional(),
  depotCep: z
    .string()
    .transform(normalizeCep)
    .refine(isValidIslandCep, "CEP da base deve estar entre 88010-000 e 88059-999")
    .optional(),
  depotLat: z.number().min(-28.0).max(-27.0).optional(),
  depotLng: z.number().min(-49.0).max(-48.0).optional(),
  walkRadiusMeters: z.number().int().min(20).max(1000).optional(),
  kmPerLiter: z.number().positive().max(100).optional(),
  ratePerPackageBrl: z.number().nonnegative().max(100).optional(),
  fuelPriceBrl: z.number().nonnegative().max(50).optional(),
});

export async function GET() {
  try {
    const db = getDb();
    let [settings] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1));

    if (!settings) {
      [settings] = await db.insert(appSettings).values({ id: 1 }).returning();
    }

    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Parametros invalidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = getDb();
    const data = parsed.data;
    const [updated] = await db
      .insert(appSettings)
      .values({
        id: 1,
        depotName: data.depotName,
        depotCep: data.depotCep,
        depotLat: data.depotLat,
        depotLng: data.depotLng,
        walkRadiusMeters: data.walkRadiusMeters,
        kmPerLiter:
          data.kmPerLiter !== undefined ? data.kmPerLiter.toFixed(2) : undefined,
        ratePerPackageBrl:
          data.ratePerPackageBrl !== undefined
            ? data.ratePerPackageBrl.toFixed(2)
            : undefined,
        fuelPriceBrl:
          data.fuelPriceBrl !== undefined
            ? data.fuelPriceBrl.toFixed(2)
            : undefined,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettings.id,
        set: {
          ...(data.depotName !== undefined && { depotName: data.depotName }),
          ...(data.depotCep !== undefined && { depotCep: data.depotCep }),
          ...(data.depotLat !== undefined && { depotLat: data.depotLat }),
          ...(data.depotLng !== undefined && { depotLng: data.depotLng }),
          ...(data.walkRadiusMeters !== undefined && {
            walkRadiusMeters: data.walkRadiusMeters,
          }),
          ...(data.kmPerLiter !== undefined && {
            kmPerLiter: data.kmPerLiter.toFixed(2),
          }),
          ...(data.ratePerPackageBrl !== undefined && {
            ratePerPackageBrl: data.ratePerPackageBrl.toFixed(2),
          }),
          ...(data.fuelPriceBrl !== undefined && {
            fuelPriceBrl: data.fuelPriceBrl.toFixed(2),
          }),
          updatedAt: new Date(),
        },
      })
      .returning();

    return NextResponse.json({ settings: updated });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
