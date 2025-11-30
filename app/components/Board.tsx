import React from 'react';
import { GameState, Point } from '@/lib/game/types';

interface BoardProps {
  gameState: GameState;
}

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
    if (food.some(f => f.x === x && f.y === y)) {
      return <div className="w-full h-full rounded-full bg-red-500 animate-pulse" />;
    }

    // Check snakes
    for (const snake of snakes) {
      if (snake.status === 'eliminated') continue; // Or show dead body? usually removed.

      const bodyIndex = snake.body.findIndex(p => p.x === x && p.y === y);
      if (bodyIndex !== -1) {
        const isHead = bodyIndex === 0;
        return (
          <div
            className={`w-full h-full ${isHead ? 'rounded-sm z-10' : 'rounded-sm'}`}
            style={{ backgroundColor: snake.color, opacity: isHead ? 1 : 0.8 }}
          >
            {isHead && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-1 h-1 bg-black rounded-full mx-[1px]" />
                <div className="w-1 h-1 bg-black rounded-full mx-[1px]" />
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
      className="grid gap-[1px] bg-zinc-800 p-1 rounded-lg border border-zinc-700"
      style={{
        gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
        width: '100%',
        aspectRatio: `${width}/${height}`
      }}
    >
      {grid.map((row, y) => (
        <React.Fragment key={y}>
          {row.map((cell, x) => (
            <div
              key={`${x}-${y}`}
              className="bg-zinc-900 relative aspect-square overflow-hidden rounded-[2px]"
            >
              {getCellContent(x, y)}
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}
