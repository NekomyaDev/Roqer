import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { connectExternalMcp, ExternalMcpError } from "./external-mcp-client";
import {
  isOAuthGrant, McpOAuthError, parseBearerChallenge, refreshMcpGrant, signInToMcpServer, type OAuthGrant,
} from "./mcp-oauth";
import { McpOAuthTokens, type OAuthGrantStore } from "./mcp-oauth-tokens";
import { OAUTH_CALLBACK_PORT, ROQER_OAUTH_CLIENT_METADATA_URL, type McpServerConfig } from "../shared/mcp-servers";

type Options = {
  cimd?: boolean;
  registration?: boolean;
  s256?: boolean;
  /** What the protected resource metadata says the server is. */
  resource?: (base: string) => string;
  /** What the callback's `iss` says. */
  iss?: (base: string) => string | null;
  rotate?: boolean;
};

type Seen = {
  tokenForms: URLSearchParams[];
  registrations: Record<string, unknown>[];
  mcpAuthorizations: (string | undefined)[];
  /** Access tokens the MCP endpoint accepts. */
  valid: Set<string>;
};

/**
 * One local server playing both parts: an MCP server at /mcp that wants a
 * token, and the authorization server that issues it.
 */
async function withAuthServer(options: Options, run: (base: string, seen: Seen) => Promise<void>): Promise<void> {
  const seen: Seen = { tokenForms: [], registrations: [], mcpAuthorizations: [], valid: new Set() };
  let issued = 0;
  let base = "";
  const json = (response: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
    response.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", base);
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (url.pathname === "/mcp") {
        const authorization = request.headers.authorization;
        seen.mcpAuthorizations.push(authorization);
        const token = authorization?.replace(/^Bearer /, "");
        if (token === undefined || !seen.valid.has(token)) {
          response.writeHead(401, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="sounds speech"` }).end();
          return;
        }
        const message = JSON.parse(body) as { id?: number; method: string };
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        const result = message.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: { tools: {} } }
          : message.method === "tools/list" ? { tools: [{ name: "sound", description: "Make a sound." }] } : {};
        json(response, 200, { jsonrpc: "2.0", id: message.id, result });
        return;
      }
      if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        json(response, 200, { resource: options.resource?.(base) ?? `${base}/mcp`, authorization_servers: [`${base}/auth`], scopes_supported: ["everything"] });
        return;
      }
      if (url.pathname === "/.well-known/oauth-authorization-server/auth") {
        json(response, 200, {
          issuer: `${base}/auth`,
          authorization_endpoint: `${base}/auth/authorize`,
          token_endpoint: `${base}/auth/token`,
          revocation_endpoint: `${base}/auth/revoke`,
          ...(options.registration ? { registration_endpoint: `${base}/auth/register` } : {}),
          code_challenge_methods_supported: options.s256 === false ? ["plain"] : ["S256"],
          client_id_metadata_document_supported: options.cimd === true,
          authorization_response_iss_parameter_supported: true,
        });
        return;
      }
      if (url.pathname === "/auth/register") {
        seen.registrations.push(JSON.parse(body) as Record<string, unknown>);
        json(response, 201, { client_id: `registered-${seen.registrations.length}` });
        return;
      }
      if (url.pathname === "/auth/token") {
        const form = new URLSearchParams(body);
        seen.tokenForms.push(form);
        if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") === "revoked") {
          json(response, 400, { error: "invalid_grant" });
          return;
        }
        issued += 1;
        const accessToken = `access-${issued}`;
        seen.valid.add(accessToken);
        json(response, 200, {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 3600,
          ...(form.get("grant_type") === "authorization_code" || options.rotate ? { refresh_token: `refresh-${issued}` } : {}),
        });
        return;
      }
      response.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await run(base, seen);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** The browser: checks the authorization request, then returns to Roqer the way the provider would. */
function browser(base: string, options: Options, opened: URL[] = []) {
  return async (address: string) => {
    const url = new URL(address);
    opened.push(url);
    const redirect = new URL(url.searchParams.get("redirect_uri")!);
    // A stray request to the listener, with the wrong state, changes nothing.
    assert.equal((await fetch(`${redirect.href}?code=evil&state=wrong`)).status, 404);
    redirect.searchParams.set("code", "the-code");
    redirect.searchParams.set("state", url.searchParams.get("state")!);
    const iss = options.iss === undefined ? `${base}/auth` : options.iss(base);
    if (iss !== null) redirect.searchParams.set("iss", iss);
    void fetch(redirect).catch(() => undefined);
  };
}

test("a server that reads client metadata is signed in to with Roqer's published client, PKCE and the resource", async () => {
  const options: Options = { cimd: true };
  await withAuthServer(options, async (base, seen) => {
    const opened: URL[] = [];
    const grant = await signInToMcpServer({ url: `${base}/mcp` }, undefined, {
      openBrowser: browser(base, options, opened), callbackPort: 0, now: () => 1_000,
    });
    const [authorize] = opened;
    assert.equal(authorize.origin + authorize.pathname, `${base}/auth/authorize`);
    assert.equal(authorize.searchParams.get("client_id"), ROQER_OAUTH_CLIENT_METADATA_URL);
    assert.equal(authorize.searchParams.get("response_type"), "code");
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorize.searchParams.get("resource"), `${base}/mcp`);
    assert.equal(authorize.searchParams.get("scope"), "sounds speech", "the scope the server's challenge asked for");
    assert.match(authorize.searchParams.get("redirect_uri")!, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const [form] = seen.tokenForms;
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "the-code");
    assert.equal(form.get("resource"), `${base}/mcp`);
    assert.equal(form.get("redirect_uri"), authorize.searchParams.get("redirect_uri"));
    const verifier = form.get("code_verifier")!;
    assert.equal(createHash("sha256").update(verifier).digest("base64url"), authorize.searchParams.get("code_challenge"), "the verifier matches the challenge");
    assert.equal(seen.registrations.length, 0, "no registration is needed");

    assert.deepEqual(grant, {
      issuer: `${base}/auth`, tokenEndpoint: `${base}/auth/token`, revocationEndpoint: `${base}/auth/revoke`,
      resource: `${base}/mcp`, clientId: ROQER_OAUTH_CLIENT_METADATA_URL, registration: "metadata",
      accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 1_000 + 3_600_000, scope: "sounds speech",
    });
    assert.equal(isOAuthGrant(grant), true);
  });
});

test("a server with dynamic registration registers Roqer once, and a later sign-in reuses it", async () => {
  const options: Options = { registration: true };
  await withAuthServer(options, async (base, seen) => {
    const first = await signInToMcpServer({ url: `${base}/mcp` }, undefined, { openBrowser: browser(base, options), callbackPort: 0 });
    assert.equal(first.clientId, "registered-1");
    assert.equal(first.registration, "dynamic");
    assert.equal(seen.registrations[0].token_endpoint_auth_method, "none");
    assert.ok((seen.registrations[0].redirect_uris as string[]).includes(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`));

    const second = await signInToMcpServer({ url: `${base}/mcp` }, first, { openBrowser: browser(base, options), callbackPort: 0 });
    assert.equal(second.clientId, "registered-1");
    assert.equal(seen.registrations.length, 1);
  });
});

