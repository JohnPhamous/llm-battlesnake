import React from "react";

interface LeaderboardProps {
  data: { model: string; score: number }[];
}

export function Leaderboard({ data }: LeaderboardProps) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 px-3 py-2 font-mono">
      <h3 className="font-bold mb-4 text-zinc-100 uppercase tracking-wider text-xs">
        Leaderboard
      </h3>
      <div className="space-y-2">
        {data.length === 0 ? (
          <div className="text-zinc-500 italic text-sm">
            No games played yet.
          </div>
        ) : (
          data.map((entry, i) => (
            <div
              key={entry.model}
              className="flex justify-between items-center text-sm p-2 bg-zinc-950/50 rounded"
            >
              <div className="flex items-center gap-3">
                <span className="text-zinc-500 w-4">#{i + 1}</span>
                <span className="text-zinc-200 font-bold">{entry.model}</span>
              </div>
              <span className="text-yellow-500 font-bold">{entry.score}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
