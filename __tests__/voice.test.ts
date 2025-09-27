import { formatTranscriptLine, TranscriptLine } from "../src/components/VoiceAIBanner";
import assert from "node:assert";

function testFormat() {
  const line: TranscriptLine = { role: "user", text: "Hello", ts: Date.now() };
  const formatted = formatTranscriptLine(line);
  assert.strictEqual(formatted.startsWith("You:"), true, "Should prefix with You:");
  const line2: TranscriptLine = { role: "assistant", text: "Hi there", ts: Date.now() };
  const formatted2 = formatTranscriptLine(line2);
  assert.strictEqual(/Rick:/.test(formatted2), true, "Should prefix with Rick:");
}

try {
  testFormat();
  console.log("voice.test.ts: PASS");
} catch (e) {
  console.error("voice.test.ts: FAIL", e);
  process.exit(1);
}