test("a client ID the user entered wins over every other way", async () => {
  const options: Options = { cimd: true, registration: true };
  await withAuthServer(options, async (base, seen) => {
    const opened: URL[] = [];
    const grant = await signInToMcpServer({ url: `${base}/mcp`, oauthClientId: "my-app" }, undefined, { openBrowser: browser(base, options, opened), callbackPort: 0 });
    assert.equal(opened[0].searchParams.get("client_id"), "my-app");
    assert.equal(grant.registration, "manual");
    assert.equal(seen.registrations.length, 0);
  });
});

test("a server with no way to identify Roqer asks for a client ID", async () => {
  await withAuthServer({}, async (base) => {
    await assert.rejects(
      signInToMcpServer({ url: `${base}/mcp` }, undefined, { openBrowser: async () => assert.fail("no page should open"), callbackPort: 0 }),
      /needs a client ID registered with its provider/,
    );
  });
});

test("metadata for another address, a server without S256, or an answer from another issuer is refused", async () => {
  await withAuthServer({ cimd: true, resource: () => "https://api.elsewhere.example/v1/mcp" }, async (base) => {
    await assert.rejects(
      signInToMcpServer({ url: `${base}/mcp` }, undefined, { openBrowser: async () => assert.fail("no page should open"), callbackPort: 0 }),
      /says its address is https:\/\/api\.elsewhere\.example\/v1\/mcp/,
    );
  });
  await withAuthServer({ cimd: true, s256: false }, async (base) => {
    await assert.rejects(signInToMcpServer({ url: `${base}/mcp` }, undefined, { openBrowser: async () => undefined, callbackPort: 0 }), /PKCE/);
  });
  for (const iss of [() => "https://attacker.example", () => null]) {
    const options: Options = { cimd: true, iss };
    await withAuthServer(options, async (base, seen) => {
      await assert.rejects(
        signInToMcpServer({ url: `${base}/mcp` }, undefined, { openBrowser: browser(base, options), callbackPort: 0 }),
        /different server/,
      );
      assert.equal(seen.tokenForms.length, 0, "the code is never exchanged");
    });
  }
});

