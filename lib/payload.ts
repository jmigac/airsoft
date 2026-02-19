const QUEST_PAYLOAD_REGEX = /^\d{6}$/;

export function sanitizeQuestPayload(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function isValidQuestPayload(value: string) {
  return QUEST_PAYLOAD_REGEX.test(value.trim());
}

export function generateQuestPayload() {
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
}
