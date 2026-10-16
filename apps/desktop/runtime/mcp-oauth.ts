import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

import { OAUTH_CALLBACK_PORT, ROQER_OAUTH_CLIENT_METADATA_URL } from "../shared/mcp-servers";

/**
 * OAuth sign-in for the user's remote MCP servers, as the MCP authorization
 * specification describes it: OAuth 2.1 with PKCE, a loopback redirect, and
 * every token bound to the one server it was asked for (RFC 8707).
 *
 * 1. Discovery. Ask the server without a token; its 401 names its protected
 *    resource metadata (RFC 9728), which names its authorization server,
 *    whose own metadata (RFC 8414) gives the endpoints. The well-known
 *    addresses are tried when a server names none.
 * 2. The client. A client ID the user entered wins; then Roqer's published
 *    client metadata document (CIMD), for a provider that reads one; then
 *    dynamic registration (RFC 7591), for one that offers it.
 * 3. Sign-in in the user's browser, back to a listener on 127.0.0.1 that only
 *    takes the answer carrying this sign-in's state.
 * 4. The code is exchanged for tokens, which only the main process ever holds.
 *
 * Everything an authorization server says is checked before it is used: its
 * metadata must name the issuer that was asked for, its endpoints must be
 * HTTPS (plain HTTP only on this computer), and it must offer S256 PKCE.
 */

export class McpOAuthError extends Error {
  constructor(message: string, readonly signedOut = false) {
    super(message);
    this.name = "McpOAuthError";
  }
}

/** How the client ID was obtained, which decides whether it can be reused. */
export type OAuthRegistration = "manual" | "metadata" | "dynamic";

/** One server's sign-in, as Roqer keeps it encrypted. */
export type OAuthGrant = Readonly<{
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  /** The server the tokens are for, exactly as its metadata named it. */
  resource: string;
  clientId: string;
  clientSecret?: string;
  registration: OAuthRegistration;
  accessToken: string;
  refreshToken?: string;
  /** Milliseconds since the epoch, when the server said. */
  expiresAt?: number;
  scope?: string;
}>;

export type OAuthDependencies = Readonly<{
  fetch?: typeof fetch;
  now?: () => number;
}>;

export type SignInOptions = OAuthDependencies & Readonly<{
  /** Opens the authorization page in the user's browser. */
  openBrowser: (url: string) => Promise<void>;
  signal?: AbortSignal;
  /** How long to wait for the user to finish in the browser. */
  timeoutMs?: number;
  /** The loopback port to prefer; 0 lets the system choose. Injectable for tests. */
  callbackPort?: number;
  /** Injectable for tests: the URL Roqer's client metadata is published at. */
  clientMetadataUrl?: string;
}>;

const MAX_RESPONSE_BYTES = 64 * 1_024;
const REQUEST_TIMEOUT_MS = 20_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** A token this close to expiring is renewed before use rather than after a 401. */
const EXPIRY_MARGIN_MS = 60_000;
const MAX_TOKEN_CHARACTERS = 16_384;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLoopbackHost = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "[::1]";

/** HTTPS, or plain HTTP on this computer: where a token or a code may be sent. */
export function isSecureEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "" || url.hash !== "") return false;
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
}

