import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  isMcpServerConfig,
  isMcpSecretName,
  isMcpSecretValue,
  MAX_MCP_SECRETS,
  MAX_MCP_SERVERS,
  mcpServerTarget,
  type McpServerConfig,
  type McpServerSave,
  type McpServerView,
} from "../shared/mcp-servers";
import { isOAuthGrant, type OAuthGrant } from "./mcp-oauth";
import type { SecretProtector } from "./secret-protector";

/**
 * The MCP servers the user added, kept by the main process.
 *
 * One file beside the workspace, written atomically. A server's environment
 * variables (stdio) or headers (http) are encrypted together with the
 * operating system's store before they touch disk, and decrypted only to
 * start or reach the server; the renderer learns only their names. A file
 * that does not validate is moved aside for diagnosis rather than overwritten,
 * and the user starts again with no servers instead of a half-read list.
 *
 * A stdio server is a program Roqer will run. The renderer asking for one is
 * not proof the user did, so a new program, or a changed one, is saved only
 * after the user confirms it in a dialog the main process shows.
 */

export class McpServerStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpServerStoreError";
  }
}

export type McpServerStoreOptions = Readonly<{
  file: string;
  protector: SecretProtector;
  now?: () => Date;
}>;

/**
 * Asks the user, outside the renderer, whether Roqer may run this program.
 * Resolves true only for an explicit yes.
 */
export type ConfirmCommand = (server: Readonly<{ name: string; commandLine: string }>) => Promise<boolean>;

/** `encryptedOAuth` is an OAuth server's sign-in: its tokens and client, encrypted like its headers. */
type StoredServer = McpServerConfig & Readonly<{ encryptedSecrets?: string; encryptedOAuth?: string }>;

const SCHEMA_VERSION = 1;

type StoredFile = Readonly<{ schemaVersion: typeof SCHEMA_VERSION; servers: readonly StoredServer[] }>;

/** Sixteen servers with a few hundred classified tools each, and small enough to refuse a runaway file. */
const MAX_FILE_BYTES = 2 * 1_024 * 1_024;
const MAX_ENCRYPTED_BYTES = 128 * 1_024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function decodeCiphertext(value: unknown): Buffer | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENCRYPTED_BYTES * 2) return undefined;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.length > MAX_ENCRYPTED_BYTES || decoded.toString("base64") !== value) return undefined;
  return decoded;
}

function parseStoredFile(value: unknown): StoredFile | undefined {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.servers) ||
    value.servers.length > MAX_MCP_SERVERS) return undefined;
  const servers: StoredServer[] = [];
  for (const entry of value.servers) {
    if (!isRecord(entry)) return undefined;
    const { encryptedSecrets, encryptedOAuth, ...config } = entry;
    if (!isMcpServerConfig(config)) return undefined;
    if (encryptedSecrets !== undefined && decodeCiphertext(encryptedSecrets) === undefined) return undefined;
    // A sign-in belongs to an OAuth server only.
    if (encryptedOAuth !== undefined && (config.auth !== "oauth" || decodeCiphertext(encryptedOAuth) === undefined)) return undefined;
    servers.push({
      ...config,
      ...(encryptedSecrets === undefined ? {} : { encryptedSecrets: encryptedSecrets as string }),
      ...(encryptedOAuth === undefined ? {} : { encryptedOAuth: encryptedOAuth as string }),
    });
  }
  if (new Set(servers.map((server) => server.id)).size !== servers.length) return undefined;
  if (new Set(servers.map((server) => server.name)).size !== servers.length) return undefined;
  return { schemaVersion: SCHEMA_VERSION, servers };
}

/** A stored server without its ciphertext: what anything but `decrypt` may see. */
function configOf(server: StoredServer): McpServerConfig {
  const config: Record<string, unknown> = { ...server };
  delete config.encryptedSecrets;
  delete config.encryptedOAuth;
  return config as McpServerConfig;
}

/**
 * Where a server's secrets would be sent: a changed target must not inherit
 * them. For stdio the arguments count, since `npx -y <package>` is a
 * different program for every package it names.
 */
function secretsDestination(server: Pick<McpServerConfig, "transport" | "command" | "args" | "url">): string {
  if (server.transport === "http") return `http ${new URL(server.url!).origin}`;
  return `stdio ${JSON.stringify([server.command, ...(server.args ?? [])])}`;
}

