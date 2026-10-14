import type { Project } from "./model";

/**
 * The Roqer community server's invite.
 *
 * A permanent invite: one that expires would leave every installed copy
 * pointing at a dead link. Emptying it hides the invite everywhere. Only an
 * `https` Discord invite is accepted, and the renderer opens it as an ordinary
 * link, which the main process hands to the system browser and never loads in
 * the app window.
 */
export const COMMUNITY_INVITE_URL = "https://discord.gg/vqzKJK4STR";

/** What the sidebar footer shows for the community server. */
export type CommunityInvite = "card" | "icon" | "none";

/** Whether `value` is an invite to a Discord server and nothing else. */
export function isCommunityInviteUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return false;
  if (url.hostname === "discord.gg") return /^\/[A-Za-z0-9-]+$/.test(url.pathname);
  if (url.hostname === "discord.com") return /^\/invite\/[A-Za-z0-9-]+$/.test(url.pathname);
  return false;
}

/**
 * The invite is offered once, as a card, and then lives on as an icon beside
 * Settings for good.
 *
 * The card waits for the first chat: a new install is busy connecting a
 * subscription, and an invite then competes with the one thing that has to
 * happen first. Dismissing it — or joining, which also dismisses it — is the
 * only way it goes, and it never comes back.
 */
export function communityInvite(url: string, dismissed: boolean, projects: readonly Project[]): CommunityInvite {
  if (!isCommunityInviteUrl(url)) return "none";
  if (dismissed) return "icon";
  return projects.some((project) => project.chats.length > 0) ? "card" : "none";
}
