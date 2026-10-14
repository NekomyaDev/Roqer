import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { McpServerStore, type ConfirmCommand } from "./mcp-server-store";
import type { OAuthGrant } from "./mcp-oauth";
import type { SecretProtector } from "./secret-protector";
import type { McpServerSave } from "../shared/mcp-servers";

/** Reversible and visibly not plaintext, so a test can tell whether a key reached the file. */
function protector(available = true): SecretProtector {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${Buffer.from(value).toString("hex")}`),
    decryptString: (value) => {
      const text = value.toString();
      if (!text.startsWith("enc:")) throw new Error("not ours");
      return Buffer.from(text.slice(4), "hex").toString();
    },
  };
}

async function withStore(run: (store: McpServerStore, file: string) => Promise<void>, available = true): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "roqer-mcp-servers-"));
  try {
    const file = path.join(directory, "mcp-servers.json");
    await run(new McpServerStore({ file, protector: protector(available) }), file);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

/** Records every program the user was asked about, and answers with `answer`. */
function confirmer(answer = true): ConfirmCommand & { asked: string[] } {
  const asked: string[] = [];
  const confirm = (async ({ commandLine }: { commandLine: string }) => {
    asked.push(commandLine);
    return answer;
  }) as unknown as ConfirmCommand & { asked: string[] };
  confirm.asked = asked;
  return confirm;
}

const GITHUB: McpServerSave = {
  name: "github",
  enabled: true,
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  newTools: "trust",
  toolRisk: { search_issues: "read" },
  secrets: [{ name: "GITHUB_TOKEN", value: "ghp-secret-123" }],
};

const REMOTE: McpServerSave = {
  name: "docs",
  enabled: true,
  transport: "http",
  url: "https://mcp.example.com/mcp",
  newTools: "review",
  toolRisk: {},
  secrets: [{ name: "Authorization", value: "Bearer secret-456" }],
};

test("a stdio server is saved only after the user allows its program, with its keys encrypted and hidden", async () => {
  await withStore(async (store, file) => {
    const confirm = confirmer();
    const [saved] = await store.save(GITHUB, confirm);
    assert.deepEqual(confirm.asked, ["npx -y @modelcontextprotocol/server-github"]);
    assert.match(saved.id, /^mcp-[a-z0-9]{8}$/);
    assert.deepEqual(saved.secretNames, ["GITHUB_TOKEN"]);
    assert.equal(JSON.stringify(saved).includes("ghp-secret-123"), false);
    assert.equal((await fs.readFile(file, "utf8")).includes("ghp-secret-123"), false, "the key never reaches disk in plaintext");

    const resolved = await store.resolve({ name: "github" });
    assert.deepEqual(resolved?.secrets, { GITHUB_TOKEN: "ghp-secret-123" });

    const reopened = new McpServerStore({ file, protector: protector() });
    assert.deepEqual(await reopened.list(), [saved]);
  });
});

test("a declined program is not saved", async () => {
  await withStore(async (store, file) => {
    await assert.rejects(store.save(GITHUB, confirmer(false)), /did not allow/);
    assert.deepEqual(await store.list(), []);
    await assert.rejects(fs.stat(file), { code: "ENOENT" });
  });
});

test("an edit asks again only when the program changes", async () => {
  await withStore(async (store) => {
    const [saved] = await store.save(GITHUB, confirmer());
    const unchanged = confirmer();
    await store.save({ ...GITHUB, id: saved.id, enabled: false, secrets: undefined }, unchanged);
    assert.deepEqual(unchanged.asked, [], "turning it off runs nothing new");

    const changed = confirmer(false);
    await assert.rejects(store.save({ ...GITHUB, id: saved.id, args: ["-y", "other-package"] }, changed), /did not allow/);
    assert.deepEqual(changed.asked, ["npx -y other-package"]);
    assert.deepEqual((await store.list())[0].args, GITHUB.args, "a declined change leaves the saved program as it was");
  });
});

test("a kept key does not follow the server to another program or origin", async () => {
  await withStore(async (store) => {
    const [stdio] = await store.save(GITHUB, confirmer());
    await assert.rejects(
      store.save({ ...GITHUB, id: stdio.id, args: ["-y", "evil-package"], secrets: [{ name: "GITHUB_TOKEN" }] }, confirmer()),
      /points somewhere else/,
    );
    await assert.rejects(
      store.save({ ...GITHUB, id: stdio.id, args: ["-y", "evil-package"], secrets: undefined }, confirmer()),
      /points somewhere else/,
    );
    // Entering the value again is the user's word, and allowed.
    await store.save({ ...GITHUB, id: stdio.id, args: ["-y", "evil-package"], secrets: [{ name: "GITHUB_TOKEN", value: "new" }] }, confirmer());

    const [, http] = await store.save(REMOTE, confirmer());
    await assert.rejects(
      store.save({ ...REMOTE, id: http.id, url: "https://attacker.example/mcp", secrets: [{ name: "authorization" }] }, confirmer()),
      /points somewhere else/,
    );
    // The same origin keeps it; header names match whatever their case.
    const after = await store.save({ ...REMOTE, id: http.id, url: "https://mcp.example.com/v2/mcp", secrets: [{ name: "authorization" }] }, confirmer());
    assert.deepEqual(after[1].secretNames, ["authorization"]);
    assert.deepEqual((await store.resolve({ id: http.id }))?.secrets, { authorization: "Bearer secret-456" });
  });
});

test("an http server needs no confirmation, and a missing value for a new secret is refused", async () => {
  await withStore(async (store) => {
    const confirm = confirmer();
    await store.save(REMOTE, confirm);
    assert.deepEqual(confirm.asked, []);
    await assert.rejects(store.save({ ...REMOTE, name: "other", secrets: [{ name: "X-Api-Key" }] }, confirm), /Enter a value for X-Api-Key/);
  });
});

test("names are unique, because the model calls a server by its name", async () => {
  await withStore(async (store) => {
    await store.save(REMOTE, confirmer());
    await assert.rejects(store.save({ ...REMOTE, url: "https://other.example/mcp" }, confirmer()), /already called docs/);
  });
});

test("enabled() leaves out servers that are off, and peek() reflects the last save", async () => {
  await withStore(async (store) => {
    assert.equal(store.peek(), undefined, "nothing is known before the file is read");
    const [saved] = await store.save(GITHUB, confirmer());
    await store.save(REMOTE, confirmer());
    await store.save({ ...GITHUB, id: saved.id, enabled: false, secrets: undefined }, confirmer());
    assert.deepEqual((await store.enabled()).map((entry) => entry.server.name), ["docs"]);
    assert.deepEqual(store.peek()?.map((server) => [server.name, server.enabled]), [["github", false], ["docs", true]]);
    assert.equal(JSON.stringify(store.peek()).includes("secret"), false, "peek carries no secrets");
  });
});

test("keys cannot be kept without encrypted storage, but a server without keys can", async () => {
  await withStore(async (store) => {
    await assert.rejects(store.save(GITHUB, confirmer()), /no encrypted storage/);
    const [saved] = await store.save({ ...GITHUB, secrets: [] }, confirmer());
    assert.deepEqual(saved.secretNames, []);
  }, false);
});

test("a damaged file is set aside and reported once", async () => {
  await withStore(async (store, file) => {
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, servers: [{ id: "nope" }] }));
    assert.deepEqual(await store.list(), []);
    const preserved = store.takeDamagedNotice();
    assert.ok(preserved?.startsWith(`${file}.damaged-`));
    assert.equal(store.takeDamagedNotice(), undefined);
    assert.match(await fs.readFile(preserved!, "utf8"), /nope/, "the damaged file is kept for diagnosis");
  });
});

const ELEVENLABS: McpServerSave = {
  name: "elevenlabs",
  enabled: true,
  transport: "http",
  url: "https://api.us.elevenlabs.io/v1/mcp",
  auth: "oauth",
  newTools: "trust",
  toolRisk: {},
};

const GRANT: OAuthGrant = {
  issuer: "https://api.us.elevenlabs.io",
  tokenEndpoint: "https://api.us.elevenlabs.io/v1/oauth/token",
  resource: "https://api.us.elevenlabs.io/v1/mcp",
  clientId: "https://s4us.github.io/Roqer/oauth/client-metadata.json",
  registration: "metadata",
  accessToken: "access-secret",
  refreshToken: "refresh-secret",
};

test("a sign-in is encrypted, shown only as signed in, and kept across edits that do not move the server", async () => {
  await withStore(async (store, file) => {
    const [saved] = await store.save(ELEVENLABS, confirmer());
    assert.equal(saved.signedIn, false);
    const [signedIn] = await store.setOAuthGrant(saved.id, GRANT, saved);
    assert.equal(signedIn.signedIn, true);
    assert.equal(/access-secret|refresh-secret/.test(JSON.stringify(signedIn)), false, "the view carries no token");
    assert.equal((await fs.readFile(file, "utf8")).includes("access-secret"), false, "tokens never reach disk in plaintext");
    assert.deepEqual(await store.oauthGrant(saved.id), GRANT);

    const [renamed] = await store.save({ ...ELEVENLABS, id: saved.id, name: "sounds", toolRisk: { text_to_sound_effects: "irreversible" } }, confirmer());
    assert.equal(renamed.signedIn, true, "a rename or a risk change keeps the sign-in");
  });
});

test("a sign-in ends when the address, the client or the auth choice changes", async () => {
  await withStore(async (store) => {
    for (const change of [
      { url: "https://api.eu.residency.elevenlabs.io/v1/mcp" },
      { oauthClientId: "my-app" },
      { auth: undefined },
    ]) {
      const [saved] = await store.save(ELEVENLABS, confirmer());
      await store.setOAuthGrant(saved.id, GRANT, saved);
      const [changed] = await store.save({ ...ELEVENLABS, id: saved.id, ...change }, confirmer());
      assert.notEqual(changed.signedIn, true, JSON.stringify(change));
      assert.equal(await store.oauthGrant(saved.id), undefined);
      await store.remove(saved.id);
    }
  });
});

test("tokens from a sign-in that began before the server changed are not kept", async () => {
  await withStore(async (store) => {
    const [saved] = await store.save(ELEVENLABS, confirmer());
    await store.save({ ...ELEVENLABS, id: saved.id, url: "https://attacker.example/mcp" }, confirmer());
    await assert.rejects(store.setOAuthGrant(saved.id, GRANT, saved), /changed while you were signing in/);
    assert.equal(await store.oauthGrant(saved.id), undefined);
  });
});

test("signing out forgets the sign-in", async () => {
  await withStore(async (store) => {
    const [saved] = await store.save(ELEVENLABS, confirmer());
    await store.setOAuthGrant(saved.id, GRANT, saved);
    const [signedOut] = await store.setOAuthGrant(saved.id, undefined, saved);
    assert.equal(signedOut.signedIn, false);
    assert.equal(await store.oauthGrant(saved.id), undefined);
  });
});
