export type Point = {
  x: number;
  y: number;
};

export type Direction = 'up' | 'down' | 'left' | 'right';

export type SnakeStatus = 'alive' | 'eliminated';

export type EliminationReason =
  | 'self-collision'
  | 'body-collision'
  | 'head-to-head-collision'
  | 'out-of-bounds'
  | 'starvation'
  | 'timeout'
  | 'manual';

export interface Snake {
  id: string;
  name: string;
  model: string; // The LLM model identifier
  body: Point[];
  health: number;
  color: string;
  status: SnakeStatus;
  eliminationReason?: EliminationReason;
  length: number; // Score/Length
}

export interface GameConfig {
  width: number;
  height: number;
  initialHealth: number;
  foodSpawnChance: number; // 0-1
  minFood: number;
}

export interface GameState {
  id: string;
  turn: number;
  snakes: Snake[];
  food: Point[];
  width: number;
  height: number;
  isGameOver: boolean;
  winnerId?: string;
}

export interface Move {
  snakeId: string;
  direction: Direction;
}

export interface MoveRequest {
  gameState: GameState;
  you: Snake;
  model?: string;
}

export interface MoveResponse {
  move: Direction;
  reason: string;
}
