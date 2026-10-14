/**
 * MCP servers the user adds to Roqer, as the main process and the renderer
 * both see them.
 *
 * Roqer is the MCP client. A provider never connects to one of these servers:
 * the model reaches them through one Roqer tool, `external_mcp`, and every call
 * goes through the run engine's policy, approval and cancellation like a
 * Studio call. The risk of each tool is the user's to set, because a server
 * describes its own tools and Roqer cannot check what it says.
 *
 * Everything in this file is safe to show the renderer. The values of a
 * server's environment variables and headers are not: they live encrypted in
 * the main process, and the renderer only learns their names.
 */

import { isLoopbackOrPrivateHost } from "./custom-providers";
import type { ToolRisk } from "./policy";

/** The model-facing tool, offered only while at least one server is on. */
export const EXTERNAL_MCP_TOOL_NAME = "external_mcp";

/** The run-engine operations an `external_mcp` call travels as. */
export const LIST_MCP_TOOLS_OPERATION = "list_mcp_tools";
export const CALL_MCP_TOOL_OPERATION = "call_mcp_tool";
/**
 * Saves a file a server's result linked to, such as generated audio, so it can
 * be uploaded to Roblox. Only links this run's results gave are fetched.
 */
export const DOWNLOAD_MCP_FILE_OPERATION = "download_mcp_file";

export const MCP_SERVER_TRANSPORTS = ["stdio", "http"] as const;
export type McpServerTransport = typeof MCP_SERVER_TRANSPORTS[number];

/**
 * What a tool the user has not classified gets.
 * - `trust`: the tool counts as `irreversible`. Full auto runs it; every other
 *   mode asks. A server that adds tools later gets them on the same terms.
 * - `review`: the tool stays unclassified, so it asks in every mode, Full auto
 *   included, until the user gives it a risk.
 */
export const MCP_NEW_TOOL_POLICIES = ["trust", "review"] as const;
export type McpNewToolPolicy = typeof MCP_NEW_TOOL_POLICIES[number];

export const MCP_TOOL_RISKS: readonly ToolRisk[] = ["read", "mutation", "irreversible"];

export const MAX_MCP_SERVERS = 16;
export const MAX_MCP_ARGS = 32;
export const MAX_MCP_ARG_CHARACTERS = 1_024;
export const MAX_MCP_COMMAND_CHARACTERS = 1_024;
export const MAX_MCP_URL_CHARACTERS = 500;
export const MAX_MCP_SECRETS = 16;
export const MAX_MCP_SECRET_VALUE_CHARACTERS = 4_096;
export const MAX_MCP_TOOL_RISKS = 256;
export const MAX_MCP_LISTED_TOOLS = 256;

/**
 * The name the model calls a server by. A short identifier, not free text:
 * it reaches the model, and the renderer's text reaches the model only as the
 * user's prompt and notes.
 */
const SERVER_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
/** The characters MCP recommends for a tool name. A tool named otherwise is not offered. */
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const SERVER_ID = /^mcp-[a-z0-9]{8}$/;
/** Printable, no whitespace: every client ID a provider issues fits, and nothing that could split a URL or a form. */
const OAUTH_CLIENT_ID = /^[\x21-\x7e]{1,256}$/;

/**
 * Where Roqer's OAuth client metadata document is published (CIMD). A
 * provider that supports client ID metadata documents takes this URL as
 * Roqer's client ID and reads the name and redirect addresses from it, so no
 * registration is needed. The file is `docs/oauth/client-metadata.json` in the
 * repository, served by GitHub Pages; this URL must not change, because it is
 * the client ID every sign-in was made with.
 */
export const ROQER_OAUTH_CLIENT_METADATA_URL = "https://s4us.github.io/Roqer/oauth/client-metadata.json";

/**
 * The loopback port Roqer's sign-in listens on when it is free. Providers
 * should accept any port on a loopback redirect (RFC 8252), but not all do,
 * so the published redirect addresses name this one too.
 */
export const OAUTH_CALLBACK_PORT = 47823;

