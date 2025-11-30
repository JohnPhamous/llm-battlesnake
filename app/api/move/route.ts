import { generateObject } from "ai";
import { z } from "zod";

export const maxDuration = 10; // Function timeout

// Schemas for validation
const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const EliminationReasonSchema = z.enum([
  "self-collision",
  "body-collision",
  "head-to-head-collision",
  "out-of-bounds",
  "starvation",
  "timeout",
  "manual",
]);

const SnakeSchema = z.object({
  id: z.string(),
  name: z
    .string()
    .max(50)
    .regex(
      /^[\w\s-]+$/,
      "Name can only contain letters, numbers, spaces, and hyphens"
    ), // Prevent prompt injection via special chars
  model: z.string(),
  body: z.array(PointSchema),
  health: z.number(),
  color: z.string(),
  status: z.enum(["alive", "eliminated"]),
  eliminationReason: EliminationReasonSchema.optional(),
  length: z.number(),
  latency: z.array(z.number()),
});

const GameStateSchema = z.object({
  id: z.string(),
  turn: z.number(),
  snakes: z.array(SnakeSchema),
  food: z.array(PointSchema),
  width: z.number(),
  height: z.number(),
  isGameOver: z.boolean(),
  winnerId: z.string().optional(),
});

const MoveRequestSchema = z.object({
  gameState: GameStateSchema,
  you: SnakeSchema,
  model: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Validate the request body
    const parseResult = MoveRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return Response.json(
        { error: "Invalid request body", details: parseResult.error },
        { status: 400 }
      );
    }

    const { gameState, you, model: requestModel } = parseResult.data;
    const model = requestModel || "openai/gpt-4o-mini"; // Default to gpt-4o-mini

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
      Goal: Survive longer than all other snakes. You are playing against other snakes in the game Snake.

      --- Rules ---
      1. Movement: You must move one square at a time (up, down, left, right). You cannot move backwards into your own neck.
      2. Survival: Avoid walls, your own body, and other snakes' bodies.
      3. Growing: Eating food (at specific coordinates) increases your length by 1 and resets your health to 100.
      4. Health: Your health decreases by 1 every turn. If it hits 0, you starve and die.
      5. Head-to-Head: If you collide head-to-head with another snake:
         - If you are longer, you survive and they are eliminated.
         - If you are shorter, you are eliminated.
         - If lengths are equal, both are eliminated.
      6. Winning: Be the last snake standing.

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

      Calculate the next move to maximize survival and chances of winning.

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
