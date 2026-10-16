import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ClaudeSessionRegistry } from "./claude-session-registry";

const SESSION_ID = "27909b15-5cc9-46cd-981c-fa1de03eea22";
const USAGE = { inputTokens: 10, cacheReadTokens: 1_000, cacheWriteTokens: 100, outputTokens: 5, costUsd: 0.5 };

async function registryFile(): Promise<{ file: string; dispose: () => Promise<void> }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "roqer-registry-"));
  return {
    file: path.join(directory, "claude-sessions.json"),
    dispose: () => fs.rm(directory, { recursive: true, force: true }),
  };
}

test("a chat's saved session, and what it has spent, are read back by the next process", async () => {
  const { file, dispose } = await registryFile();
  try {
    await new ClaudeSessionRegistry(file).update("chat-1", {
      sessionId: SESSION_ID, lastPrompt: "Build the radar.", instanceId: "studio-1", model: "opus", usage: USAGE,
    });

    const entry = await new ClaudeSessionRegistry(file).get("chat-1");
    assert.equal(entry?.sessionId, SESSION_ID);
    assert.equal(entry?.lastPrompt, "Build the radar.");
    assert.equal(entry?.model, "opus");
    assert.deepEqual(entry?.usage, USAGE, "the totals a resumed run measures itself against");
  } finally {
    await dispose();
  }
});

test("totals that did not read back whole are no totals at all", async () => {
  const { file, dispose } = await registryFile();
  try {
    const written = (usage: unknown) => fs.writeFile(file, `${JSON.stringify({
      version: 1, chats: { "chat-1": { sessionId: SESSION_ID, lastPrompt: null, instanceId: null, model: null, usage } },
    })}\n`);

    await written({ ...USAGE, costUsd: "0.5" });
    assert.equal((await new ClaudeSessionRegistry(file).get("chat-1"))?.usage, null, "one malformed figure drops them all");
    await written({ inputTokens: 10, outputTokens: 5 });
    assert.equal((await new ClaudeSessionRegistry(file).get("chat-1"))?.usage, null, "as does a missing one");
    await written({ ...USAGE, cacheReadTokens: -1 });
    assert.equal((await new ClaudeSessionRegistry(file).get("chat-1"))?.usage, null, "and a count that cannot be one");
    await written(USAGE);
    assert.deepEqual((await new ClaudeSessionRegistry(file).get("chat-1"))?.usage, USAGE);
  } finally {
    await dispose();
  }
});

test("a session kept under a new id does not inherit the old one's totals", async () => {
  const { file, dispose } = await registryFile();
  try {
    const registry = new ClaudeSessionRegistry(file);
    await registry.update("chat-1", { sessionId: SESSION_ID, usage: USAGE });
    const replaced = await registry.update("chat-1", { sessionId: "11111111-2222-3333-4444-555555555555" });
    assert.equal(replaced.usage, null, "a new conversation has spent nothing");
    assert.equal(replaced.lastPrompt, null);

    await registry.forget("chat-1");
    assert.equal(await registry.get("chat-1"), undefined);
    assert.equal(await new ClaudeSessionRegistry(file).get("chat-1"), undefined, "and it is gone from the file too");
  } finally {
    await dispose();
  }
});
