import React from "react";
import { GameState } from "@/lib/game/types";

interface BoardProps {
  gameState: GameState;
}

const MODEL_TO_KEY_MAP = {
  alibaba: "alibaba cloud",
};

const getProviderLogo = (model: string) => {
  const provider = model.split("/")[0];
  // Use map if exists, otherwise fallback to provider
  const logoProvider =
    (MODEL_TO_KEY_MAP as Record<string, string>)[provider] ||
    (provider === "xai" ? "xai" : provider);
  return `https://7nyt0uhk7sse4zvn.public.blob.vercel-storage.com/docs-assets/static/docs/ai-gateway/logos/${logoProvider}.png`;
};

export function Board({ gameState }: BoardProps) {
  const { width, height, snakes, food } = gameState;

  // Create grid
  const grid = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push({ x, y });
    }
    grid.push(row);
  }

  const getCellContent = (x: number, y: number) => {
    // Check food
    if (food.some((f) => f.x === x && f.y === y)) {
      return (
        <div className="size-full ___rounded--full bg-[#F13342] animate-pulse"></div>
      );
    }

    // Check snakes
    for (const snake of snakes) {
      if (snake.status === "eliminated") continue;

      const bodyIndex = snake.body.findIndex((p) => p.x === x && p.y === y);
      if (bodyIndex !== -1) {
        const isHead = bodyIndex === 0;
        return (
          <div
            className={`w-full h-full ${
              isHead ? "___rounded--sm z-10" : "___rounded--sm"
            } relative`}
            style={{ backgroundColor: snake.color, opacity: isHead ? 1 : 0.8 }}
          >
            {isHead && (
              <div
                className="absolute inset-0 flex items-center justify-center p-[2px] bg-white/90 ___rounded--sm overflow-hidden"
                style={{
                  backgroundColor: snake.color,
                  opacity: isHead ? 1 : 0.8,
                }}
              >
                <div className="size-1/2 rounded--full overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getProviderLogo(snake.model)}
                    alt={snake.model}
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            )}
          </div>
        );
      }
    }
    return null;
  };

  return (
    <div
      className="grid gap-px bg-zinc-800 ___rounded--lg border border-zinc-800"
      style={{
        gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
        width: "100%",
        aspectRatio: `${width}/${height}`,
      }}
    >
      {grid.map((row, y) => (
        <React.Fragment key={y}>
          {row.map((cell, x) => (
            <div
              key={`${x}-${y}`}
              className="bg-zinc-900 relative aspect-square overflow-hidden ___rounded--[2px]"
            >
              {getCellContent(x, y)}
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}
