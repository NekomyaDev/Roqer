import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMessage,
  createChat,
  createInitialWorkspace,
  normalizeWorkspace,
  setChatCompaction,
} from "./model";

function chatWithTwoMessages() {
  const base = createChat(createInitialWorkspace());
  const projectId = base.selectedProjectId;
  const chatId = base.projects[0].chats[0].id;
  const message = (id: string, role: "user" | "assistant", text: string) => ({
    id, role, text, createdAt: new Date().toISOString(),
  });
  const withMessages = appendMessage(
    appendMessage(base, projectId, chatId, message("m1", "user", "Make a shop")),
    projectId,
    chatId,
    message("m2", "assistant", "Made it."),
  );
  return { state: withMessages, projectId, chatId };
}

test("a manual compact is recorded on its chat and leaves the messages alone", () => {
  const { state, projectId, chatId } = chatWithTwoMessages();
  const compacted = setChatCompaction(state, projectId, chatId, { folded: 1, summary: "- User asked: Make a shop" });

  const chat = compacted.projects[0].chats[0];
  assert.deepEqual(chat.compaction, { folded: 1, summary: "- User asked: Make a shop" });
  assert.deepEqual(chat.messages.map((message) => message.text), ["Make a shop", "Made it."]);
});

test("a compact survives being written to disk and read back", () => {
  const { state, projectId, chatId } = chatWithTwoMessages();
  const compacted = setChatCompaction(state, projectId, chatId, { folded: 1, summary: "- User asked: Make a shop" });
  const restored = normalizeWorkspace(JSON.parse(JSON.stringify(compacted)));

  assert.deepEqual(restored.projects[0].chats[0].compaction, { folded: 1, summary: "- User asked: Make a shop" });
});

test("a compact that folds more messages than the chat holds is dropped on load", () => {
  const { state, projectId, chatId } = chatWithTwoMessages();
  const compacted = setChatCompaction(state, projectId, chatId, { folded: 9, summary: "- User asked: ghost" });
  const restored = normalizeWorkspace(JSON.parse(JSON.stringify(compacted)));

  assert.equal(restored.projects[0].chats[0].compaction, undefined);
  assert.equal(restored.projects[0].chats[0].messages.length, 2);
});

test("the context a compact was taken at survives a save and reload", () => {
  const { state, projectId, chatId } = chatWithTwoMessages();
  const compacted = setChatCompaction(state, projectId, chatId, {
    folded: 1, summary: "- User asked: Make a shop", usedTokens: 68_412, windowTokens: null,
  });
  const restored = normalizeWorkspace(JSON.parse(JSON.stringify(compacted)));

  assert.deepEqual(restored.projects[0].chats[0].compaction, {
    folded: 1, summary: "- User asked: Make a shop", usedTokens: 68_412, windowTokens: null,
  });
});

test("a chat that was never compacted has no compaction field", () => {
  const { state } = chatWithTwoMessages();
  const restored = normalizeWorkspace(JSON.parse(JSON.stringify(state)));
  assert.equal("compaction" in restored.projects[0].chats[0], false);
});
