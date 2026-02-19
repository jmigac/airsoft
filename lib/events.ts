import { EventEmitter } from "node:events";
import { GameState } from "./types";

type StateEvent = {
  gameCode: string;
  type: "sync" | "completion_added" | "mission_created" | "mission_updated" | "mission_deleted";
  state: GameState;
};

declare global {
  var __airsoftBus: EventEmitter | undefined;
}

const eventBus = global.__airsoftBus ?? new EventEmitter();
if (!global.__airsoftBus) {
  eventBus.setMaxListeners(500);
  global.__airsoftBus = eventBus;
}

export function broadcastState(event: StateEvent) {
  eventBus.emit("state", event);
}

export function onState(gameCode: string, listener: (event: StateEvent) => void) {
  const wrapped = (event: StateEvent) => {
    if (event.gameCode !== gameCode) {
      return;
    }
    listener(event);
  };

  eventBus.on("state", wrapped);
  return () => {
    eventBus.off("state", wrapped);
  };
}
