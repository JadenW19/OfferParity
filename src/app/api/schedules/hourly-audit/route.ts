import { handleSchedule } from "@vercel/schedules";
import { runAllActiveWorkspacesAudit } from "@/lib/monitor/hourlyRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = handleSchedule(async (metadata) => {
  const result = await runAllActiveWorkspacesAudit({
    executionId: metadata.executionId,
  });

  console.info(
    `[OfferParity] Hourly schedule ${metadata.name} (${metadata.executionId}): audited ${result.workspacesAudited} workspaces (duplicate=${result.skippedDuplicate})`
  );
});
