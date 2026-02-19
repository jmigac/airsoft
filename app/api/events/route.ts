import { NextRequest, NextResponse } from "next/server";
import { onState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { readState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  const gameCode = game.gameCode;
  let initialState;
  try {
    initialState = await readState(gameCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Game not found.";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  const encoder = new TextEncoder();
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: () => void = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      send({ type: "connected" });
      send({ type: "sync", state: initialState });

      unsubscribe = onState(gameCode, (event) => {
        send({ type: event.type, state: event.state });
      });

      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 20000);
    },
    cancel() {
      if (keepAlive) {
        clearInterval(keepAlive);
      }
      unsubscribe();
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
