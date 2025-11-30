'use client';

import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from '@/lib/game/engine';
import { GameState, Move } from '@/lib/game/types';
import { Board } from './Board';
import { Leaderboard } from './Leaderboard';

const AVAILABLE_MODELS = [
  'moonshotai/kimi-k2-0905',
  'alibaba/qwen-3-32b'
];

// Assign random models to players
const getRandomModels = (count: number) => {
  return Array.from({ length: count }, (_, i) => ({
    id: `snake-${i + 1}`,
    model: AVAILABLE_MODELS[Math.floor(Math.random() * AVAILABLE_MODELS.length)]
  }));
};

export function Game() {
  const engine = useRef(new GameEngine());
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [speed, setSpeed] = useState(500);
  const [isProcessingTurn, setIsProcessingTurn] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [leaderboardData, setLeaderboardData] = useState<{ model: string; score: number }[]>([]);

  const fetchLeaderboard = React.useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard');
      if (res.ok) {
        setLeaderboardData(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();

    const players = getRandomModels(4);
    engine.current.initializeGame(players);
    setGameState(engine.current.getState());
  }, [fetchLeaderboard]);

  const addLog = (msg: string) => {
    setLogs(prev => [`[Turn ${engine.current.getState().turn}] ${msg}`, ...prev].slice(0, 50));
  };

  const reportResults = React.useCallback(async (finalState: GameState) => {
    // Calculate ranks
    const results = finalState.snakes.map(s => {
      let rank = 2;
      if (finalState.winnerId === s.id) rank = 1;
      else if (s.status === 'eliminated') rank = 3;

      return {
        model: s.model,
        rank
      };
    });

    try {
      await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results })
      });
      fetchLeaderboard();
    } catch (e) {
      console.error('Failed to report results', e);
    }
  }, [fetchLeaderboard]);

  const runTurn = React.useCallback(async () => {
    if (isProcessingTurn || !gameState || gameState.isGameOver) {
      if (gameState?.isGameOver) setIsRunning(false);
      return;
    }

    setIsProcessingTurn(true);

    const currentSnakes = gameState.snakes.filter(s => s.status === 'alive');

    const movePromises = currentSnakes.map(async (snake) => {
      try {
        const controller = new AbortController();
        // Allow turn time slightly less than total speed if speed > 1s, else fixed
        // Actually, let's just give them 5s max server side, but abort locally if needed.
        // For UI responsiveness, let's rely on the speed setting to control frequency,
        // but individual moves shouldn't take forever.
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch('/api/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameState, you: snake, model: snake.model }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!res.ok) throw new Error('API failed');

        const data = await res.json();
        return { snakeId: snake.id, direction: data.move, reason: data.reason } as Move & { reason?: string };
      } catch {
        // console.error(`Snake ${snake.id} failed:`, error);
        return null;
      }
    });

    const results = await Promise.all(movePromises);
    const validMoves = results.filter((m): m is Move & { reason?: string } => m !== null);

    engine.current.nextTurn(validMoves);
    const newState = engine.current.getState();

    // Log moves/events
    validMoves.forEach(m => {
      const snake = newState.snakes.find(s => s.id === m.snakeId);
      if (snake && snake.status === 'alive') {
        addLog(`${snake.name}: ${m.direction} ${m.reason ? `(${m.reason})` : ''}`);
      }
    });

    newState.snakes.forEach(s => {
      const oldSnake = gameState.snakes.find(os => os.id === s.id);
      if (s.status === 'eliminated' && oldSnake?.status === 'alive') {
        addLog(`${s.name} died: ${s.eliminationReason}`);
      }
    });

    setGameState(newState);

    if (newState.isGameOver) {
      setIsRunning(false);
      const winner = newState.snakes.find(s => s.id === newState.winnerId);
      addLog(`Game Over! Winner: ${winner ? winner.name : 'None'}`);
      reportResults(newState);
    }
    setIsProcessingTurn(false);
  }, [gameState, isProcessingTurn, reportResults]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRunning && gameState && !gameState.isGameOver && !isProcessingTurn) {
      interval = setInterval(runTurn, speed);
    }
    return () => clearInterval(interval);
  }, [isRunning, gameState, speed, runTurn, isProcessingTurn]);

  if (!gameState) return <div>Loading...</div>;

  return (
    <div className="flex flex-col lg:flex-row gap-8 w-full">
      <div className="flex-1 flex flex-col gap-4">
        {/* Header Controls */}
        <div className="flex flex-wrap justify-between items-center gap-4 bg-zinc-900 p-4 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold font-mono text-zinc-100">
              TURN <span className="text-blue-400">{gameState.turn.toString().padStart(3, '0')}</span>
            </h2>
            <div className="h-8 w-px bg-zinc-700"></div>
            <div className="text-sm text-zinc-400 flex items-center gap-2">
              Speed:
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
              >
                <option value={5000}>Normal (5s)</option>
                <option value={1000}>Slow (1s)</option>
                <option value={500}>Normal (0.5s)</option>
                <option value={200}>Fast (0.2s)</option>
                <option value={50}>Turbo (0.05s)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className={`px-6 py-2 rounded font-bold transition-all ${
                isRunning
                  ? 'bg-yellow-600 hover:bg-yellow-500 text-black'
                  : 'bg-green-600 hover:bg-green-500 text-white'
              }`}
              onClick={() => setIsRunning(!isRunning)}
              disabled={gameState.isGameOver}
            >
              {isRunning ? 'PAUSE' : 'START GAME'}
            </button>
            <button
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 border border-zinc-700 disabled:opacity-50"
              onClick={() => runTurn()}
              disabled={isRunning || gameState.isGameOver || isProcessingTurn}
            >
              Step
            </button>
            <button
              className="px-4 py-2 bg-red-900/50 hover:bg-red-900/80 text-red-200 rounded border border-red-900"
              onClick={() => {
                setIsRunning(false);
                const players = getRandomModels(4);
                engine.current = new GameEngine();
                engine.current.initializeGame(players);
                setGameState(engine.current.getState());
                setLogs([]);
              }}
            >
              Reset
            </button>
          </div>
        </div>

        <Board gameState={gameState} />

        {/* Snake Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {gameState.snakes.map(snake => (
            <div
              key={snake.id}
              className={`relative overflow-hidden p-4 rounded-lg border transition-all ${
                snake.status === 'alive'
                  ? 'border-zinc-700 bg-zinc-900 shadow-lg'
                  : 'border-red-900/30 bg-zinc-950 opacity-60 grayscale-[0.5]'
              }`}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded shadow-sm ring-1 ring-white/10" style={{ backgroundColor: snake.color }} />
                  <div>
                    <div className="font-bold text-zinc-100 leading-none">{snake.name}</div>
                    <div className="text-xs font-mono text-zinc-500 mt-1">{snake.model.split('/')[1]}</div>
                  </div>
                </div>
                {snake.status === 'alive' && (
                  <div className="px-2 py-0.5 bg-green-900/30 text-green-400 text-xs rounded-full border border-green-900/50">
                    ALIVE
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-500">Health</span>
                    <span className="text-zinc-300 font-mono">{snake.health}%</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${snake.health}%`,
                        backgroundColor: snake.health > 50 ? '#22c55e' : snake.health > 20 ? '#eab308' : '#ef4444'
                      }}
                    />
                  </div>
                </div>

                <div className="flex justify-between items-end border-t border-zinc-800 pt-2 mt-2">
                  <div className="text-xs text-zinc-500">Length</div>
                  <div className="text-xl font-mono font-bold text-zinc-200">{snake.length}</div>
                </div>

                {snake.status === 'eliminated' && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-[1px]">
                    <div className="text-center transform -rotate-12">
                      <div className="text-2xl font-black text-red-500 uppercase tracking-widest border-4 border-red-500 px-2">
                        DEAD
                      </div>
                      <div className="text-xs text-red-300 font-mono mt-1 bg-black/80 px-1">
                        {snake.eliminationReason}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-full lg:w-80 flex flex-col gap-4 shrink-0">
        <Leaderboard data={leaderboardData} />

        <div className="bg-zinc-900 border border-zinc-800 rounded p-4 flex-1 flex flex-col min-h-[300px]">
          <h3 className="font-bold mb-2 text-zinc-400 uppercase text-xs tracking-wider flex justify-between items-center">
            Game Log
            <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-500">{logs.length} events</span>
          </h3>
          <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1.5 pr-2 custom-scrollbar">
            {logs.map((log, i) => (
              <div key={i} className="text-zinc-400 border-b border-zinc-800/50 pb-1 last:border-0">
                {log}
              </div>
            ))}
            {logs.length === 0 && (
              <div className="h-full flex items-center justify-center text-zinc-700 italic text-sm">
                Ready to start...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
