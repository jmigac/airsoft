import { broadcastState } from "./events";
import { isValidQuestPayload } from "./payload";
import { normalizeQrPayload } from "./qr";
import { readState, updateState } from "./store";
import { Team } from "./types";

export async function completeMissionByQrCode(team: Team, rawQrPayload: string) {
  const qrCode = normalizeQrPayload(rawQrPayload);
  if (!qrCode) {
    throw new Error("Quest payload is required.");
  }

  if (!isValidQuestPayload(qrCode)) {
    throw new Error("Quest payload must be exactly 6 digits.");
  }

  const current = await readState();
  const mission = current.missions.find((item) => item.qrCode === qrCode);
  if (!mission) {
    throw new Error("No quest is configured for this payload.");
  }

  let alreadyCompleted = false;
  const state = await updateState((previous) => {
    const exists = previous.completions.some(
      (completion) => completion.missionId === mission.id && completion.team === team
    );

    if (exists) {
      alreadyCompleted = true;
      return previous;
    }

    return {
      ...previous,
      completions: [
        ...previous.completions,
        {
          id: crypto.randomUUID(),
          missionId: mission.id,
          team,
          qrCode,
          completedAt: new Date().toISOString()
        }
      ]
    };
  });

  if (!alreadyCompleted) {
    broadcastState({ type: "completion_added", state });
  }

  return {
    state,
    mission,
    qrCode,
    alreadyCompleted
  };
}
