import { Game, Model } from "./components/Game";
import { gateway } from 'ai';

export default async function Home() {
  let availableModels: Model[] = [];
  try {
    const models = await gateway.getAvailableModels();
    availableModels = models.models.map(m => ({
      id: m.id,
      name: m.name || m.id,
    }));
  } catch (error) {
    console.error("Failed to fetch models:", error);
  }

  return (
    <main className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-7xl mx-auto">
        <Game availableModels={availableModels} />
      </div>
    </main>
  );
}
