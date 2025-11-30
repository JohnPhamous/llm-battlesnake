import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

const redis = (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    })
  : null;

const KEY = 'battlesnake_elo';

export async function GET() {
  try {
    if (!redis) {
      return NextResponse.json([]);
    }

    // Get top 100
    const data = await redis.zrange(KEY, 0, -1, { rev: true, withScores: true });

    // Format: [member, score, member, score...] -> [{model, score}]
    const leaderboard = [];
    for (let i = 0; i < data.length; i += 2) {
      leaderboard.push({
        model: data[i] as string,
        score: data[i + 1] as number
      });
    }

    return NextResponse.json(leaderboard);
  } catch (error) {
    console.error('Redis error:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!redis) {
      return NextResponse.json({ success: true, warning: 'Redis not configured' });
    }

    const { results } = await req.json();
    // results: { model: string, rank: number }[] (Rank 1 is winner)

    // Fetch current scores
    const pipe = redis.pipeline();
    results.forEach((r: any) => pipe.zscore(KEY, r.model));
    const scores = await pipe.exec() as (number | null)[]; // array of scores

    const currentElos = results.map((r: any, i: number) => ({
      model: r.model,
      elo: scores[i] ?? 1200,
      rank: r.rank
    }));

    // Update ELOs
    // Simple pairwise
    const K = 32;
    const newElos = { ...currentElos.map(c => c.elo) }; // Copy to track changes? No, map by index.

    // We need to accumulate changes
    const updates = new Map<string, number>();
    currentElos.forEach(c => updates.set(c.model, 0));

    for (let i = 0; i < currentElos.length; i++) {
      for (let j = i + 1; j < currentElos.length; j++) {
        const p1 = currentElos[i];
        const p2 = currentElos[j];

        // Calculate expected score for p1 vs p2
        const ra = p1.elo;
        const rb = p2.elo;

        const expectedA = 1 / (1 + Math.pow(10, (rb - ra) / 400));
        const expectedB = 1 / (1 + Math.pow(10, (ra - rb) / 400));

        // Score: if p1 rank < p2 rank => p1 wins (1). If equal => draw (0.5).
        // Rank 1 is better than Rank 2.
        let scoreA = 0.5;
        if (p1.rank < p2.rank) scoreA = 1;
        else if (p1.rank > p2.rank) scoreA = 0;

        const scoreB = 1 - scoreA;

        const changeA = K * (scoreA - expectedA);
        const changeB = K * (scoreB - expectedB);

        updates.set(p1.model, updates.get(p1.model)! + changeA);
        updates.set(p2.model, updates.get(p2.model)! + changeB);
      }
    }

    // Apply updates
    const tx = redis.pipeline();
    currentElos.forEach(p => {
      const change = updates.get(p.model)!;
      const newScore = Math.round(p.elo + change);
      tx.zadd(KEY, { score: newScore, member: p.model });
    });

    await tx.exec();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Leaderboard update error:', error);
    return NextResponse.json({ error: 'Failed to update leaderboard' }, { status: 500 });
  }
}
