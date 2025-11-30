"use client";

import React, { useEffect, useRef, useState } from "react";
import { GameEngine } from "@/lib/game/engine";
import { GameState, Move, LogEntry } from "@/lib/game/types";
import { Board } from "./Board";
import { Leaderboard } from "./Leaderboard";

const AVAILABLE_MODELS = [
  "moonshotai/kimi-k2-0905",
  "alibaba/qwen-3-32b",
  "openai/gpt-oss-safeguard-20b",
  "google/gemini-2.0-flash-lite",
];

export interface Model {
  id: string;
  name: string;
}

interface GameProps {
  availableModels?: Model[];
}

// Assign random models to players
const getRandomModels = (count: number, models: string[]) => {
  return Array.from({ length: count }, (_, i) => ({
    id: `snake-${i + 1}`,
    model: models[i],
  }));
};

export function Game({ availableModels = [] }: GameProps) {
  const engine = useRef(new GameEngine());
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [speed] = useState(50);
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [leaderboardData, setLeaderboardData] = useState<
    { model: string; score: number }[]
  >([]);
  const [thinkingSnakes, setThinkingSnakes] = useState<Set<string>>(new Set());
  const [lastLatencies, setLastLatencies] = useState<Record<string, number>>(
    {}
  );

  // const modelIds = React.useMemo(() =>
  //   availableModels.length > 0 ? availableModels.map(m => m.id) : AVAILABLE_MODELS,
  // [availableModels]);

  const fetchLeaderboard = React.useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      if (res.ok) {
        setLeaderboardData(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();

    // Always use AVAILABLE_MODELS for initial state to keep defaults consistent
    // as requested by user. The user can then switch to other models via dropdown.
    const players = getRandomModels(4, AVAILABLE_MODELS);
    engine.current.initializeGame(players);
    setGameState(engine.current.getState());
  }, [fetchLeaderboard]); // Remove modelIds dependency to avoid re-init on prop change if we want stable defaults

  const addLog = (entry: Partial<LogEntry>) => {
    const newLog: LogEntry = {
      id: crypto.randomUUID(),
      turn: engine.current.getState().turn,
      timestamp: Date.now(),
      type: "info",
      message: "",
      ...entry,
    };
    setLogs((prev) => [newLog, ...prev].slice(0, 200));
  };

  const reportResults = React.useCallback(
    async (finalState: GameState) => {
      // Calculate ranks
      const results = finalState.snakes.map((s) => {
        let rank = 2;
        if (finalState.winnerId === s.id) rank = 1;
        else if (s.status === "eliminated") rank = 3;

        return {
          model: s.model,
          rank,
        };
      });

      try {
        await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ results }),
        });
        fetchLeaderboard();
      } catch (e) {
        console.error("Failed to report results", e);
      }
    },
    [fetchLeaderboard]
  );

  const runTurn = React.useCallback(async () => {
    if (isProcessingTurn || !gameState || gameState.isGameOver) {
      if (gameState?.isGameOver) setIsRunning(false);
      return;
    }

    setIsProcessingTurn(true);

    const currentSnakes = gameState.snakes.filter((s) => s.status === "alive");
    setThinkingSnakes(new Set(currentSnakes.map((s) => s.id)));

    const movePromises = currentSnakes.map(async (snake) => {
      const startTime = Date.now();
      try {
        const controller = new AbortController();
        // Allow turn time slightly less than total speed if speed > 1s, else fixed
        // Actually, let's just give them 5s max server side, but abort locally if needed.
        // For UI responsiveness, let's rely on the speed setting to control frequency,
        // but individual moves shouldn't take forever.
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch("/api/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameState, you: snake, model: snake.model }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const endTime = Date.now();
        const latency = endTime - startTime;

        setLastLatencies((prev) => ({ ...prev, [snake.id]: latency }));

        setThinkingSnakes((prev) => {
          const next = new Set(prev);
          next.delete(snake.id);
          return next;
        });

        if (!res.ok) throw new Error("API failed");

        const data = await res.json();
        return {
          snakeId: snake.id,
          direction: data.move,
          reason: data.reason,
          latency,
        } as Move & { reason?: string };
      } catch {
        // console.error(`Snake ${snake.id} failed:`, error);
        setThinkingSnakes((prev) => {
          const next = new Set(prev);
          next.delete(snake.id);
          return next;
        });
        return null;
      }
    });

    const results = await Promise.all(movePromises);
    const validMoves = results.filter(
      (m): m is Move & { reason?: string } => m !== null
    );

    engine.current.nextTurn(validMoves);
    const newState = engine.current.getState();

    // Log moves/events
    validMoves.forEach((m) => {
      const snake = newState.snakes.find((s) => s.id === m.snakeId);
      if (snake) {
        // Log even if dead this turn
        addLog({
          snakeId: snake.id,
          type: "move",
          message: `${snake.name} moved ${m.direction}`,
          data: {
            move: m.direction,
            reason: m.reason,
          },
        });
      }
    });

    newState.snakes.forEach((s) => {
      const oldSnake = gameState.snakes.find((os) => os.id === s.id);
      if (s.status === "eliminated" && oldSnake?.status === "alive") {
        const move = validMoves.find((m) => m.snakeId === s.id);
        addLog({
          snakeId: s.id,
          type: "death",
          message: `${s.name} died: ${s.eliminationReason}`,
          data: {
            eliminationReason: s.eliminationReason,
            reason: move?.reason,
          },
        });
      }
    });

    setGameState(newState);

    if (newState.isGameOver) {
      setIsRunning(false);
      const winner = newState.snakes.find((s) => s.id === newState.winnerId);
      addLog({
        snakeId: winner?.id,
        type: "win",
        message: `Game Over! Winner: ${winner ? winner.name : "None"}`,
        data: { winnerId: newState.winnerId },
      });
      reportResults(newState);
    }
    setIsProcessingTurn(false);
  }, [gameState, isProcessingTurn, reportResults]);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isRunning && gameState && !gameState.isGameOver && !isProcessingTurn) {
      timeout = setTimeout(runTurn, speed);
    }
    return () => clearTimeout(timeout);
  }, [isRunning, gameState, speed, runTurn, isProcessingTurn]);

  const handleModelChange = (snakeId: string, newModel: string) => {
    engine.current.updateSnakeModel(snakeId, newModel);
    setGameState(engine.current.getState());
  };

  if (!gameState) return <div>Loading...</div>;

  return (
    <div className="flex flex-col lg:flex-row gap-2 w-full h-screen p-2 box-border overflow-hidden">
      <div className="flex-1 flex flex-col gap-2 h-full overflow-y-auto">
        {/* Header Controls */}
        <div className="flex flex-wrap justify-between items-center gap-2 bg-zinc-900 p-4 border border-zinc-800 shrink-0">
          <div className="flex flex-col">
            <h2 className="text-zinc-100">LLM BATTLESNAKE</h2>
            <p className="text-zinc-400">
              LLMs control a snake, last snake standing wins. Inspired by{" "}
              <a href="https://play.battlesnake.com/" className="underline">
                Battlesnake
              </a>
              .
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono ml-auto">
            {!gameState.isGameOver ? (
              <button
                className={`px-3 py-1 uppercase ${
                  isRunning
                    ? "bg-yellow-600 hover:bg-yellow-500 text-black"
                    : "bg-green-700 hover:bg-green-500 text-white"
                }`}
                onClick={() => setIsRunning(!isRunning)}
              >
                {isRunning ? "Pause" : "Start Game"}
              </button>
            ) : (
              <button
                className="px-3 py-1 bg-red-900/50 hover:bg-red-900/80 text-red-200 border border-red-900 uppercase"
                onClick={() => {
                  setIsRunning(false);
                  // Reset to default models on restart as well
                  const players = getRandomModels(4, AVAILABLE_MODELS);
                  engine.current = new GameEngine();
                  engine.current.initializeGame(players);
                  setGameState(engine.current.getState());
                  setLogs([]);
                  setLastLatencies({});
                }}
              >
                Restart Game
              </button>
            )}
          </div>
        </div>

        <Board gameState={gameState} />

        {/* Leaderboard */}
        <Leaderboard data={leaderboardData} />
      </div>

      {/* Sidebar */}
      <div className="w-full lg:w-96 flex flex-col gap-0 shrink-0 font-mono h-full border border-zinc-800 bg-zinc-950 overflow-hidden">
        {gameState.snakes.map((snake) => {
          const isThinking = thinkingSnakes.has(snake.id);
          const averageLatency =
            snake.latency && snake.latency.length > 0
              ? Math.round(
                  snake.latency.reduce((a, b) => a + b, 0) /
                    snake.latency.length
                )
              : 0;
          const lastLatency =
            lastLatencies[snake.id] ??
            (snake.latency[snake.latency.length - 1] || 0);

          const snakeLogs = logs.filter((l) => l.snakeId === snake.id);

          return (
            <div
              key={snake.id}
              className="flex flex-col border-b border-zinc-800 last:border-0 flex-1 min-h-0"
            >
              {/* Snake Header */}
              <div
                className={`relative overflow-hidden px-3 py-2 transition-all font-mono ${
                  snake.status === "alive"
                    ? "bg-zinc-900"
                    : "bg-zinc-950 opacity-60 grayscale-[0.5]"
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="size-3 shadow-sm ring-1 ring-white/10"
                      style={{ backgroundColor: snake.color }}
                    />
                    <div>
                      <select
                        className="bg-transparent text-zinc-100 text-sm font-bold border-none focus:ring-0 p-0 cursor-pointer max-w-[260px] truncate"
                        value={snake.model}
                        onChange={(e) =>
                          handleModelChange(snake.id, e.target.value)
                        }
                        disabled={isRunning || snake.status === "eliminated"}
                      >
                        {availableModels.length > 0
                          ? availableModels.map((model) => (
                              <option
                                key={model.id}
                                value={model.id}
                                className="bg-zinc-900 text-zinc-100"
                              >
                                {model.id}
                              </option>
                            ))
                          : AVAILABLE_MODELS.map((m) => (
                              <option
                                key={m}
                                value={m}
                                className="bg-zinc-900 text-zinc-100"
                              >
                                {m}
                              </option>
                            ))}
                      </select>
                    </div>
                  </div>
                  {isThinking && (
                    <div className="text-[10px] text-yellow-500 animate-pulse font-bold uppercase tracking-wider">
                      Thinking...
                    </div>
                  )}
                </div>

                <div className="space-y-0 flex justify-between text-xs">
                  <div className="grid grid-cols-4 gap-3 w-full text-right">
                    <div className="flex flex-col">
                      <span className="text-zinc-500">HEALTH</span>
                      <span className="text-zinc-300">{snake.health}%</span>
                    </div>
                    <div className="flex flex-col">
                      <div className="text-zinc-500 uppercase">Length</div>
                      <div className="text-zinc-200">{snake.length}</div>
                    </div>
                    <div className="flex flex-col">
                      <div className="text-zinc-500 uppercase">LATENCY</div>
                      <div className="text-zinc-200">{lastLatency}ms</div>
                    </div>
                    <div className="flex flex-col">
                      <div className="text-zinc-500 uppercase">AVG LATENCY</div>
                      <div className="text-zinc-200">{averageLatency}ms</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Snake Logs */}
              <div className="flex-1 min-h-0 overflow-y-auto bg-zinc-900/50 p-2 space-y-2 custom-scrollbar border-t border-zinc-800/50">
                {snakeLogs.length === 0 && (
                  <div className="text-zinc-600 text-xs italic text-center py-4">
                    No logs yet
                  </div>
                )}
                {snakeLogs.map((log) => (
                  <div key={log.id} className="text-xs font-mono">
                    <div className="flex gap-2 mb-0.5">
                      <span className="text-zinc-500 text-[10px] pt-0.5">
                        T{log.turn}
                      </span>
                      <span
                        className={`font-bold ${
                          log.type === "death"
                            ? "text-red-400"
                            : log.type === "win"
                            ? "text-yellow-400"
                            : "text-blue-300"
                        }`}
                      >
                        {log.type === "move"
                          ? log.data?.move?.toUpperCase()
                          : log.type.toUpperCase()}
                      </span>
                    </div>
                    {log.data?.reason && (
                      <div className="text-zinc-400 pl-6 text-[11px] leading-tight italic border-l-2 border-zinc-800 ml-1">
                        &quot;{log.data.reason}&quot;
                      </div>
                    )}
                    {log.type === "death" && log.data?.eliminationReason && (
                      <div className="text-red-300 pl-6 text-[11px]">
                        Reason: {log.data.eliminationReason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