/** The form RFC 8707 compares resources in: no fragment, no trailing slash on the path. */
function canonicalResource(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new McpOAuthError("The sign-in server sent too large a response.");
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw new McpOAuthError("The sign-in server sent too large a response.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<{ status: number; headers: Headers; body: string }> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: combined });
  } catch (error) {
    if (signal?.aborted) throw new McpOAuthError("Sign-in was cancelled.");
    throw new McpOAuthError(`${new URL(url).host} could not be reached${error instanceof Error ? `: ${error.message}` : "."}`);
  }
  return { status: response.status, headers: response.headers, body: await readBounded(response) };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** The parameters of a `Bearer` challenge (RFC 6750), such as `resource_metadata` and `scope`. */
export function parseBearerChallenge(header: string | null): Record<string, string> {
  if (header === null) return {};
  const bearer = header.match(/Bearer\s+(.*)$/i);
  if (bearer === null) return {};
  const parameters: Record<string, string> = {};
  for (const match of bearer[1].matchAll(/([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) {
    parameters[match[1].toLowerCase()] = (match[2] ?? match[3]).replace(/\\(.)/g, "$1");
  }
  return parameters;
}

export type AuthorizationServerMetadata = Readonly<{
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  revocationEndpoint?: string;
  clientIdMetadataDocumentSupported: boolean;
  issParameterSupported: boolean;
  scopesSupported?: readonly string[];
}>;

export type Discovery = Readonly<{
  resource: string;
  /** What to ask for: the server's challenge, else everything it supports. */
  scope?: string;
  server: AuthorizationServerMetadata;
}>;

const stringList = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value as string[] : undefined;

/** The well-known metadata addresses for an issuer, path-inserted first (RFC 8414, OIDC). */
function authorizationMetadataUrls(issuer: URL): string[] {
  const path = issuer.pathname.replace(/\/$/, "");
  if (path === "") {
    return [`${issuer.origin}/.well-known/oauth-authorization-server`, `${issuer.origin}/.well-known/openid-configuration`];
  }
  return [
    `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
    `${issuer.origin}/.well-known/openid-configuration${path}`,
    `${issuer.origin}${path}/.well-known/openid-configuration`,
  ];
}

async function fetchMetadata(fetchImpl: typeof fetch, urls: readonly string[], signal: AbortSignal | undefined): Promise<Record<string, unknown> | undefined> {
  for (const url of urls) {
    const response = await request(fetchImpl, url, { headers: { accept: "application/json" } }, signal);
    if (response.status !== 200) continue;
    const parsed = parseJson(response.body);
    if (isRecord(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Find how to sign in to the server at `serverUrl`. Throws an
 * `McpOAuthError` whose message says what the server got wrong, or what the
 * user can do about it.
 */
export async function discoverAuthorization(serverUrl: string, options: OAuthDependencies & { signal?: AbortSignal } = {}): Promise<Discovery> {
  const fetchImpl = options.fetch ?? fetch;
  const server = new URL(serverUrl);
  // A request without a token: a server that wants one answers 401 and says
  // where its metadata is.
  const probe = await request(fetchImpl, serverUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Roqer", version: "sign-in" } },
    }),
    redirect: "error",
  }, options.signal);
  const challenge = probe.status === 401 ? parseBearerChallenge(probe.headers.get("www-authenticate")) : {};
  const path = server.pathname.replace(/\/$/, "");
  const resourceUrls = [
    ...(challenge.resource_metadata !== undefined && isSecureEndpoint(challenge.resource_metadata) ? [challenge.resource_metadata] : []),
    ...(path === "" ? [] : [`${server.origin}/.well-known/oauth-protected-resource${path}`]),
    `${server.origin}/.well-known/oauth-protected-resource`,
  ];
  const protectedResource = await fetchMetadata(fetchImpl, resourceUrls, options.signal);
  if (protectedResource === undefined) {
    throw new McpOAuthError(probe.status === 401
      ? "The server asks for a sign-in but does not say where. It may not follow the MCP sign-in standard."
      : "The server does not offer an OAuth sign-in. Use a header with a key instead.");
  }
  const resource = protectedResource.resource;
  if (typeof resource !== "string" || !isSecureEndpoint(resource)) {
    throw new McpOAuthError("The server's sign-in metadata does not name the server.");
  }
  // RFC 9728: metadata for another resource must not be used for this one.
  if (canonicalResource(resource) !== canonicalResource(serverUrl)) {
    throw new McpOAuthError(`This server says its address is ${resource}. Change the URL in Settings to that, then sign in.`);
  }
  const issuerValue = (stringList(protectedResource.authorization_servers) ?? []).find(isSecureEndpoint);
  if (issuerValue === undefined) throw new McpOAuthError("The server does not name a sign-in server Roqer can use.");
  const issuer = new URL(issuerValue);
  const metadata = await fetchMetadata(fetchImpl, authorizationMetadataUrls(issuer), options.signal);
  if (metadata === undefined) throw new McpOAuthError(`The sign-in server ${issuer.host} publishes no metadata.`);
  if (typeof metadata.issuer !== "string" || metadata.issuer.replace(/\/$/, "") !== issuerValue.replace(/\/$/, "")) {
    throw new McpOAuthError(`The sign-in server's metadata names a different issuer than ${issuer.host}.`);
  }
  const { authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint } = metadata;
  if (!isSecureEndpoint(authorizationEndpoint) || !isSecureEndpoint(tokenEndpoint)) {
    throw new McpOAuthError("The sign-in server's endpoints are not HTTPS.");
  }
  // MCP requires S256 PKCE, and a server that does not say it has it may not.
  if (!(stringList(metadata.code_challenge_methods_supported) ?? []).includes("S256")) {
    throw new McpOAuthError("The sign-in server does not offer PKCE (S256), which MCP requires.");
  }
  const scopesSupported = stringList(protectedResource.scopes_supported) ?? stringList(metadata.scopes_supported);
  const scope = challenge.scope ?? (scopesSupported === undefined || scopesSupported.length === 0 ? undefined : scopesSupported.join(" "));
  return {
    resource,
    ...(scope === undefined ? {} : { scope }),
    server: {
      issuer: metadata.issuer,
      authorizationEndpoint,
      tokenEndpoint,
      ...(isSecureEndpoint(metadata.registration_endpoint) ? { registrationEndpoint: metadata.registration_endpoint } : {}),
      ...(isSecureEndpoint(metadata.revocation_endpoint) ? { revocationEndpoint: metadata.revocation_endpoint } : {}),
      clientIdMetadataDocumentSupported: metadata.client_id_metadata_document_supported === true,
      issParameterSupported: metadata.authorization_response_iss_parameter_supported === true,
      ...(scopesSupported === undefined ? {} : { scopesSupported }),
    },
  };
}

// -- The loopback callback --------------------------------------------------

type Callback = { redirectUri: string; result: Promise<URLSearchParams>; close: () => void };

const CALLBACK_PAGE = (title: string, detail: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;margin:48px;color:#222"><h1 style="font-size:20px">${title}</h1><p>${detail}</p></body>`;

/**
 * Listen on 127.0.0.1 for the browser's return. Only an answer that carries
 * `state` settles it: anything else that reaches the port is turned away
 * without ending the sign-in, so a stray page cannot cancel it.
 */
async function listenForCallback(state: string, preferredPort: number): Promise<Callback> {
  let settle!: (params: URLSearchParams) => void;
  const result = new Promise<URLSearchParams>((resolve) => { settle = resolve; });
  const server = http.createServer((incoming, response) => {
    const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
    if (incoming.method !== "GET" || url.pathname !== "/callback" || url.searchParams.get("state") !== state) {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    const failed = url.searchParams.has("error");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
      .end(failed
        ? CALLBACK_PAGE("Sign-in did not finish", "Return to Roqer to see why.")
        : CALLBACK_PAGE("Signed in", "You can close this tab and return to Roqer."));
    settle(url.searchParams);
  });
  const listen = (port: number) => new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as { port: number }).port);
    });
  });
  let port: number;
  try {
    port = await listen(preferredPort);
  } catch {
    // The usual port is taken: any other, which a provider following RFC 8252 accepts.
    port = await listen(0);
  }
  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    result,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

// -- Tokens -----------------------------------------------------------------

type TokenAnswer = { accessToken: string; refreshToken?: string; expiresIn?: number; scope?: string };

async function tokenRequest(
  fetchImpl: typeof fetch,
  endpoint: string,
  form: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<TokenAnswer> {
  const response = await request(fetchImpl, endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    // A redirect would carry the code or the refresh token elsewhere.
    redirect: "error",
  }, signal);
  const parsed = parseJson(response.body);
  if (response.status !== 200 || !isRecord(parsed)) {
    const code = isRecord(parsed) && typeof parsed.error === "string" ? parsed.error : undefined;
    const description = isRecord(parsed) && typeof parsed.error_description === "string" ? `: ${parsed.error_description.slice(0, 300)}` : "";
    throw new McpOAuthError(
      code === "invalid_grant"
        ? "The sign-in has expired or was revoked. Sign in again in Settings."
        : `The sign-in server refused the token request (${code ?? `HTTP ${response.status}`})${description}`,
      code === "invalid_grant",
    );
  }
  const { access_token: accessToken, token_type: tokenType, refresh_token: refreshToken, expires_in: expiresIn, scope } = parsed;
  if (typeof accessToken !== "string" || accessToken.length === 0 || accessToken.length > MAX_TOKEN_CHARACTERS || /\s/.test(accessToken)) {
    throw new McpOAuthError("The sign-in server sent no usable access token.");
  }
  if (typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer") {
    throw new McpOAuthError("The sign-in server sent a token of a kind Roqer cannot use.");
  }
  return {
    accessToken,
    ...(typeof refreshToken === "string" && refreshToken.length > 0 && refreshToken.length <= MAX_TOKEN_CHARACTERS ? { refreshToken } : {}),
    ...(typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresIn } : {}),
    ...(typeof scope === "string" ? { scope } : {}),
  };
}

