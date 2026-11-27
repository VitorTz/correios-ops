import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { recalculateRouteJob } from "@/inngest/functions/recalculate-route";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [recalculateRouteJob],
});
