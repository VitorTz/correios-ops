import { NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { routeJobs, routePackages, routeStops, routes } from "@/db/schema";

/**
 * Lightweight polling endpoint used by the frontend while the async route job runs
 * (and on initial load when the user reopens the site after closing the browser).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
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

    const [latestJob] = await db
      .select()
      .from(routeJobs)
      .where(eq(routeJobs.routeId, routeId))
      .orderBy(desc(routeJobs.startedAt))
      .limit(1);

    const stops = await db
      .select()
      .from(routeStops)
      .where(eq(routeStops.routeId, routeId))
      .orderBy(asc(routeStops.sequenceOrder));

    const packages = await db
      .select()
      .from(routePackages)
      .where(eq(routePackages.routeId, routeId));

    return NextResponse.json({
      route,
      latestJob: latestJob ?? null,
      stops,
      packages,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
