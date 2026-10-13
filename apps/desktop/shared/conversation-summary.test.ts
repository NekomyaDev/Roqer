import assert from "node:assert/strict";
import test from "node:test";
import {
  boundConversation,
  isConversationContext,
  MAX_COMPACT_SUMMARY_CHARS,
  MAX_CONVERSATION_CHARS,
} from "./conversation";

test("a compact's record comes with the window and is counted against its budget", () => {
  const summary = "- User asked: Build the shop";
  const context = boundConversation([{ role: "user", text: "Make it blue" }], summary);

  assert.equal(context.summary, summary);
  assert.deepEqual(context.messages, [{ role: "user", text: "Make it blue" }]);
  assert.equal(isConversationContext(context), true);

  // A window with a record and messages that together overflow the budget
  // keeps the record and drops messages instead.
  const filler = "z".repeat(16_000);
  const crowded = boundConversation(
    [{ role: "user", text: filler }, { role: "assistant", text: filler }, { role: "user", text: filler }, { role: "assistant", text: filler }],
    "r".repeat(MAX_COMPACT_SUMMARY_CHARS),
  );
  const chars = crowded.messages.reduce((sum, message) => sum + message.text.length, MAX_COMPACT_SUMMARY_CHARS);
  assert.ok(chars <= MAX_CONVERSATION_CHARS);
  assert.equal(crowded.summary?.length, MAX_COMPACT_SUMMARY_CHARS);
  assert.equal(crowded.truncated, true);
});

test("a window without a record has no summary field at all", () => {
  const context = boundConversation([{ role: "user", text: "Hi" }]);
  assert.equal("summary" in context, false);
});

test("a window's record must be text within the record bound", () => {
  const base = { messages: [], truncated: false };
  assert.equal(isConversationContext({ ...base, summary: "- User asked: hi" }), true);
  assert.equal(isConversationContext({ ...base, summary: 12 }), false);
  assert.equal(isConversationContext({ ...base, summary: "x".repeat(MAX_COMPACT_SUMMARY_CHARS + 1) }), false);
});