/** Whether a sign-in made for `a` still holds for `b`: the same address, by OAuth, with the same client. */
function sameSignIn(
  a: Pick<McpServerConfig, "url" | "auth" | "oauthClientId">,
  b: Pick<McpServerConfig, "url" | "auth" | "oauthClientId">,
): boolean {
  return a.auth === "oauth" && b.auth === "oauth" && a.url === b.url && a.oauthClientId === b.oauthClientId;
}

function sameProgram(a: Pick<McpServerConfig, "command" | "args">, b: Pick<McpServerConfig, "command" | "args">): boolean {
  return a.command === b.command && JSON.stringify(a.args ?? []) === JSON.stringify(b.args ?? []);
}

export class McpServerStore {
  private readonly file: string;
  private readonly protector: SecretProtector;
  private readonly now: () => Date;
  private queue: Promise<unknown> = Promise.resolve();
  private cached: StoredFile | undefined;
  /** Where a damaged file was moved to, reported once so the user can be told. */
  private preservedPath: string | undefined;

  constructor(options: McpServerStoreOptions) {
    if (!path.isAbsolute(options.file)) throw new Error("The MCP server store path must be absolute.");
    this.file = options.file;
    this.protector = options.protector;
    this.now = options.now ?? (() => new Date());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(): Promise<StoredFile> {
    if (this.cached !== undefined) return this.cached;
    let contents: string;
    try {
      const details = await fs.stat(this.file);
      if (details.size > MAX_FILE_BYTES) return this.preserveDamaged();
      contents = await fs.readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        this.cached = { schemaVersion: SCHEMA_VERSION, servers: [] };
        return this.cached;
      }
      throw new McpServerStoreError("Your MCP servers could not be read.");
    }
    let parsed: StoredFile | undefined;
    try {
      parsed = parseStoredFile(JSON.parse(contents) as unknown);
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined) return this.preserveDamaged();
    this.cached = parsed;
    return parsed;
  }

  private async preserveDamaged(): Promise<StoredFile> {
    const preserved = `${this.file}.damaged-${this.now().getTime()}-${randomUUID()}`;
    try {
      await fs.rename(this.file, preserved);
    } catch {
      throw new McpServerStoreError("Your saved MCP servers are damaged and could not be set aside.");
    }
    this.preservedPath = preserved;
    this.cached = { schemaVersion: SCHEMA_VERSION, servers: [] };
    return this.cached;
  }

