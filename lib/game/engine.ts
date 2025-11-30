import {
  GameState,
  Move,
  Point,
  Direction,
  GameConfig,
  EliminationReason,
} from "./types";

const DEFAULT_CONFIG: GameConfig = {
  width: 7,
  height: 7,
  initialHealth: 100,
  foodSpawnChance: 0.15,
  minFood: 3,
};

const SNAKE_COLORS = [
  "#FFAF00",
  "#00AD3A",
  "#9440D5",
  "#006FFE",
  "#F12B83",
  "#00A996",
];

export class GameEngine {
  private state: GameState;
  private config: GameConfig;

  constructor(config: Partial<GameConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      id: crypto.randomUUID(),
      turn: 0,
      snakes: [],
      food: [],
      width: this.config.width,
      height: this.config.height,
      isGameOver: false,
    };
  }

  public initializeGame(players: { id: string; model: string }[]) {
    // Initialize snakes at starting positions
    const positions = [
      { x: 1, y: 1 },
      { x: this.config.width - 2, y: 1 },
      { x: 1, y: this.config.height - 2 },
      { x: this.config.width - 2, y: this.config.height - 2 },
    ];

    this.state.snakes = players.map((p, index) => {
      const startPos = positions[index % positions.length];
      return {
        id: p.id,
        name: `Snake ${index + 1}`,
        model: p.model,
        body: [startPos],
        health: this.config.initialHealth,
        color: SNAKE_COLORS[index % SNAKE_COLORS.length],
        status: "alive",
        length: 1,
        latency: [],
      };
    });

    this.spawnFood();
  }

  // ... rest of methods
  public getState(): GameState {
    return JSON.parse(JSON.stringify(this.state));
  }

  public nextTurn(moves: Move[]) {
    if (this.state.isGameOver) return;

    this.state.turn++;
    const aliveSnakes = this.state.snakes.filter((s) => s.status === "alive");

    const nextHeads: Map<string, Point> = new Map();
    const eatsFood: Map<string, boolean> = new Map();

    aliveSnakes.forEach((snake) => {
      const move = moves.find((m) => m.snakeId === snake.id);

      if (!move) {
        return;
      }

      const head = snake.body[0];
      const next = this.calculateNextPoint(head, move.direction);
      nextHeads.set(snake.id, next);

      const foundFoodIndex = this.state.food.findIndex(
        (f) => f.x === next.x && f.y === next.y
      );
      if (foundFoodIndex !== -1) {
        eatsFood.set(snake.id, true);
      } else {
        eatsFood.set(snake.id, false);
      }
    });

    const nextBodies: Map<string, Point[]> = new Map();

    aliveSnakes.forEach((snake) => {
      if (!nextHeads.has(snake.id)) return;

      const nextHead = nextHeads.get(snake.id)!;
      const eats = eatsFood.get(snake.id);

      const newBody = [nextHead, ...snake.body];
      if (!eats) {
        newBody.pop();
      }
      nextBodies.set(snake.id, newBody);
    });

    const toEliminate: Set<string> = new Set();
    const eliminationReasons: Map<string, EliminationReason> = new Map();

    aliveSnakes.forEach((snake) => {
      if (!nextHeads.has(snake.id)) {
        toEliminate.add(snake.id);
        eliminationReasons.set(snake.id, "timeout");
        return;
      }

      const head = nextHeads.get(snake.id)!;

      if (
        head.x < 0 ||
        head.x >= this.state.width ||
        head.y < 0 ||
        head.y >= this.state.height
      ) {
        toEliminate.add(snake.id);
        eliminationReasons.set(snake.id, "out-of-bounds");
        return;
      }

      const myNextBody = nextBodies.get(snake.id)!;
      if (this.isPointInList(head, myNextBody.slice(1))) {
        toEliminate.add(snake.id);
        eliminationReasons.set(snake.id, "self-collision");
        return;
      }

      for (const other of aliveSnakes) {
        if (other.id === snake.id) continue;
        const otherBody = nextBodies.get(other.id);
        if (!otherBody) continue;

        if (this.isPointInList(head, otherBody.slice(1))) {
          toEliminate.add(snake.id);
          eliminationReasons.set(snake.id, "body-collision");
        }
      }
    });

    const posToSnakes: Map<string, string[]> = new Map();
    aliveSnakes.forEach((snake) => {
      if (toEliminate.has(snake.id)) return;
      const head = nextHeads.get(snake.id)!;
      const key = `${head.x},${head.y}`;
      if (!posToSnakes.has(key)) posToSnakes.set(key, []);
      posToSnakes.get(key)!.push(snake.id);
    });

    posToSnakes.forEach((ids) => {
      if (ids.length > 1) {
        const involveSnakes = ids.map(
          (id) => this.state.snakes.find((s) => s.id === id)!
        );
        const maxLength = Math.max(...involveSnakes.map((s) => s.body.length));

        const survivors = involveSnakes.filter(
          (s) => s.body.length === maxLength
        );
        const losers = involveSnakes.filter((s) => s.body.length < maxLength);

        losers.forEach((l) => {
          toEliminate.add(l.id);
          eliminationReasons.set(l.id, "head-to-head-collision");
        });

        if (survivors.length > 1) {
          survivors.forEach((s) => {
            toEliminate.add(s.id);
            eliminationReasons.set(s.id, "head-to-head-collision");
          });
        }
      }
    });

    const eatenFoodIndices: number[] = [];

    this.state.snakes = this.state.snakes.map((snake) => {
      const move = moves.find((m) => m.snakeId === snake.id);
      const newLatency = [...snake.latency];
      if (move?.latency !== undefined) {
        newLatency.push(move.latency);
      }

      if (snake.status === "eliminated")
        return { ...snake, latency: newLatency };

      if (toEliminate.has(snake.id)) {
        return {
          ...snake,
          status: "eliminated",
          eliminationReason: eliminationReasons.get(snake.id),
          health: 0,
          latency: newLatency,
        };
      }

      const nextBody = nextBodies.get(snake.id)!;
      const eats = eatsFood.get(snake.id);
      let health = snake.health - 10;
      let length = snake.length;

      if (eats) {
        health = 100;
        length += 1;
        const head = nextBodies.get(snake.id)![0];
        const fIndex = this.state.food.findIndex(
          (f) => f.x === head.x && f.y === head.y
        );
        if (fIndex !== -1) eatenFoodIndices.push(fIndex);
      }

      if (health <= 0) {
        return {
          ...snake,
          body: nextBody,
          status: "eliminated",
          eliminationReason: "starvation",
          health: 0,
          length,
          latency: newLatency,
        };
      }

      return {
        ...snake,
        body: nextBody,
        health,
        length,
        latency: newLatency,
      };
    });

    const uniqueFoodIndices = [...new Set(eatenFoodIndices)].sort(
      (a, b) => b - a
    );
    uniqueFoodIndices.forEach((idx) => {
      this.state.food.splice(idx, 1);
    });

    this.spawnFood();

    const remaining = this.state.snakes.filter((s) => s.status === "alive");
    if (remaining.length <= 1) {
      this.state.isGameOver = true;
      if (remaining.length === 1) {
        this.state.winnerId = remaining[0].id;
      }
    }
  }

  private calculateNextPoint(current: Point, direction: Direction): Point {
    switch (direction) {
      case "up":
        return { x: current.x, y: current.y - 1 };
      case "down":
        return { x: current.x, y: current.y + 1 };
      case "left":
        return { x: current.x - 1, y: current.y };
      case "right":
        return { x: current.x + 1, y: current.y };
    }
  }

  private isPointInList(point: Point, list: Point[]): boolean {
    return list.some((p) => p.x === point.x && p.y === point.y);
  }

  private spawnFood() {
    while (this.state.food.length < this.config.minFood) {
      this.addRandomFood();
    }

    if (Math.random() < this.config.foodSpawnChance) {
      this.addRandomFood();
    }
  }

  public updateSnakeModel(snakeId: string, model: string) {
    const snake = this.state.snakes.find((s) => s.id === snakeId);
    if (snake) {
      snake.model = model;
    }
  }

  private addRandomFood() {
    let attempts = 0;
    while (attempts < 50) {
      const x = Math.floor(Math.random() * this.state.width);
      const y = Math.floor(Math.random() * this.state.height);

      const occupied = this.state.snakes.some(
        (s) => s.status === "alive" && this.isPointInList({ x, y }, s.body)
      );

      const foodExists = this.isPointInList({ x, y }, this.state.food);

      if (!occupied && !foodExists) {
        this.state.food.push({ x, y });
        return;
      }
      attempts++;
    }
  }
}
