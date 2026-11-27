import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { routeLogs } from "@/db/schema";

const createLogSchema = z.object({
  message: z.string().min(2, "Escreva uma ocorrencia").max(1000),
  occurredAt: z.string().datetime().optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: routeId } = await context.params;
    const db = getDb();
    const logs = await db
      .select()
      .from(routeLogs)
      .where(eq(routeLogs.routeId, routeId))
      .orderBy(desc(routeLogs.occurredAt));

    return NextResponse.json({ logs });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: routeId } = await context.params;
    const body = await request.json();
    const parsed = createLogSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Ocorrencia invalida", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = getDb();
    const [created] = await db
      .insert(routeLogs)
      .values({
        routeId,
        message: parsed.data.message.trim(),
        occurredAt: parsed.data.occurredAt
          ? new Date(parsed.data.occurredAt)
          : new Date(),
      })
      .returning();

    return NextResponse.json({ log: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: routeId } = await context.params;
    const { searchParams } = new URL(request.url);
    const logId = searchParams.get("logId");
    if (!logId) {
      return NextResponse.json({ error: "logId obrigatorio" }, { status: 400 });
    }
    const db = getDb();
    await db
      .delete(routeLogs)
      .where(and(eq(routeLogs.id, logId), eq(routeLogs.routeId, routeId)));
    return NextResponse.json({ deletedLogId: logId });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