  private async write(next: StoredFile): Promise<void> {
    const contents = `${JSON.stringify(next, null, 2)}\n`;
    if (Buffer.byteLength(contents) > MAX_FILE_BYTES) {
      throw new McpServerStoreError("Too many MCP servers to save.");
    }
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(contents, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, this.file);
    } catch {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw new McpServerStoreError("Your MCP servers could not be saved.");
    }
    this.cached = next;
  }

  private encrypt(secrets: Readonly<Record<string, string> | OAuthGrant>): string {
    if (!this.protector.isEncryptionAvailable()) {
      throw new McpServerStoreError(
        "This computer has no encrypted storage available, so Roqer cannot keep a server's keys or sign-in. Servers without them still work.",
      );
    }
    let ciphertext: Buffer;
    try {
      ciphertext = this.protector.encryptString(JSON.stringify(secrets));
    } catch {
      throw new McpServerStoreError("The server's keys could not be encrypted.");
    }
    if (ciphertext.length === 0 || ciphertext.length > MAX_ENCRYPTED_BYTES) {
      throw new McpServerStoreError("The server's keys are too large to keep.");
    }
    return ciphertext.toString("base64");
  }

  private decrypt(server: StoredServer): Record<string, string> {
    if (server.encryptedSecrets === undefined) return {};
    if (!this.protector.isEncryptionAvailable()) {
      throw new McpServerStoreError(`Encrypted storage is unavailable, so the keys saved for ${server.name} cannot be read.`);
    }
    const failed = new McpServerStoreError(`The keys saved for ${server.name} could not be decrypted. Enter them again in Settings.`);
    const ciphertext = decodeCiphertext(server.encryptedSecrets);
    let parsed: unknown;
    try {
      if (ciphertext === undefined) throw new Error("undecodable");
      parsed = JSON.parse(this.protector.decryptString(ciphertext)) as unknown;
    } catch {
      throw failed;
    }
    if (!isRecord(parsed)) throw failed;
    const entries = Object.entries(parsed);
    if (entries.length > MAX_MCP_SECRETS ||
      !entries.every(([name, value]) => isMcpSecretName(server.transport, name) && isMcpSecretValue(value))) throw failed;
    return Object.fromEntries(entries) as Record<string, string>;
  }

  private decryptGrant(server: StoredServer): OAuthGrant | undefined {
    if (server.encryptedOAuth === undefined) return undefined;
    const failed = new McpServerStoreError(`The sign-in saved for ${server.name} could not be read. Sign in again in Settings.`);
    if (!this.protector.isEncryptionAvailable()) throw failed;
    const ciphertext = decodeCiphertext(server.encryptedOAuth);
    let parsed: unknown;
    try {
      if (ciphertext === undefined) throw new Error("undecodable");
      parsed = JSON.parse(this.protector.decryptString(ciphertext)) as unknown;
    } catch {
      throw failed;
    }
    if (!isOAuthGrant(parsed)) throw failed;
    return parsed;
  }

  private view(server: StoredServer): McpServerView {
    const config = configOf(server);
    let secretNames: string[] = [];
    try {
      secretNames = Object.keys(this.decrypt(server));
    } catch {
      // The view still lists the server; starting it reports the problem.
    }
    return { ...config, secretNames, ...(config.auth === "oauth" ? { signedIn: server.encryptedOAuth !== undefined } : {}) };
  }

  /** Where a damaged file was moved on this load, once; later calls return undefined. */
  takeDamagedNotice(): string | undefined {
    const preserved = this.preservedPath;
    this.preservedPath = undefined;
    return preserved;
  }

  list(): Promise<McpServerView[]> {
    return this.enqueue(async () => (await this.read()).servers.map((server) => this.view(server)));
  }

  /**
   * The servers as last read or saved, without their secrets, for decisions
   * that cannot wait on the disk: the run engine classifying a call. Undefined
   * until `list` or a change has loaded the file once.
   */
  peek(): readonly McpServerConfig[] | undefined {
    return this.cached?.servers.map(configOf);
  }

  /** Create a server, or update the one `save.id` names. */
  save(save: McpServerSave, confirmCommand: ConfirmCommand): Promise<McpServerView[]> {
    return this.enqueue(async () => {
      const current = await this.read();
      const existing = save.id === undefined ? undefined : current.servers.find((server) => server.id === save.id);
      if (save.id !== undefined && existing === undefined) throw new McpServerStoreError("That server no longer exists.");
      if (existing === undefined && current.servers.length >= MAX_MCP_SERVERS) {
        throw new McpServerStoreError(`You can have up to ${MAX_MCP_SERVERS} MCP servers.`);
      }
      if (current.servers.some((server) => server.name === save.name && server.id !== existing?.id)) {
        throw new McpServerStoreError(`Another server is already called ${save.name}.`);
      }
      const target: Pick<McpServerConfig, "transport" | "command" | "args" | "url"> = save.transport === "stdio"
        ? { transport: "stdio", command: save.command, args: [...(save.args ?? [])] }
        : { transport: "http", url: save.url };

      // Saved values belong to the server they were entered for. Keeping them
      // while the server moves elsewhere would hand them to whatever it now
      // names, on the renderer's word alone.
      const moved = existing !== undefined &&
        (existing.transport !== target.transport || secretsDestination(existing) !== secretsDestination(target));
      const saved = existing === undefined ? {} : this.decrypt(existing);
      let secrets: Record<string, string>;
      if (save.secrets === undefined) {
        if (moved && Object.keys(saved).length > 0) {
          throw new McpServerStoreError("The server now points somewhere else. Enter its keys again, or remove them, to save.");
        }
        secrets = saved;
      } else {
        secrets = {};
        for (const secret of save.secrets) {
          if (secret.value !== undefined) {
            secrets[secret.name] = secret.value;
            continue;
          }
          const key = Object.keys(saved).find((name) =>
            target.transport === "http" ? name.toLowerCase() === secret.name.toLowerCase() : name === secret.name);
          if (key === undefined) throw new McpServerStoreError(`Enter a value for ${secret.name}.`);
          if (moved) throw new McpServerStoreError(`The server now points somewhere else. Enter ${secret.name} again, or remove it, to save.`);
          secrets[secret.name] = saved[key];
        }
      }

      if (target.transport === "stdio" && (existing === undefined || existing.transport !== "stdio" || !sameProgram(existing, target))) {
        const confirmed = await confirmCommand({ name: save.name, commandLine: mcpServerTarget(target) });
        if (!confirmed) throw new McpServerStoreError("The server was not saved: you did not allow Roqer to run its program.");
      }

      const config: McpServerConfig = {
        id: existing?.id ?? `mcp-${randomBytes(6).toString("hex").slice(0, 8)}`,
        name: save.name,
        enabled: save.enabled,
        ...target,
        ...(save.auth === undefined ? {} : { auth: save.auth }),
        ...(save.oauthClientId === undefined ? {} : { oauthClientId: save.oauthClientId }),
        newTools: save.newTools,
        toolRisk: { ...save.toolRisk },
      };
      // What is written is what a later load accepts, or nothing is written.
      if (!isMcpServerConfig(config)) throw new McpServerStoreError("The server was not valid.");
      const encryptedSecrets = Object.keys(secrets).length === 0 ? undefined : this.encrypt(secrets);
      // A sign-in is for one address and one client. Any change to either
      // ends it: its tokens were issued for what the server was, not what it is.
      const encryptedOAuth = existing?.encryptedOAuth !== undefined && sameSignIn(existing, config) ? existing.encryptedOAuth : undefined;
      const server: StoredServer = {
        ...config,
        ...(encryptedSecrets === undefined ? {} : { encryptedSecrets }),
        ...(encryptedOAuth === undefined ? {} : { encryptedOAuth }),
      };
      const servers = existing === undefined
        ? [...current.servers, server]
        : current.servers.map((entry) => entry.id === existing.id ? server : entry);
      await this.write({ schemaVersion: SCHEMA_VERSION, servers });
      return servers.map((entry) => this.view(entry));
    });
  }

  remove(id: string): Promise<McpServerView[]> {
    return this.enqueue(async () => {
      const current = await this.read();
      const servers = current.servers.filter((server) => server.id !== id);
      if (servers.length !== current.servers.length) await this.write({ schemaVersion: SCHEMA_VERSION, servers });
      return servers.map((server) => this.view(server));
    });
  }

  /**
   * Every server that is turned on, with its secrets decrypted, for a run
   * about to list or call one. A server whose keys cannot be decrypted is
   * left out, as if it were off; Settings' test says why.
   */
  enabled(): Promise<{ server: McpServerConfig; secrets: Record<string, string> }[]> {
    return this.enqueue(async () => {
      const resolved: { server: McpServerConfig; secrets: Record<string, string> }[] = [];
      for (const stored of (await this.read()).servers) {
        if (!stored.enabled) continue;
        const server = configOf(stored);
        try {
          resolved.push({ server, secrets: this.decrypt(stored) });
        } catch {
          // Left out; see above.
        }
      }
      return resolved;
    });
  }

  /** An OAuth server's sign-in, decrypted, or undefined when it has none. */
  oauthGrant(id: string): Promise<OAuthGrant | undefined> {
    return this.enqueue(async () => {
      const stored = (await this.read()).servers.find((server) => server.id === id);
      return stored === undefined ? undefined : this.decryptGrant(stored);
    });
  }

  /**
   * Keep a sign-in, or with undefined forget it. `signedInAs` is the server
   * as it was when the sign-in began: one that changed meanwhile is not given
   * tokens issued for what it was.
   */
  setOAuthGrant(
    id: string,
    grant: OAuthGrant | undefined,
    signedInAs: Pick<McpServerConfig, "url" | "auth" | "oauthClientId">,
  ): Promise<McpServerView[]> {
    return this.enqueue(async () => {
      const current = await this.read();
      const existing = current.servers.find((server) => server.id === id);
      if (existing === undefined) throw new McpServerStoreError("That server no longer exists.");
      if (grant !== undefined && (existing.auth !== "oauth" || !sameSignIn(signedInAs, existing))) {
        throw new McpServerStoreError("The server changed while you were signing in. Sign in again.");
      }
      const rest: Record<string, unknown> = { ...existing };
      delete rest.encryptedOAuth;
      const server = (grant === undefined ? rest : { ...rest, encryptedOAuth: this.encrypt(grant) }) as StoredServer;
      const servers = current.servers.map((entry) => entry.id === id ? server : entry);
      await this.write({ schemaVersion: SCHEMA_VERSION, servers });
      return servers.map((entry) => this.view(entry));
    });
  }

  /**
   * A server with its secrets decrypted, to start or reach it now. Looked up
   * by id or by the name the model calls it.
   */
  resolve(key: Readonly<{ id: string } | { name: string }>): Promise<{ server: McpServerConfig; secrets: Record<string, string> } | undefined> {
    return this.enqueue(async () => {
      const stored = (await this.read()).servers.find((server) => "id" in key ? server.id === key.id : server.name === key.name);
      if (stored === undefined) return undefined;
      const server = configOf(stored);
      return { server, secrets: this.decrypt(stored) };
    });
  }
}
