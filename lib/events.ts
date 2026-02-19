import { EventEmitter } from "node:events";
import { GameState } from "./types";

type StateEvent = {
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

export function onState(listener: (event: StateEvent) => void) {
  eventBus.on("state", listener);
  return () => {
    eventBus.off("state", listener);
  };
}