test("a sign-in can be cancelled while it waits for the browser", async () => {
  await withAuthServer({ cimd: true }, async (base) => {
    const controller = new AbortController();
    const signing = signInToMcpServer({ url: `${base}/mcp` }, undefined, {
      openBrowser: async () => { setTimeout(() => controller.abort(), 10); },
      callbackPort: 0,
      signal: controller.signal,
    });
    await assert.rejects(signing, /cancelled/);
  });
});

test("a refresh keeps the old refresh token unless the server rotates it; a revoked one signs out", async () => {
  await withAuthServer({}, async (base, seen) => {
    const grant: OAuthGrant = {
      issuer: `${base}/auth`, tokenEndpoint: `${base}/auth/token`, resource: `${base}/mcp`, clientId: "c", registration: "dynamic",
      accessToken: "old", refreshToken: "refresh-0", expiresAt: 0,
    };
    const renewed = await refreshMcpGrant(grant, { now: () => 5 });
    assert.equal(renewed.accessToken, "access-1");
    assert.equal(renewed.refreshToken, "refresh-0");
    assert.equal(renewed.expiresAt, 5 + 3_600_000);
    assert.equal(seen.tokenForms[0].get("resource"), `${base}/mcp`);

    await assert.rejects(refreshMcpGrant({ ...grant, refreshToken: "revoked" }), (error: unknown) =>
      error instanceof McpOAuthError && error.signedOut);
  });
});

/** A grant store in memory, as the real one behaves for the keeper. */
function memoryStore(grant: OAuthGrant | undefined): OAuthGrantStore & { current: () => OAuthGrant | undefined; writes: number } {
  let current = grant;
  const store = {
    writes: 0,
    current: () => current,
    oauthGrant: async () => current,
    setOAuthGrant: async (_id: string, next: OAuthGrant | undefined) => {
      store.writes += 1;
      current = next;
    },
  };
  return store;
}

const SERVER: McpServerConfig = {
  id: "mcp-abcd1234", name: "sounds", enabled: true, transport: "http", url: "http://127.0.0.1/mcp", auth: "oauth", newTools: "trust", toolRisk: {},
};

