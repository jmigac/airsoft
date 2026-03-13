import { broadcastState } from "./events";
import { buildMissionOutOfWindowMessage, getMissionTimeWindowStatus } from "./mission-time";
import { isValidQuestPayload } from "./payload";
import { normalizeQrPayload } from "./qr";
import { readState, updateState } from "./store";
import { Team } from "./types";

function assertMissionRedeemWindow(mission: { timeWindowCET?: { startsAtCET: string; endsAtCET: string } }) {
  const windowStatus = getMissionTimeWindowStatus(mission);
  if (windowStatus === "too_early" || windowStatus === "expired") {
    throw new Error(buildMissionOutOfWindowMessage(mission));
  }
}

export async function completeMissionByQrCode(gameCode: string, team: Team, rawQrPayload: string) {
  const qrCode = normalizeQrPayload(rawQrPayload);
  if (!qrCode) {
    throw new Error("Quest payload is required.");
  }

  if (!isValidQuestPayload(qrCode)) {
    throw new Error("Quest payload must be exactly 6 digits.");
  }

  const current = await readState(gameCode);
  const mission = current.missions.find((item) => item.type === "qr_payload" && item.qrCode === qrCode);
  if (!mission) {
    throw new Error("No quest is configured for this payload.");
  }

  const existingCompletion = current.completions.some(
    (completion) => completion.missionId === mission.id && completion.team === team
  );

  if (!existingCompletion) {
    assertMissionRedeemWindow(mission);
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
          method: "qr_payload",
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

export async function completeIntelRecoveryMission(
  gameCode: string,
  team: Team,
  missionId: string,
  uploads: Array<{ filename: string; contentType: string; dataUrl: string }>
) {
  if (uploads.length === 0) {
    throw new Error("At least one intel image is required.");
  }

  const current = await readState(gameCode);
  const mission = current.missions.find((item) => item.id === missionId && item.type === "intel_recovery");
  if (!mission) {
    throw new Error("Intel Recovery mission not found.");
  }

  const existingCompletion = current.completions.some(
    (completion) => completion.missionId === mission.id && completion.team === team
  );

  if (!existingCompletion) {
    assertMissionRedeemWindow(mission);
  }

  let alreadyCompleted = false;
  const uploadedAt = new Date().toISOString();
  const state = await updateState(gameCode, (previous) => {
    const missionExists = previous.missions.some((item) => item.id === mission.id && item.type === "intel_recovery");
    if (!missionExists) {
      throw new Error("Intel Recovery mission not found.");
    }

    const exists = previous.completions.some(
      (completion) => completion.missionId === mission.id && completion.team === team
    );

    if (exists) {
      alreadyCompleted = true;
      return previous;
    }

    return {
      ...previous,
      missionIntelUploads: [
        ...(previous.missionIntelUploads ?? []),
        ...uploads.map((upload) => ({
          id: crypto.randomUUID(),
          missionId: mission.id,
          team,
          filename: upload.filename,
          contentType: upload.contentType,
          dataUrl: upload.dataUrl,
          uploadedAt
        }))
      ],
      completions: [
        ...previous.completions,
        {
          id: crypto.randomUUID(),
          missionId: mission.id,
          team,
          method: "intel_recovery",
          completedAt: uploadedAt
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
    alreadyCompleted
  };
}