export function isMcpOAuthClientId(value: unknown): value is string {
  return typeof value === "string" && OAUTH_CLIENT_ID.test(value);
}
/** A name a shell or Windows accepts for an environment variable, without surprises. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** An HTTP header name (RFC 9110 token). */
const HEADER_NAME = /^[A-Za-z0-9!#$&'*+.^_`|~-]{1,64}$/;
/** Headers Roqer sets itself, or that would change what the request is. */
const RESERVED_HEADERS = new Set([
  "accept", "content-type", "content-length", "host", "connection", "transfer-encoding",
  "mcp-session-id", "mcp-protocol-version", "origin", "cookie",
]);

export type McpServerConfig = Readonly<{
  id: string;
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  /** stdio: the program, as an absolute path or a bare name found on PATH. */
  command?: string;
  /** stdio: its arguments. */
  args?: readonly string[];
  /** http: the streamable HTTP endpoint. */
  url?: string;
  /** http: sign in with OAuth, rather than only the headers the user entered. */
  auth?: "oauth";
  /**
   * http with OAuth: a client ID the user registered with the server's
   * provider, for one that accepts neither Roqer's published client metadata
   * nor dynamic registration. Public: it is not a secret.
   */
  oauthClientId?: string;
  newTools: McpNewToolPolicy;
  /** The risk the user chose for each tool, by the tool's name on the server. */
  toolRisk: Readonly<Record<string, ToolRisk>>;
}>;

/**
 * A server as the renderer sees it: its secrets by name only. For stdio they
 * are environment variables, for http request headers. `signedIn` is present
 * for an OAuth server only, and says whether Roqer holds a sign-in for it,
 * never the tokens themselves.
 */
export type McpServerView = McpServerConfig & Readonly<{ secretNames: readonly string[]; signedIn?: boolean }>;

/**
 * One secret in a save. `value` absent keeps the value already saved under
 * that name, so an edit that does not touch a key never has to carry it.
 */
export type McpSecretSave = Readonly<{ name: string; value?: string }>;

/**
 * A server the renderer asks to create or update. `secrets` absent keeps every
 * saved secret; a list replaces them, and a name left out is removed.
 */
export type McpServerSave = Readonly<{
  id?: string;
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  command?: string;
  args?: readonly string[];
  url?: string;
  auth?: "oauth";
  oauthClientId?: string;
  newTools: McpNewToolPolicy;
  toolRisk: Readonly<Record<string, ToolRisk>>;
  secrets?: readonly McpSecretSave[];
}>;

export type McpServersResult =
  | Readonly<{ ok: true; servers: readonly McpServerView[] }>
  | Readonly<{ ok: false; message: string }>;

/**
 * A tool as a server described it, for Settings to classify. The hints are the
 * server's own claims; Roqer shows them and never acts on them.
 */
export type McpListedTool = Readonly<{
  name: string;
  description: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}>;

export type McpServerTestResult =
  | Readonly<{ ok: true; message: string; tools: readonly McpListedTool[] }>
  | Readonly<{ ok: false; message: string }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

/** No control characters at all: nothing in a command, an argument or a header value may break a line. */
function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f);
}

export function isMcpServerId(value: unknown): value is string {
  return typeof value === "string" && SERVER_ID.test(value);
}

export function isMcpServerName(value: unknown): value is string {
  return typeof value === "string" && SERVER_NAME.test(value);
}

export function isMcpToolName(value: unknown): value is string {
  return typeof value === "string" && TOOL_NAME.test(value);
}

export function isMcpToolRisk(value: unknown): value is ToolRisk {
  return MCP_TOOL_RISKS.includes(value as ToolRisk);
}

export function isMcpNewToolPolicy(value: unknown): value is McpNewToolPolicy {
  return MCP_NEW_TOOL_POLICIES.includes(value as McpNewToolPolicy);
}

export function isMcpServerTransport(value: unknown): value is McpServerTransport {
  return MCP_SERVER_TRANSPORTS.includes(value as McpServerTransport);
}

/** An environment variable name for stdio, a header name for http. */
export function isMcpSecretName(transport: McpServerTransport, value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (transport === "stdio") return ENV_NAME.test(value);
  return HEADER_NAME.test(value) && !RESERVED_HEADERS.has(value.toLowerCase());
}

export function isMcpSecretValue(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_MCP_SECRET_VALUE_CHARACTERS && !hasControlCharacter(value);
}

/**
 * A program to start: an absolute path, or a bare name such as `npx` looked up
 * on PATH. A relative path is refused, because which file it names depends on
 * a working directory the user never sees.
 */
export function isMcpCommand(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > MAX_MCP_COMMAND_CHARACTERS) return false;
  if (hasControlCharacter(value)) return false;
  const absolute = value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
  return absolute || !/[\\/]/.test(value);
}

export function isMcpArgumentList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_MCP_ARGS && value.every((entry) =>
    typeof entry === "string" && entry.length <= MAX_MCP_ARG_CHARACTERS && !hasControlCharacter(entry));
}

/**
 * The URL as it will be stored, or why it cannot be. HTTPS anywhere; plain
 * HTTP only for this computer and the private network, where a local server
 * lives. Credentials and query strings are refused: a key belongs in a
 * header, which is stored encrypted, not in an address the renderer shows.
 */
