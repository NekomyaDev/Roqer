import assert from "node:assert/strict";
import test from "node:test";

import {
  isMcpCommand, isMcpServerConfig, mcpServerTarget, mcpToolRisk, normalizeMcpServerUrl, parseMcpServerSave, type McpServerConfig,
} from "./mcp-servers";

const SERVER: McpServerConfig = {
  id: "mcp-abcd1234",
  name: "github",
  enabled: true,
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  newTools: "trust",
  toolRisk: { search_issues: "read", delete_repo: "irreversible" },
};

test("a tool's risk is the user's; an unset one follows the server's new-tool policy", () => {
  assert.equal(mcpToolRisk(SERVER, "search_issues"), "read");
  assert.equal(mcpToolRisk(SERVER, "create_issue"), "irreversible", "trust counts an unset tool as irreversible");
  assert.equal(mcpToolRisk({ ...SERVER, newTools: "review" }, "create_issue"), undefined, "review leaves it unclassified");
  assert.equal(mcpToolRisk({ ...SERVER, newTools: "review" }, "search_issues"), "read");
  // An inherited name is not a classification.
  assert.equal(mcpToolRisk({ ...SERVER, newTools: "review" }, "constructor"), undefined);
});

test("a saved config validates, and one with the other transport's fields does not", () => {
  assert.equal(isMcpServerConfig(SERVER), true);
  assert.equal(isMcpServerConfig({ ...SERVER, url: "https://example.com/mcp" }), false);
  assert.equal(isMcpServerConfig({ ...SERVER, toolRisk: { search_issues: "harmless" } }), false);
  assert.equal(isMcpServerConfig({ ...SERVER, name: "GitHub Server" }), false, "the model-facing name is an identifier, not text");
});

test("a command is an absolute path or a bare name, never a relative path", () => {
  assert.equal(isMcpCommand("npx"), true);
  assert.equal(isMcpCommand("C:\\Program Files\\nodejs\\node.exe"), true);
  assert.equal(isMcpCommand("/usr/local/bin/uvx"), true);
  assert.equal(isMcpCommand("./server.sh"), false);
  assert.equal(isMcpCommand("bin\\server.exe"), false);
  assert.equal(isMcpCommand("npx\nrm"), false);
});

test("a URL is HTTPS, or plain HTTP to this computer or the local network, and carries no key", () => {
  assert.deepEqual(normalizeMcpServerUrl("https://mcp.example.com/mcp"), { ok: true, url: "https://mcp.example.com/mcp" });
  assert.equal(normalizeMcpServerUrl("http://127.0.0.1:3000/mcp").ok, true);
  assert.equal(normalizeMcpServerUrl("http://mcp.example.com/mcp").ok, false);
  assert.equal(normalizeMcpServerUrl("https://user:pass@mcp.example.com/mcp").ok, false);
  assert.equal(normalizeMcpServerUrl("https://mcp.example.com/mcp?key=secret").ok, false);
  assert.equal(normalizeMcpServerUrl("file:///etc/passwd").ok, false);
});

test("a save is checked field by field", () => {
  const save = { name: "github", enabled: true, transport: "stdio", command: "npx", args: ["-y", "pkg"], newTools: "trust", toolRisk: {} };
  assert.equal(parseMcpServerSave(save).ok, true);
  assert.equal(parseMcpServerSave({ ...save, extra: 1 }).ok, false);
  assert.equal(parseMcpServerSave({ ...save, url: "https://example.com" }).ok, false);
  assert.match((parseMcpServerSave({ ...save, secrets: [{ name: "1BAD", value: "x" }] }) as { message: string }).message, /environment variable/);
  assert.match((parseMcpServerSave({ ...save, secrets: [{ name: "A", value: "x" }, { name: "A" }] }) as { message: string }).message, /once/);

  const http = { name: "docs", enabled: true, transport: "http", url: "https://example.com/mcp", newTools: "review", toolRisk: {} };
  assert.equal(parseMcpServerSave(http).ok, true);
  // Headers Roqer sets itself cannot be overridden.
  assert.equal(parseMcpServerSave({ ...http, secrets: [{ name: "Mcp-Session-Id", value: "x" }] }).ok, false);
  assert.equal(parseMcpServerSave({ ...http, secrets: [{ name: "Authorization", value: "Bearer a\r\nX: y" }] }).ok, false);
  assert.match((parseMcpServerSave({ ...http, secrets: [{ name: "x-key", value: "a" }, { name: "X-Key", value: "b" }] }) as { message: string }).message, /once/);
});

test("OAuth is for URL servers, a client ID comes only with it, and Roqer owns the Authorization header then", () => {
  const http = { name: "sounds", enabled: true, transport: "http", url: "https://api.us.elevenlabs.io/v1/mcp", newTools: "trust", toolRisk: {} };
  assert.equal(parseMcpServerSave({ ...http, auth: "oauth" }).ok, true);
  assert.equal(parseMcpServerSave({ ...http, auth: "oauth", oauthClientId: "my-app" }).ok, true);
  assert.equal(parseMcpServerSave({ ...http, oauthClientId: "my-app" }).ok, false, "a client ID without OAuth means nothing");
  assert.equal(parseMcpServerSave({ ...http, auth: "basic" }).ok, false);
  assert.equal(parseMcpServerSave({ ...http, auth: "oauth", oauthClientId: "two words" }).ok, false);
  assert.match((parseMcpServerSave({ ...http, auth: "oauth", secrets: [{ name: "authorization", value: "Bearer x" }] }) as { message: string }).message, /Authorization header itself/);
  assert.equal(parseMcpServerSave({ ...http, auth: "oauth", secrets: [{ name: "X-Region", value: "us" }] }).ok, true, "other headers still go with it");
  assert.equal(parseMcpServerSave({ name: "x", enabled: true, transport: "stdio", command: "npx", args: [], auth: "oauth", newTools: "trust", toolRisk: {} }).ok, false);
  assert.equal(isMcpServerConfig({ ...SERVER, auth: "oauth" }), false, "a program server does not sign in");
});

test("the program reads as one command line", () => {
  assert.equal(mcpServerTarget({ transport: "stdio", command: "C:\\Program Files\\x.exe", args: ["--dir", "C:\\My Files"] }), "\"C:\\Program Files\\x.exe\" --dir \"C:\\My Files\"");
  assert.equal(mcpServerTarget({ transport: "http", url: "https://example.com/mcp" }), "https://example.com/mcp");
});
