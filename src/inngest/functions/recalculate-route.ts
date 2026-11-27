import {
  executeRecalculateRoute,
  markJobFailed,
} from "@/lib/route-calculator";
import { inngest } from "../client";

/**
 * Production durable workflow invoked by Inngest on Vercel (IS_PROD=true).
 * Delegates all business logic to the shared `executeRecalculateRoute` pipeline.
 */
export const recalculateRouteJob = inngest.createFunction(
  {
    id: "recalculate-route",
    retries: 2,
    cancelOn: [
      {
        event: "route/recalculate.requested",
        match: "data.routeId",
      },
    ],
    onFailure: async ({ event, error }) => {
      const originalData = event.data.event?.data as
        | { routeId?: string; jobId?: string }
        | undefined;
      if (!originalData?.jobId) return;
      await markJobFailed(originalData.jobId, error);
    },
  },
  { event: "route/recalculate.requested" },
  async ({ event, step }) => {
    const { routeId, jobId } = event.data as { routeId: string; jobId: string };
    return executeRecalculateRoute(routeId, jobId, (id, fn) =>
      step.run(id, fn)
    );
  }
);
