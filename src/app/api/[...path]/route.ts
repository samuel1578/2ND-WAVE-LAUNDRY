import { NextResponse } from "next/server";
// Intentionally fail closed. Implement authenticated, validated adapters here in the backend phase.
export async function POST() {
  return NextResponse.json(
    {
      code: "BACKEND_NOT_CONFIGURED",
      message: "Online submissions are not active. Contact the team directly.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