test("the client sends the token, and after a 401 renews it once and tries again", async () => {
  await withAuthServer({ rotate: true }, async (base, seen) => {
    const store = memoryStore({
      issuer: `${base}/auth`, tokenEndpoint: `${base}/auth/token`, resource: `${base}/mcp`, clientId: "c", registration: "metadata",
      accessToken: "stale", refreshToken: "refresh-0",
    });
    const tokens = new McpOAuthTokens(store);
    const connection = await connectExternalMcp(
      { transport: "http", url: `${base}/mcp`, headers: {}, authorization: tokens.authorizationFor(SERVER) },
      { clientVersion: "test", timeoutMs: 5_000 },
    );
    assert.deepEqual((await connection.listTools()).map((tool) => tool.name), ["sound"]);
    await connection.close();
    assert.deepEqual(seen.mcpAuthorizations.slice(0, 2), ["Bearer stale", "Bearer access-1"]);
    assert.equal(store.current()?.accessToken, "access-1", "the renewed sign-in is kept");
    assert.equal(store.current()?.refreshToken, "refresh-1", "with the rotated refresh token");
    assert.equal(seen.tokenForms.length, 1, "one renewal for the whole connection");
  });
});

test("a sign-in that cannot be renewed fails the call as signed out, and is forgotten", async () => {
  await withAuthServer({}, async (base) => {
    const store = memoryStore({
      issuer: `${base}/auth`, tokenEndpoint: `${base}/auth/token`, resource: `${base}/mcp`, clientId: "c", registration: "metadata",
      accessToken: "stale", refreshToken: "revoked",
    });
    await assert.rejects(
      connectExternalMcp(
        { transport: "http", url: `${base}/mcp`, headers: {}, authorization: new McpOAuthTokens(store).authorizationFor(SERVER) },
        { clientVersion: "test", timeoutMs: 5_000 },
      ),
      (error: unknown) => error instanceof ExternalMcpError && error.code === "unauthorized" && /Sign in again/.test(error.message),
    );
    assert.equal(store.current(), undefined);
  });
});

test("requests that need a renewal at once share one, and an unreachable provider signs no one out", async () => {
  let refreshes = 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    refreshes += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (String(init?.body).includes("unreachable")) throw new Error("ECONNREFUSED");
    return new Response(JSON.stringify({ access_token: `fresh-${refreshes}`, token_type: "bearer", refresh_token: `r-${refreshes}` }), { status: 200 });
  }) as typeof fetch;
  const grant: OAuthGrant = {
    issuer: "https://auth.example", tokenEndpoint: "https://auth.example/token", resource: "https://mcp.example/mcp", clientId: "c",
    registration: "metadata", accessToken: "stale", refreshToken: "r-0",
  };
  const store = memoryStore(grant);
  const authorization = new McpOAuthTokens(store, { fetch: fetchImpl }).authorizationFor(SERVER);
  const renewed = await Promise.all([authorization.renew("stale"), authorization.renew("stale"), authorization.renew("stale")]);
  assert.deepEqual(renewed, ["fresh-1", "fresh-1", "fresh-1"]);
  assert.equal(refreshes, 1);
  // A request that saw the old token after the renewal gets the new one, not another renewal.
  assert.equal(await authorization.renew("stale"), "fresh-1");
  assert.equal(refreshes, 1);

  const offline = memoryStore({ ...grant, refreshToken: "unreachable" });
  assert.equal(await new McpOAuthTokens(offline, { fetch: fetchImpl }).authorizationFor(SERVER).renew("stale"), undefined);
  assert.notEqual(offline.current(), undefined, "the sign-in is kept for when the provider is back");
});

test("a bearer challenge's parameters are read, quoted or not", () => {
  assert.deepEqual(
    parseBearerChallenge('Bearer resource_metadata="https://a.example/.well-known/oauth-protected-resource", scope=read, error="invalid_token"'),
    { resource_metadata: "https://a.example/.well-known/oauth-protected-resource", scope: "read", error: "invalid_token" },
  );
  assert.deepEqual(parseBearerChallenge("Basic realm=x"), {});
  assert.deepEqual(parseBearerChallenge(null), {});
});

test("the published client metadata names Roqer's client ID and callback", async () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "oauth", "client-metadata.json");
  const metadata = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  assert.equal(metadata.client_id, ROQER_OAUTH_CLIENT_METADATA_URL, "the document's client_id must be the URL it is published at");
  assert.ok((metadata.redirect_uris as string[]).includes(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`));
  assert.equal(metadata.token_endpoint_auth_method, "none");
});