/** The client this sign-in uses: the user's, Roqer's published one, or one registered now. */
async function chooseClient(
  discovery: Discovery,
  manualClientId: string | undefined,
  previous: OAuthGrant | undefined,
  redirectUri: string,
  options: SignInOptions,
): Promise<{ clientId: string; clientSecret?: string; registration: OAuthRegistration }> {
  if (manualClientId !== undefined) return { clientId: manualClientId, registration: "manual" };
  if (discovery.server.clientIdMetadataDocumentSupported) {
    return { clientId: options.clientMetadataUrl ?? ROQER_OAUTH_CLIENT_METADATA_URL, registration: "metadata" };
  }
  // A client this provider registered for Roqer before is used again.
  if (previous?.registration === "dynamic" && previous.issuer === discovery.server.issuer) {
    return { clientId: previous.clientId, ...(previous.clientSecret === undefined ? {} : { clientSecret: previous.clientSecret }), registration: "dynamic" };
  }
  if (discovery.server.registrationEndpoint === undefined) {
    throw new McpOAuthError("This server's sign-in needs a client ID registered with its provider. Enter one in Settings, then sign in.");
  }
  const fixed = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`;
  const response = await request(options.fetch ?? fetch, discovery.server.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "Roqer",
      client_uri: "https://github.com/S4US/Roqer",
      redirect_uris: [...new Set([fixed, redirectUri])],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    redirect: "error",
  }, options.signal);
  const parsed = parseJson(response.body);
  if ((response.status !== 200 && response.status !== 201) || !isRecord(parsed) || typeof parsed.client_id !== "string" || parsed.client_id === "") {
    throw new McpOAuthError(`The sign-in server would not register Roqer (HTTP ${response.status}).`);
  }
  return {
    clientId: parsed.client_id,
    ...(typeof parsed.client_secret === "string" && parsed.client_secret !== "" ? { clientSecret: parsed.client_secret } : {}),
    registration: "dynamic",
  };
}

/**
 * Sign in to one server in the user's browser and return the grant to keep.
 * `previous` is the grant already kept, whose dynamically registered client is
 * reused rather than registered again.
 */
export async function signInToMcpServer(
  server: Readonly<{ url: string; oauthClientId?: string }>,
  previous: OAuthGrant | undefined,
  options: SignInOptions,
): Promise<OAuthGrant> {
  const now = options.now ?? Date.now;
  const discovery = await discoverAuthorization(server.url, options);
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const callback = await listenForCallback(state, options.callbackPort ?? OAUTH_CALLBACK_PORT);
  try {
    const client = await chooseClient(discovery, server.oauthClientId, previous, callback.redirectUri, options);
    const authorize = new URL(discovery.server.authorizationEndpoint);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", client.clientId);
    authorize.searchParams.set("redirect_uri", callback.redirectUri);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("resource", discovery.resource);
    if (discovery.scope !== undefined) authorize.searchParams.set("scope", discovery.scope);
    await options.openBrowser(authorize.href);

    const waited = await new Promise<URLSearchParams>((resolve, reject) => {
      // Whichever ends the wait clears the other two, so a cancelled sign-in
      // leaves no timer running for minutes after it.
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        settle();
      };
      const timer = setTimeout(
        () => finish(() => reject(new McpOAuthError("Sign-in timed out. Try again, and finish it in the browser."))),
        options.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
      );
      const onAbort = () => finish(() => reject(new McpOAuthError("Sign-in was cancelled.")));
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener("abort", onAbort, { once: true });
      void callback.result.then((params) => finish(() => resolve(params)));
    });
    // RFC 9207: the answer must come from the server this sign-in went to.
    const iss = waited.get("iss");
    if ((iss !== null || discovery.server.issParameterSupported) && iss?.replace(/\/$/, "") !== discovery.server.issuer.replace(/\/$/, "")) {
      throw new McpOAuthError("The sign-in answer came from a different server than the one asked. Nothing was saved.");
    }
    const error = waited.get("error");
    if (error !== null) {
      const description = waited.get("error_description");
      throw new McpOAuthError(error === "access_denied"
        ? "Sign-in was declined in the browser."
        : `The sign-in server refused: ${error}${description === null ? "" : ` (${description.slice(0, 300)})`}`);
    }
    const code = waited.get("code");
    if (code === null || code === "") throw new McpOAuthError("The sign-in answer carried no code.");

    const tokens = await tokenRequest(options.fetch ?? fetch, discovery.server.tokenEndpoint, {
      grant_type: "authorization_code",
      code,
      redirect_uri: callback.redirectUri,
      client_id: client.clientId,
      code_verifier: verifier,
      resource: discovery.resource,
      ...(client.clientSecret === undefined ? {} : { client_secret: client.clientSecret }),
    }, options.signal);
    return {
      issuer: discovery.server.issuer,
      tokenEndpoint: discovery.server.tokenEndpoint,
      ...(discovery.server.revocationEndpoint === undefined ? {} : { revocationEndpoint: discovery.server.revocationEndpoint }),
      resource: discovery.resource,
      clientId: client.clientId,
      ...(client.clientSecret === undefined ? {} : { clientSecret: client.clientSecret }),
      registration: client.registration,
      accessToken: tokens.accessToken,
      ...(tokens.refreshToken === undefined ? {} : { refreshToken: tokens.refreshToken }),
      ...(tokens.expiresIn === undefined ? {} : { expiresAt: now() + tokens.expiresIn * 1_000 }),
      ...(tokens.scope === undefined ? (discovery.scope === undefined ? {} : { scope: discovery.scope }) : { scope: tokens.scope }),
    };
  } finally {
    callback.close();
  }
}

/** Whether a grant's access token should be renewed before it is used. */
export function grantExpiring(grant: OAuthGrant, now: number): boolean {
  return grant.expiresAt !== undefined && grant.expiresAt - EXPIRY_MARGIN_MS <= now;
}

/** A new access token for a grant. Throws `McpOAuthError` with `signedOut` when it cannot be renewed. */
export async function refreshMcpGrant(grant: OAuthGrant, options: OAuthDependencies & { signal?: AbortSignal } = {}): Promise<OAuthGrant> {
  if (grant.refreshToken === undefined) throw new McpOAuthError("The sign-in has expired. Sign in again in Settings.", true);
  const now = options.now ?? Date.now;
  const tokens = await tokenRequest(options.fetch ?? fetch, grant.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: grant.refreshToken,
    client_id: grant.clientId,
    resource: grant.resource,
    ...(grant.clientSecret === undefined ? {} : { client_secret: grant.clientSecret }),
  }, options.signal);
  // The old expiry goes with the old token; a new one without an expiry has none.
  const rest: Record<string, unknown> = { ...grant };
  delete rest.expiresAt;
  return {
    ...(rest as Omit<OAuthGrant, "expiresAt">),
    accessToken: tokens.accessToken,
    // A server that rotates refresh tokens sends a new one; one that does not keeps the old.
    refreshToken: tokens.refreshToken ?? grant.refreshToken,
    ...(tokens.expiresIn === undefined ? {} : { expiresAt: now() + tokens.expiresIn * 1_000 }),
    ...(tokens.scope === undefined ? {} : { scope: tokens.scope }),
  };
}

/** Ask the provider to forget a grant. A courtesy: signing out never waits on it succeeding. */
export async function revokeMcpGrant(grant: OAuthGrant, options: OAuthDependencies = {}): Promise<void> {
  if (grant.revocationEndpoint === undefined) return;
  const token = grant.refreshToken ?? grant.accessToken;
  try {
    await request(options.fetch ?? fetch, grant.revocationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        token_type_hint: grant.refreshToken === undefined ? "access_token" : "refresh_token",
        client_id: grant.clientId,
        ...(grant.clientSecret === undefined ? {} : { client_secret: grant.clientSecret }),
      }).toString(),
      redirect: "error",
    }, undefined);
  } catch {
    // Nothing to do about it; the tokens are gone from this computer either way.
  }
}

const OPTIONAL_STRING_KEYS = ["revocationEndpoint", "clientSecret", "refreshToken", "scope"] as const;

/** A grant read back from storage, checked as strictly as one just received. */
export function isOAuthGrant(value: unknown): value is OAuthGrant {
  if (!isRecord(value)) return false;
  const allowed = new Set(["issuer", "tokenEndpoint", "resource", "clientId", "registration", "accessToken", "expiresAt", ...OPTIONAL_STRING_KEYS]);
  if (!Object.keys(value).every((key) => allowed.has(key))) return false;
  return typeof value.issuer === "string" && isSecureEndpoint(value.tokenEndpoint) && isSecureEndpoint(value.resource) &&
    typeof value.clientId === "string" && value.clientId !== "" &&
    (value.registration === "manual" || value.registration === "metadata" || value.registration === "dynamic") &&
    typeof value.accessToken === "string" && value.accessToken !== "" &&
    (value.expiresAt === undefined || (typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt))) &&
    (value.revocationEndpoint === undefined || isSecureEndpoint(value.revocationEndpoint)) &&
    OPTIONAL_STRING_KEYS.every((key) => value[key] === undefined || typeof value[key] === "string");
}
