import { broadcastState } from "./events";
import { buildMissionOutOfWindowMessage, getMissionTimeWindowStatus } from "./mission-time";
import { isValidQuestPayload } from "./payload";
import { normalizeQrPayload } from "./qr";
import { readState, updateState } from "./store";
import { Team } from "./types";

export async function completeMissionByQrCode(gameCode: string, team: Team, rawQrPayload: string) {
  const qrCode = normalizeQrPayload(rawQrPayload);
  if (!qrCode) {
    throw new Error("Quest payload is required.");
  }

  if (!isValidQuestPayload(qrCode)) {
    throw new Error("Quest payload must be exactly 6 digits.");
  }

  const current = await readState(gameCode);
  const mission = current.missions.find((item) => item.qrCode === qrCode);
  if (!mission) {
    throw new Error("No quest is configured for this payload.");
  }

  const existingCompletion = current.completions.some(
    (completion) => completion.missionId === mission.id && completion.team === team
  );

  if (!existingCompletion) {
    const windowStatus = getMissionTimeWindowStatus(mission);
    if (windowStatus === "too_early" || windowStatus === "expired") {
      throw new Error(buildMissionOutOfWindowMessage(mission));
    }
  }

  let alreadyCompleted = false;
  const state = await updateState(gameCode, (previous) => {
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
    broadcastState({ gameCode, type: "completion_added", state });
  }

  return {
    state,
    mission,
    qrCode,
    alreadyCompleted
  };
}
