import { Game } from './components/Game';

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-zinc-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-black tracking-tighter mb-2 bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
            LLM BATTLESNAKE
          </h1>
          <p className="text-zinc-400">4 AI Agents fight for survival.</p>
        </div>

        <Game />
      </div>
    </main>
  );
}