export function normalizeMcpServerUrl(value: unknown): { ok: true; url: string } | { ok: false; message: string } {
  if (typeof value !== "string" || value.trim().length === 0) return { ok: false, message: "Enter the server's URL." };
  const trimmed = value.trim();
  if (trimmed.length > MAX_MCP_URL_CHARACTERS) return { ok: false, message: "That URL is too long." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: "That URL is not a valid address." };
  }
  if (url.username !== "" || url.password !== "") return { ok: false, message: "Put credentials in a header, not in the URL." };
  if (url.search !== "" || url.hash !== "") {
    return { ok: false, message: "The URL cannot have a query or a fragment. Put a key in a header instead." };
  }
  if (url.protocol === "http:") {
    if (!isLoopbackOrPrivateHost(url.hostname)) {
      return { ok: false, message: "Use HTTPS. Plain HTTP is only allowed for this computer or your local network." };
    }
  } else if (url.protocol !== "https:") {
    return { ok: false, message: "The URL must start with https:// or, for a local server, http://." };
  }
  return { ok: true, url: url.href };
}

function isToolRiskMap(value: unknown): value is Record<string, ToolRisk> {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_MCP_TOOL_RISKS && entries.every(([name, risk]) => isMcpToolName(name) && isMcpToolRisk(risk));
}

const CONFIG_KEYS = ["id", "name", "enabled", "transport", "command", "args", "url", "auth", "oauthClientId", "newTools", "toolRisk"] as const;

/** OAuth only for http, and a client ID only with OAuth. */
function isAuthChoice(transport: unknown, auth: unknown, clientId: unknown): boolean {
  if (auth === undefined) return clientId === undefined;
  return transport === "http" && auth === "oauth" && (clientId === undefined || isMcpOAuthClientId(clientId));
}

export function isMcpServerConfig(value: unknown): value is McpServerConfig {
  if (!isRecord(value) || !hasOnlyKeys(value, CONFIG_KEYS)) return false;
  if (!isMcpServerId(value.id) || !isMcpServerName(value.name) || typeof value.enabled !== "boolean") return false;
  if (!isMcpNewToolPolicy(value.newTools) || !isToolRiskMap(value.toolRisk)) return false;
  if (!isAuthChoice(value.transport, value.auth, value.oauthClientId)) return false;
  if (value.transport === "stdio") {
    return isMcpCommand(value.command) && isMcpArgumentList(value.args) && value.url === undefined;
  }
  if (value.transport === "http") {
    const url = normalizeMcpServerUrl(value.url);
    return url.ok && url.url === value.url && value.command === undefined && value.args === undefined;
  }
  return false;
}

export function isMcpServerView(value: unknown): value is McpServerView {
  if (!isRecord(value) || !Array.isArray(value.secretNames)) return false;
  const { secretNames, signedIn, ...config } = value;
  if (!isMcpServerConfig(config)) return false;
  // Whether it is signed in is said of an OAuth server, and only of one.
  if (config.auth === "oauth" ? typeof signedIn !== "boolean" : signedIn !== undefined) return false;
  return secretNames.length <= MAX_MCP_SECRETS &&
    secretNames.every((name) => isMcpSecretName(config.transport, name)) &&
    new Set(secretNames).size === secretNames.length;
}

export function isMcpServersResult(value: unknown): value is McpServersResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) return typeof value.message === "string";
  return Array.isArray(value.servers) && value.servers.length <= MAX_MCP_SERVERS && value.servers.every(isMcpServerView);
}

function isListedTool(value: unknown): value is McpListedTool {
  return isRecord(value) && hasOnlyKeys(value, ["name", "description", "readOnlyHint", "destructiveHint"]) &&
    isMcpToolName(value.name) && typeof value.description === "string" &&
    (value.readOnlyHint === undefined || typeof value.readOnlyHint === "boolean") &&
    (value.destructiveHint === undefined || typeof value.destructiveHint === "boolean");
}

export function isMcpServerTestResult(value: unknown): value is McpServerTestResult {
  if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.message !== "string") return false;
  if (!value.ok) return true;
  return Array.isArray(value.tools) && value.tools.length <= MAX_MCP_LISTED_TOOLS && value.tools.every(isListedTool);
}

const SAVE_KEYS = [...CONFIG_KEYS, "secrets"] as const;

/**
 * A save request from the renderer, checked field by field so the message
 * says which field is wrong. The URL comes back normalized.
 */
