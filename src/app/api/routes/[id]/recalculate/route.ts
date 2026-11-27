import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { routeJobs, routes } from "@/db/schema";
import {
  dispatchRouteRecalculation,
  markJobFailed,
} from "@/lib/route-calculator";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  let createdJobId: string | null = null;
  try {
    const { id: routeId } = await context.params;
    const db = getDb();

    const [route] = await db
      .select()
      .from(routes)
      .where(eq(routes.id, routeId));

    if (!route) {
      return NextResponse.json({ error: "Rota nao encontrada" }, { status: 404 });
    }

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
      .values({
        routeId,
        status: "queued",
        stage: "queued",
      })
      .returning();

    createdJobId = job.id;

    const runner = await dispatchRouteRecalculation(routeId, job.id);

    return NextResponse.json(
      {
        jobId: job.id,
        status: "queued",
        runner,
      },
      { status: 202 }
    );
  } catch (error) {
    if (createdJobId) {
      await markJobFailed(createdJobId, error).catch(() => {});
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
