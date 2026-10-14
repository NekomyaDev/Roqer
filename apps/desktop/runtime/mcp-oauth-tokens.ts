import type { McpServerConfig } from "../shared/mcp-servers";
import type { McpAuthorization } from "./external-mcp-client";
import { grantExpiring, McpOAuthError, refreshMcpGrant, type OAuthDependencies, type OAuthGrant } from "./mcp-oauth";

/**
 * The bearer tokens of the user's OAuth servers, for runs and Settings' test.
 *
 * A token is read from the store before every request, so a sign-in made in
 * Settings mid-run is used at once. One near its expiry, or one a server
 * refused, is renewed with the refresh token and the renewal kept. Requests
 * that need a renewal at the same moment share it: a provider that rotates
 * refresh tokens would refuse the second of two renewals made with the same
 * one, and that refusal would wrongly sign the user out.
 *
 * A sign-in is forgotten only when the provider says it is no longer valid,
 * never because it could not be reached.
 */

export interface OAuthGrantStore {
  oauthGrant(id: string): Promise<OAuthGrant | undefined>;
  setOAuthGrant(id: string, grant: OAuthGrant | undefined, signedInAs: Pick<McpServerConfig, "url" | "auth" | "oauthClientId">): Promise<unknown>;
}

export class McpOAuthTokens {
  private readonly renewing = new Map<string, Promise<string | undefined>>();

  constructor(private readonly store: OAuthGrantStore, private readonly options: OAuthDependencies = {}) {}

  authorizationFor(server: McpServerConfig): McpAuthorization {
    const now = this.options.now ?? Date.now;
    return {
      accessToken: async () => {
        const grant = await this.store.oauthGrant(server.id);
        if (grant === undefined) {
          throw new McpOAuthError(`Roqer is not signed in to ${server.name}. Sign in under Settings → MCP servers.`, true);
        }
        if (!grantExpiring(grant, now())) return grant.accessToken;
        const renewed = await this.renew(server, grant.accessToken);
        if (renewed === undefined) {
          throw new McpOAuthError(`Roqer's sign-in to ${server.name} has expired. Sign in again under Settings → MCP servers.`, true);
        }
        return renewed;
      },
      renew: (rejected) => this.renew(server, rejected),
    };
  }

  private renew(server: McpServerConfig, rejected: string): Promise<string | undefined> {
    const pending = this.renewing.get(server.id);
    if (pending !== undefined) return pending;
    const renewal = (async () => {
      const grant = await this.store.oauthGrant(server.id);
      if (grant === undefined) return undefined;
      // Renewed already, by a request that hit the same expiry first.
      if (grant.accessToken !== rejected && !grantExpiring(grant, (this.options.now ?? Date.now)())) return grant.accessToken;
      try {
        const next = await refreshMcpGrant(grant, this.options);
        await this.store.setOAuthGrant(server.id, next, server);
        return next.accessToken;
      } catch (error) {
        if (error instanceof McpOAuthError && error.signedOut) {
          await this.store.setOAuthGrant(server.id, undefined, server).catch(() => undefined);
        }
        return undefined;
      }
    })();
    this.renewing.set(server.id, renewal);
    void renewal.finally(() => {
      if (this.renewing.get(server.id) === renewal) this.renewing.delete(server.id);
    }).catch(() => undefined);
    return renewal;
  }
}
