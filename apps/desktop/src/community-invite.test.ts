import assert from "node:assert/strict";
import test from "node:test";

import { COMMUNITY_INVITE_URL, communityInvite, isCommunityInviteUrl } from "./community-invite";
import { createInitialWorkspace, type Project } from "./model";

const INVITE = "https://discord.gg/roqer";
const fresh = createInitialWorkspace().projects;
const used: Project[] = fresh.map((project) => ({ ...project, chats: [{} as Project["chats"][number]] }));

test("the invite waits for the first chat, shows once as a card, then stays as an icon", () => {
  assert.equal(communityInvite(INVITE, false, fresh), "none");
  assert.equal(communityInvite(INVITE, false, used), "card");
  assert.equal(communityInvite(INVITE, true, used), "icon");
  // Dismissed is a decision about the card, not about whether chats exist.
  assert.equal(communityInvite(INVITE, true, fresh), "icon");
});

test("no invite, or one that is not a Discord invite, shows nothing at all", () => {
  for (const url of ["", "not a url", "http://discord.gg/roqer", "https://discord.gg/", "https://evil.example/discord.gg/roqer",
    "https://discord.gg.evil.example/roqer", "https://user@discord.gg/roqer", "https://discord.gg:8443/roqer",
    "https://discord.com/channels/1/2", "https://discord.gg/roqer/extra"]) {
    assert.equal(isCommunityInviteUrl(url), false, url);
    assert.equal(communityInvite(url, false, used), "none", url);
    assert.equal(communityInvite(url, true, used), "none", url);
  }
  assert.equal(isCommunityInviteUrl("https://discord.gg/AbC-123"), true);
  assert.equal(isCommunityInviteUrl("https://discord.com/invite/AbC-123"), true);
});

test("the shipped invite is either unset or a real Discord invite", () => {
  assert.ok(COMMUNITY_INVITE_URL === "" || isCommunityInviteUrl(COMMUNITY_INVITE_URL));
});
