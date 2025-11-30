import { gateway, generateObject } from "ai";
import { z } from "zod";
import { MoveRequest } from "@/lib/game/types";

export const maxDuration = 10; // Function timeout

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { gameState, you } = body as MoveRequest;
    const model = body.model || "openai/gpt-4o-mini"; // Default to gpt-4o-mini

    // Calculate relative directions and immediate hazards for better context
    const head = you.body[0];
    const neck = you.body[1]; // The segment right after head - moving here is instant death

    const formatPoint = (p: { x: number; y: number }) => `(${p.x},${p.y})`;

    // Pre-calculate valid moves to give explicit hints
    const possibleMoves = [
      { dir: "up", x: head.x, y: head.y - 1 },
      { dir: "down", x: head.x, y: head.y + 1 },
      { dir: "left", x: head.x - 1, y: head.y },
      { dir: "right", x: head.x + 1, y: head.y },
    ];

    const isSafe = (p: { x: number; y: number }) => {
      // Walls
      if (
        p.x < 0 ||
        p.x >= gameState.width ||
        p.y < 0 ||
        p.y >= gameState.height
      )
        return false;

      // Own Body (including neck, excluding tail which moves)
      const myBody = you.body.slice(0, -1);
      if (myBody.some((b) => b.x === p.x && b.y === p.y)) return false;

      // Other Snakes
      const otherBodies = gameState.snakes
        .filter((s) => s.id !== you.id && s.status === "alive")
        .flatMap((s) => s.body.slice(0, -1)); // Exclude their tails too as they move
      if (otherBodies.some((b) => b.x === p.x && b.y === p.y)) return false;

      return true;
    };

    const safeMoves = possibleMoves.filter((m) => isSafe(m)).map((m) => m.dir);

    const prompt = `
      Role: You are a strategic Snake game agent.
      Goal: Survive longer than all other snakes.

      --- Game State ---
      Board: ${gameState.width}x${gameState.height} grid.
      You: "${you.name}" (Health: ${you.health}, Length: ${you.length}).
      Head: ${formatPoint(head)}.
      Neck: ${neck ? formatPoint(neck) : "None"}.
      Body: ${JSON.stringify(you.body.map(formatPoint))}.

      Visible Hazards:
      - Walls: x<0, x>=${gameState.width}, y<0, y>=${gameState.height}
      - Opponents:
        ${
          gameState.snakes
            .filter((s) => s.id !== you.id && s.status === "alive")
            .map(
              (s) =>
                `- "${s.name}" (Len: ${s.length}): ${JSON.stringify(
                  s.body.map(formatPoint)
                )}`
            )
            .join("\n        ") || "None (You are the last survivor!)"
        }

      Food Locations: ${JSON.stringify(gameState.food.map(formatPoint))}.

      --- Analysis ---
      Valid Safe Moves from ${formatPoint(head)}: [${safeMoves.join(", ")}]
      (Moving backwards into neck ${
        neck ? formatPoint(neck) : ""
      } is always fatal).

      --- Strategy ---
      1. SAFETY (Priority #1): ONLY choose from Valid Safe Moves.
      2. AGGRESSION & GROWTH (Priority #2):
         - If you are larger than a nearby opponent, hunt them! Cut them off or collide Head-to-Head to eliminate them.
         - Eat food aggressively to maintain size advantage, even if health is high.
      3. TRAPPING: Box opponents in against walls or other snakes to force them to crash.
      4. CAUTION: Only avoid Head-to-Head collisions if the opponent is LARGER or EQUAL size.

      BE AGGRESSIVE. Do not just wander aimlessly.

      Calculate the next move.

      Response Format (JSON):
      {
        "move": "up" | "down" | "left" | "right",
        "reason": "Concise strategic justification"
      }
    `;

    const { object } = await generateObject({
      model: model,
      mode: "json",
      schema: z.object({
        move: z.enum(["up", "down", "left", "right"]),
        reason: z.string().describe("Short reasoning for the move"),
      }),
      providerOptions: {
        gateway: {},
      },
      prompt,
      temperature: 0.1,
    });

    return Response.json(object);
  } catch (error) {
    console.error("LLM Error:", error);
    // Fallback logic if object generation failed but text might exist?
    // For now just return error
    return Response.json({ error: "Failed to generate move" }, { status: 500 });
  }
}
