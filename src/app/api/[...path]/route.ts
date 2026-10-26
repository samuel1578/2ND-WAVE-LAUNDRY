import { NextResponse } from "next/server";
// This catch-all route exists only for API paths that are not implemented yet.
// Review submissions now use /api/reviews, so this route is deliberately inert.
export async function POST() {
  return NextResponse.json(
    {
      code: "method_not_allowed",
      message: "This endpoint does not accept submissions.",
    },
    { status: 405, headers: { "Cache-Control": "no-store", Allow: "POST" } },
  );
}
