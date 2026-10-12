import assert from "node:assert/strict";
import test from "node:test";

import { buildConversationPrompt } from "./conversation-prompt";

const RECORD = "- User asked: Build the shop\n- Assistant replied: Built it.";

test("a compacted chat hands the model its record ahead of the messages after it", () => {
  const prompt = buildConversationPrompt({
    messages: [{ role: "user", text: "Make the shop blue" }],
    truncated: false,
    summary: RECORD,
  }, "Now add a price tag");

  const recordAt = prompt.indexOf(RECORD);
  assert.ok(recordAt > 0, "the record is in the prompt");
  assert.ok(prompt.indexOf("Make the shop blue") > recordAt, "the messages after it come after the record");
  assert.ok(prompt.includes("The user compacted this chat."), "the record says it is a summary, not a transcript");
  assert.ok(prompt.endsWith("Current user message:\nNow add a price tag"));
});

test("a compacted chat with no messages after the record still sends the record", () => {
  const prompt = buildConversationPrompt({ messages: [], truncated: false, summary: RECORD }, "Continue");

  assert.ok(prompt.includes(RECORD));
  assert.ok(prompt.endsWith("Current user message:\nContinue"));
});

test("a chat that was never compacted is sent exactly as before", () => {
  assert.equal(buildConversationPrompt({ messages: [], truncated: false }, "Hello"), "Hello");
  const prompt = buildConversationPrompt({ messages: [{ role: "user", text: "Hi" }], truncated: false }, "Next");
  assert.equal(prompt.includes("compacted"), false);
});
