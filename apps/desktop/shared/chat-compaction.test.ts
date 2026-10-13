import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPACT_DROPPED_NOTICE,
  compactChatSummary,
  isChatCompaction,
} from "./chat-compaction";
import { MAX_COMPACT_SUMMARY_CHARS, type ConversationMessage } from "./conversation";
import type { RunDigest } from "./run-digest";

function digest(changes: string[], outcome: RunDigest["outcome"] = "completed"): RunDigest {
  return { outcome, unfinished: [], changes, unverified: [], decisions: [] };
}

test("the record says what was asked and what each reply changed", () => {
  const summary = compactChatSummary("", [
    { role: "user", text: "Add a coin counter" },
    { role: "assistant", text: "Added it.", run: digest(["script CoinCounter at revision 2"]) },
  ]);

  assert.equal(summary, [
    "- User asked: Add a coin counter",
    "- Assistant replied: Added it.",
    "  Run outcome: completed",
    "  Changed: script CoinCounter at revision 2",
  ].join("\n"));
});

test("a long run lists its first changes and counts the rest", () => {
  const changes = Array.from({ length: 8 }, (_, index) => `script Part${index} at revision 1`);
  const summary = compactChatSummary("", [{ role: "assistant", text: "Done.", run: digest(changes) }]);

  assert.equal(summary.split("\n").filter((line) => line.startsWith("  Changed:")).length, 5);
  assert.ok(summary.endsWith("  …and 3 more changes"));
});

test("a long message is clipped, and whitespace is flattened", () => {
  const text = `first line\n\n${"word ".repeat(200)}`;
  const [line] = compactChatSummary("", [{ role: "user", text }]).split("\n");

  assert.ok(line.length <= 240 + "- User asked: ".length);
  assert.ok(line.endsWith("…"));
  assert.ok(!line.includes("\n"));
});

test("folding again keeps the earlier record and adds the new messages after it", () => {
  const first = compactChatSummary("", [{ role: "user", text: "Make the egg hatch faster" }]);
  const second = compactChatSummary(first, [{ role: "user", text: "Now add a sound" }]);

  assert.equal(second, [
    "- User asked: Make the egg hatch faster",
    "- User asked: Now add a sound",
  ].join("\n"));
});

test("a record that outgrows its bound keeps the newest lines and says what it dropped", () => {
  const messages: ConversationMessage[] = Array.from({ length: 200 }, (_, index) => ({
    role: "user",
    text: `request number ${index} ${"x".repeat(200)}`,
  }));
  const summary = compactChatSummary("", messages);

  assert.ok(summary.length <= MAX_COMPACT_SUMMARY_CHARS);
  assert.ok(summary.startsWith(COMPACT_DROPPED_NOTICE));
  assert.ok(summary.includes("request number 199"), "the newest request survives");
  assert.ok(!summary.includes("request number 0 "), "the oldest request is the one dropped");
});

test("the dropped notice is never stacked up or treated as a line of the chat", () => {
  const big: ConversationMessage[] = Array.from({ length: 200 }, (_, index) => ({
    role: "user",
    text: `request ${index} ${"y".repeat(200)}`,
  }));
  const once = compactChatSummary("", big);
  const twice = compactChatSummary(once, [{ role: "user", text: "one more" }]);

  assert.ok(twice.split(COMPACT_DROPPED_NOTICE).length - 1 <= 1, "the notice appears at most once");
  assert.ok(twice.length <= MAX_COMPACT_SUMMARY_CHARS);
  assert.ok(twice.includes("one more"), "the new message is kept");
});

test("a compact record is valid only with a whole, non-negative fold count and a bounded summary", () => {
  assert.equal(isChatCompaction({ folded: 4, summary: "- User asked: hi" }), true);
  assert.equal(isChatCompaction({ folded: 0, summary: "" }), true);
  assert.equal(isChatCompaction({ folded: -1, summary: "" }), false);
  assert.equal(isChatCompaction({ folded: 1.5, summary: "" }), false);
  assert.equal(isChatCompaction({ folded: 1 }), false);
  assert.equal(isChatCompaction({ folded: 1, summary: "x".repeat(MAX_COMPACT_SUMMARY_CHARS + 1) }), false);
  assert.equal(isChatCompaction(null), false);
  // The context figures are optional, but must be whole counts when present.
  assert.equal(isChatCompaction({ folded: 1, summary: "", usedTokens: 68_412, windowTokens: 200_000 }), true);
  assert.equal(isChatCompaction({ folded: 1, summary: "", usedTokens: 68_412, windowTokens: null }), true);
  assert.equal(isChatCompaction({ folded: 1, summary: "", usedTokens: -1 }), false);
  assert.equal(isChatCompaction({ folded: 1, summary: "", usedTokens: 1.5 }), false);
  assert.equal(isChatCompaction({ folded: 1, summary: "", windowTokens: "200k" }), false);
});
