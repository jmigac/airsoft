import { NextResponse } from "next/server";
import { normalizeGameCode } from "@/lib/game-code";
import { isValidQuestPayload } from "@/lib/payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ payload: string }> }
) {
  const params = await context.params;
  const decodedPayload = safeDecode(params.payload);
  const visiblePayload = isValidQuestPayload(decodedPayload) ? decodedPayload : "------";
  const requestUrl = new URL(request.url);
  const gameCode = normalizeGameCode(requestUrl.searchParams.get("game"));
  const returnHref = gameCode ? `/?game=${encodeURIComponent(gameCode)}` : "/";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PIN</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
      }
      body {
        min-height: 100dvh;
        display: grid;
        place-items: center;
        background: #f6f3ea;
        color: #111;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }
      .pin-page {
        width: min(96vw, 900px);
        display: grid;
        justify-items: center;
        gap: 1.25rem;
        text-align: center;
      }
      h1 {
        margin: 0;
        font-size: clamp(4rem, 16vw, 9rem);
        line-height: 1;
        letter-spacing: 0.25em;
        font-variant-numeric: tabular-nums;
      }
      .back-home {
        display: inline-block;
        text-decoration: none;
        font-weight: 700;
        font-size: 0.95rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #111;
        border: 2px solid #111;
        border-radius: 999px;
        padding: 0.5rem 1rem;
        background: #fff8e8;
      }
      .back-home:active {
        transform: translateY(1px);
      }
    </style>
  </head>
  <body>
    <main class="pin-page">
      <h1>${escapeHtml(visiblePayload)}</h1>
      <a class="back-home" href="${escapeHtml(returnHref)}">Return to Home</a>
    </main>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
