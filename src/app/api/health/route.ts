import { NextResponse } from "next/server";
import { SLACK_WEBHOOK_PREFIX } from "@/lib/schemas";

export async function GET(): Promise<Response> {
  const slackEnv = process.env.SLACK_WEBHOOK_URL?.trim() ?? "";
  return NextResponse.json(
    {
      status: "ok",
      version: "0.2.0",
      deterministicOnly: true,
      slackDefaultConfigured: slackEnv.startsWith(SLACK_WEBHOOK_PREFIX),
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
