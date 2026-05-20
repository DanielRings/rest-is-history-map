/**
 * W0 entry point. Loads the sample fixture and reports the episode count.
 *
 * Real UI (map, timeline, panels) lands in W2.
 */
import sampleData from "../../data/samples/episodes.sample.json";

interface EpisodesDocument {
  version: number;
  generated_at: string;
  episodes: { guid: string }[];
}

const doc = sampleData as EpisodesDocument;

const app = document.getElementById("app");
if (app === null) {
  throw new Error("Expected #app element in index.html");
}
app.textContent = `Loaded ${doc.episodes.length} sample episodes (schema v${doc.version}).`;
