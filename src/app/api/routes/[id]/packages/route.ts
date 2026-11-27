import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { cepCache, routePackages, routes } from "@/db/schema";
import {
  fetchCepWithFallback,
  isValidIslandCep,
  normalizeCep,
  normalizeStreetNumber,
} from "@/lib/cep";
import {
  parseCorreiosList,
  RejectedPackageRow,
  TRACKING_CODE_REGEX,
} from "@/lib/correios-parser";

const manualPackageSchema = z.object({
  mode: z.literal("manual"),
  trackingCode: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .refine(
      (v) => TRACKING_CODE_REGEX.test(v),
      "Codigo dos Correios invalido (ex: AD123456789BR)"
    ),
  cep: z
    .string()
    .transform(normalizeCep)
    .refine(
      isValidIslandCep,
      "CEP fora do range da Ilha (88010-000 ate 88059-999)"
    ),
  numero: z.string().optional().nullable(),
  isAr: z.boolean().optional().default(false),
});

const bulkPasteSchema = z.object({
  mode: z.literal("bulk"),
  rawText: z.string().min(5, "Cole pelo menos uma linha de encomenda"),
});

const payloadSchema = z.discriminatedUnion("mode", [
  manualPackageSchema,
  bulkPasteSchema,
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: routeId } = await context.params;
    const body = await request.json();
    const parsed = payloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Entrada invalida", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = getDb();
    const [existingRoute] = await db
      .select()
      .from(routes)
      .where(eq(routes.id, routeId));

    if (!existingRoute) {
      return NextResponse.json({ error: "Rota nao encontrada" }, { status: 404 });
    }

    let rejected: RejectedPackageRow[] = [];
    const itemsToInsert =
      parsed.data.mode === "manual"
        ? [
            {
              trackingCode: parsed.data.trackingCode,
              cep: parsed.data.cep,
              ...normalizeStreetNumber(parsed.data.numero),
              isAr: parsed.data.isAr,
            },
          ]
        : (() => {
            const summary = parseCorreiosList(parsed.data.rawText);
            rejected = summary.rejected;
            return summary.packages;
          })();

    if (itemsToInsert.length === 0) {
      return NextResponse.json(
        {
          error:
            "Nenhuma encomenda valida encontrada no range 88010-000..88059-999.",
          rejected,
        },
        { status: 400 }
      );
    }

    const uniqueCeps = Array.from(new Set(itemsToInsert.map((i) => i.cep)));
    const cachedRows = await db
      .select()
      .from(cepCache)
      .where(inArray(cepCache.cep, uniqueCeps));

    const cepToStreet = new Map<string, string>(
      cachedRows.map((row) => [row.cep, row.logradouro])
    );

    for (const cep of uniqueCeps) {
      if (cepToStreet.has(cep)) continue;
      const lookup = await fetchCepWithFallback(cep);
      await db
        .insert(cepCache)
        .values({
          cep: lookup.cep,
          logradouro: lookup.logradouro,
          bairro: lookup.bairro,
          localidade: lookup.localidade,
          uf: lookup.uf,
          source: lookup.source,
        })
        .onConflictDoNothing();
      cepToStreet.set(cep, lookup.logradouro);
    }

    const inserted = await db
      .insert(routePackages)
      .values(
        itemsToInsert.map((item) => ({
          routeId,
          trackingCode: item.trackingCode,
          cep: item.cep,
          numeroRaw: item.numeroRaw,
          numeroNorm: item.numeroNorm,
          logradouro: cepToStreet.get(item.cep) ?? null,
          isAr: item.isAr,
          isActive: true,
        }))
      )
      .onConflictDoNothing()
      .returning();

    if (inserted.length > 0) {
      await db
        .update(routes)
        .set({ isStale: true, updatedAt: new Date() })
        .where(eq(routes.id, routeId));
    }

    return NextResponse.json(
      {
        insertedCount: inserted.length,
        skippedDuplicatesCount: itemsToInsert.length - inserted.length,
        rejected,
        routeIsStale: inserted.length > 0 ? true : existingRoute.isStale,
        packages: inserted,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
