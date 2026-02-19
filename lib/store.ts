import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GameState } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

const INITIAL_STATE: GameState = {
  missions: [],
  completions: []
};

let writeQueue: Promise<void> = Promise.resolve();

async function ensureStoreFile() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(STORE_FILE, "utf8");
  } catch {
    await writeFile(STORE_FILE, JSON.stringify(INITIAL_STATE, null, 2), "utf8");
  }
}

export async function readState(): Promise<GameState> {
  await ensureStoreFile();
  const raw = await readFile(STORE_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw) as GameState;
    return {
      missions: Array.isArray(parsed.missions) ? parsed.missions : [],
      completions: Array.isArray(parsed.completions) ? parsed.completions : []
    };
  } catch {
    return INITIAL_STATE;
  }
}

export async function writeState(state: GameState): Promise<void> {
  await ensureStoreFile();
  await writeFile(STORE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export async function updateState(
  updater: (current: GameState) => GameState
): Promise<GameState> {
  const run = writeQueue.then(async () => {
    const current = await readState();
    const next = updater(current);
    await writeState(next);
    return next;
  });

  writeQueue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}