export function parseMcpServerSave(value: unknown): { ok: true; save: McpServerSave } | { ok: false; message: string } {
  const invalid = { ok: false as const, message: "The server was not valid." };
  if (!isRecord(value) || !hasOnlyKeys(value, SAVE_KEYS)) return invalid;
  if (value.id !== undefined && !isMcpServerId(value.id)) return invalid;
  if (!isMcpServerName(value.name)) {
    return { ok: false, message: "Give the server a short name: lowercase letters, digits, - or _, starting with a letter, up to 32 characters." };
  }
  if (typeof value.enabled !== "boolean" || !isMcpNewToolPolicy(value.newTools)) return invalid;
  if (!isMcpServerTransport(value.transport)) return { ok: false, message: "Choose how Roqer reaches the server." };
  if (!isToolRiskMap(value.toolRisk)) return { ok: false, message: "A tool's risk was not valid." };
  if (value.oauthClientId !== undefined && !isMcpOAuthClientId(value.oauthClientId)) {
    return { ok: false, message: "A client ID is one word of printable characters, at most 256." };
  }
  if (!isAuthChoice(value.transport, value.auth, value.oauthClientId)) return invalid;
  let target: { command: string; args: string[] } | { url: string };
  if (value.transport === "stdio") {
    if (value.url !== undefined) return invalid;
    if (!isMcpCommand(value.command)) {
      return { ok: false, message: "Enter the program to run: a full path, or a name on PATH such as npx." };
    }
    const args = value.args ?? [];
    if (!isMcpArgumentList(args)) {
      return { ok: false, message: `Arguments: up to ${MAX_MCP_ARGS}, each on one line of at most ${MAX_MCP_ARG_CHARACTERS} characters.` };
    }
    target = { command: value.command, args };
  } else {
    if (value.command !== undefined || value.args !== undefined) return invalid;
    const url = normalizeMcpServerUrl(value.url);
    if (!url.ok) return url;
    target = { url: url.url };
  }
  let secrets: McpSecretSave[] | undefined;
  if (value.secrets !== undefined) {
    if (!Array.isArray(value.secrets) || value.secrets.length > MAX_MCP_SECRETS) {
      return { ok: false, message: `A server can have up to ${MAX_MCP_SECRETS} ${value.transport === "stdio" ? "environment variables" : "headers"}.` };
    }
    secrets = [];
    for (const entry of value.secrets) {
      if (!isRecord(entry) || !hasOnlyKeys(entry, ["name", "value"])) return invalid;
      if (!isMcpSecretName(value.transport, entry.name)) {
        return {
          ok: false,
          message: value.transport === "stdio"
            ? "An environment variable name may use letters, digits and _, and cannot start with a digit."
            : `"${typeof entry.name === "string" ? entry.name.slice(0, 64) : ""}" cannot be used as a header name.`,
        };
      }
      if (entry.value !== undefined && !isMcpSecretValue(entry.value)) {
        return { ok: false, message: `The value for ${entry.name} must be one line of at most ${MAX_MCP_SECRET_VALUE_CHARACTERS} characters.` };
      }
      secrets.push(entry.value === undefined ? { name: entry.name } : { name: entry.name, value: entry.value });
    }
    const names = secrets.map((secret) => value.transport === "http" ? secret.name.toLowerCase() : secret.name);
    if (new Set(names).size !== names.length) return { ok: false, message: "Each name can only be used once." };
    // With OAuth, Roqer sets Authorization itself; a second one would fight it.
    if (value.auth === "oauth" && names.includes("authorization")) {
      return { ok: false, message: "With OAuth sign-in, Roqer sends the Authorization header itself. Remove yours." };
    }
  }
  return {
    ok: true,
    save: {
      ...(value.id === undefined ? {} : { id: value.id }),
      name: value.name,
      enabled: value.enabled,
      transport: value.transport,
      ...target,
      ...(value.auth === "oauth" ? { auth: "oauth" as const } : {}),
      ...(value.oauthClientId === undefined ? {} : { oauthClientId: value.oauthClientId }),
      newTools: value.newTools,
      toolRisk: { ...value.toolRisk },
      ...(secrets === undefined ? {} : { secrets }),
    },
  };
}

/**
 * The risk of one tool on one server, or undefined when it has none: a tool
 * the user has not classified on a server set to `review`. The run engine
 * treats undefined as unclassified, so the call asks even in Full auto.
 */
export function mcpToolRisk(server: McpServerConfig, tool: string): ToolRisk | undefined {
  if (Object.prototype.hasOwnProperty.call(server.toolRisk, tool)) return server.toolRisk[tool];
  return server.newTools === "trust" ? "irreversible" : undefined;
}

/** How a server's program or address reads in Settings and on an approval. */
export function mcpServerTarget(server: Pick<McpServerConfig, "transport" | "command" | "args" | "url">): string {
  if (server.transport === "http") return server.url ?? "";
  return [server.command ?? "", ...(server.args ?? [])].map((part) => /\s/.test(part) ? `"${part}"` : part).join(" ");
}
