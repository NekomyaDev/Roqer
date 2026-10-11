import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_ROOT = path.resolve(HERE, "../agent/skills/roblox-ui-design");

async function read(relative: string): Promise<string> {
  return fs.readFile(path.join(UI_ROOT, relative), "utf8");
}

const LAYOUTS = [
  "admin-control-panel", "centered-dialog", "fullscreen-landing", "grid-inventory",
  "hud-zone-system", "incremental-clicker", "notification-alert", "progression-hub",
  "select-screen", "shop-grid", "stat-leaderboard", "vertical-navigation-sidebar",
  "vertical-reel-roll", "wheel-spin",
] as const;

test("all 28 recovered SIM/STUDS selected layout bodies ship with the desktop agent", async () => {
  for (const theme of ["sim", "studs"] as const) {
    for (const layout of LAYOUTS) {
      const source = await read(`references/selected/${theme}/${layout}.md`);
      assert.match(source, /# SELECTED LAYOUT GUIDE/, `${theme}/${layout} lost the recovered selected body`);
      assert.match(source, new RegExp(`layout=\\"${layout}\\"`), `${theme}/${layout} no longer identifies its route`);
    }
  }
});

/** Every `rbxassetid://<digits>` in a document. */
function assetIds(source: string): string[] {
  return [...source.matchAll(/rbxassetid:\/\/(\d+)/g)].map((match) => match[1]);
}

/**
 * MODERN STUDS is repository-authored from a study of other games' UI. Its
 * bodies must say so, and it may name only IDs the repository already ships
 * (the STUDS theme and the icon catalog) or the two public Creator Store stud
 * decals it documents. A sprite copied out of a studied game would be
 * someone else's art in every screen Roqer builds.
 */
test("the MODERN STUDS theme ships complete, labelled as authored, with only vetted asset IDs", async () => {
  const parts = [
    await read("references/themes/modern-studs.md"),
    await read("references/themes/modern-studs/part-1.md"),
    await read("references/themes/modern-studs/part-2.md"),
  ];
  const bodies: string[] = [];
  for (const layout of LAYOUTS) {
    const source = await read(`references/selected/modern-studs/${layout}.md`);
    assert.match(source, /# SELECTED LAYOUT GUIDE/, `modern-studs/${layout} is not a selected body`);
    assert.match(source, new RegExp(`layout=\\"${layout}\\"`), `modern-studs/${layout} no longer identifies its route`);
    assert.match(source, /Repository-authored/, `modern-studs/${layout} must not pass as recovered guidance`);
    bodies.push(source);
  }
  // The wheel has its own MODERN STUDS template; the reel still borrows the CLASSIC one.
  const wheelRoute = await read("references/selected/modern-studs/wheel-spin.md");
  assert.match(wheelRoute, /templates\/modern-studs\/wheel-spin\.lua/, "wheel-spin must route to the MODERN STUDS template");
  const reelRoute = await read("references/selected/modern-studs/vertical-reel-roll.md");
  assert.match(reelRoute, /templates\/studs\/vertical-reel-roll\.lua/, "vertical-reel-roll must route to the STUDS template");

  const kit = parts[1];
  assert.match(kit, /local function makeSurface/);
  assert.match(kit, /Instance\.new\("UICorner"\)/);
  assert.match(kit, /ApplyStrokeMode\.Border/);
  assert.match(kit, /lip = 0\.12/);
  assert.match(kit, /utf8\.char\(0xE002\)/);
  assert.match(kit, /rbxassetid:\/\/92521981645530/);
  assert.match(kit, /rbxassetid:\/\/91084849147872/);
  // Public decals are documented decal -> image, and the image is what ships.
  assert.match(kit, /6927295857 "Studs" \| `rbxassetid:\/\/6927295847`/);
  assert.match(kit, /12055407253 "stud" \| `rbxassetid:\/\/12055407192`/);
  assert.match(parts[2], /350×70/);
  assert.match(parts[2], /BlurEffect/);
  assert.match(parts[2], /gui\.Destroying:Connect\(function\(\) blur:Destroy\(\) end\)/);

  const vetted = new Set([
    ...assetIds(await read("references/themes/studs.md")),
    ...assetIds(await read("references/themes/recovered/studs-1.md")),
    ...assetIds(await read("references/themes/recovered/studs-2.md")),
    ...assetIds(await read("references/icons/index.md")),
    "6927295847", "12055407192",
  ]);
  for (const id of assetIds([...parts, ...bodies].join("\n"))) {
    assert.ok(vetted.has(id), `MODERN STUDS names rbxassetid://${id}, which the repository has not vetted`);
  }
});

/**
 * The first MODERN STUDS benchmarks in Studio: a rebirth dialog overflowed
 * because its blocks were sized in Scale inside the panel's ScrollingFrame,
 * whose canvas grows with them, and the fix shrank everything; the shop grew
 * a tab rail neither reference game has. MODERN STUDS is now also the stud
 * theme a plain stud request gets.
 */
test("MODERN STUDS dialogs never scroll, shops have no tabs, and stud requests default to it", async () => {
  const kit = await read("references/themes/modern-studs/part-2.md");
  assert.match(kit, /local function makeContent\(panel, scrolls, barColor\)/);
  assert.match(kit, /ScrollingDirection = Enum\.ScrollingDirection\.Y/);
  assert.match(kit, /makePanelDark\(gui, name, widthScale, heightScale, headerColor, title, iconId, scrolls\)/);
  assert.match(kit, /never on a shop/);

  const dialog = await read("references/selected/modern-studs/centered-dialog.md");
  assert.match(dialog, /scrolls = false/);
  assert.match(dialog, /\| Value row \| 0\.37 \| 0\.15 \|/);
  assert.match(dialog, /`Size = UDim2\.fromScale\(0\.32, 0\.15\)`/);
  assert.doesNotMatch(dialog, /UIListLayout` \(`HorizontalAlignment = Center`/);

  const shop = await read("references/selected/modern-studs/shop-grid.md");
  assert.match(shop, /A shop has NO tabs/);
  assert.doesNotMatch(shop, /tab rail on the panel's RIGHT edge/);

  assert.match(kit, /VerticalScrollBarInset = Enum\.ScrollBarInset\.Always/);

  // A badge on a tile's base put its text half on the face and half off it,
  // so a benchmark HUD pushed its badges inward and shrank the icons.
  assert.match(kit, /a red `chip` parented to the tile's FACE, `AnchorPoint` \(0\.5, 0\.5\), `ZIndex = 4`/);
  assert.match(kit, /Never shrink or move the icon for a badge/);
  assert.doesNotMatch(kit, /parented to the tile base/);
  const sidebar = await read("references/selected/modern-studs/vertical-navigation-sidebar.md");
  assert.match(sidebar, /a red `chip` parented to the button's face/);
  // Card tags are bare coloured text in both reference games, not stickers.
  assert.match(kit, /\*\*Tag\*\* .*: bare coloured text, no block behind it/);
  assert.doesNotMatch(kit, /\*\*Tag\*\* .*: a `chip` block/);

  // Both reference games agree on these; the first draft of the guidance did not.
  const daily = await read("references/selected/modern-studs/progression-hub.md");
  assert.match(daily, /3 x 2 grid/);
  assert.match(daily, /Day 7 is ONE tall `tile` block on the right/);
  const toasts = await read("references/selected/modern-studs/notification-alert.md");
  assert.match(toasts, /No blocks, no chips, no panel: the message IS the text/);
  const hud = await read("references/selected/modern-studs/hud-zone-system.md");
  assert.match(hud, /each row ~7\.5% of screen height/);
  assert.match(hud, /Top-centre elements therefore start just under it, at an 8 px offset/);

  const entrypoint = await read("SKILL.md");
  assert.match(entrypoint, /\*\*MODERN STUDS\*\*, the stud theme: .* used for every stud, studded, or blocky request/);
  assert.match(entrypoint, /with \*\*CLASSIC STUDS\*\*: `references\/themes\/recovered\/studs-1\.md`/);
});

/**
 * A full HUD-and-panels benchmark drew its HUD deals at half the reference
 * size (sized from screen width), and its HUD tiles, day tiles and collection
 * slots with far smaller art than either reference game, because the guidance
 * kept all text off art. Text over art is audit-clean when the art is the
 * label's parent or its box covers the whole face; both were checked live.
 */
test("MODERN STUDS draws art at reference size with labels over it", async () => {
  const kit = await read("references/themes/modern-studs/part-2.md");
  assert.match(kit, /\*\*Text over art\.\*\*/);
  assert.match(kit, /Icon: Fit, square, `Size = UDim2\.fromScale\(0\.8, 0\.8\)` of the face/);
  assert.match(kit, /Label: a CHILD of the icon/);
  assert.doesNotMatch(kit, /keeps the label clear of the icon's box/);
  assert.match(kit, /a square holder 0\.17 of screen height/);
  assert.match(kit, /is a CHILD of the art image, wholly inside its top corner/);
  // Gold-tinted and white rays both vanished on gold cards in Studio; orange ones showed.
  assert.match(kit, /`ImageColor3 = PALETTE\.orange\.bottom`/);
  assert.doesNotMatch(kit, /PALETTE\.gold\.bottom/);

  const hud = await read("references/selected/modern-studs/hud-zone-system.md");
  assert.match(hud, /sized from screen height \(art holder 0\.17 of it/);
  assert.doesNotMatch(hud, /each ~8\.5% of screen width/);
  const daily = await read("references/selected/modern-studs/progression-hub.md");
  assert.match(daily, /Each day tile is filled by its reward art/);
  assert.doesNotMatch(daily, /in separate bands/);
  const slots = await read("references/selected/modern-studs/grid-inventory.md");
  assert.match(slots, /an art box covering the whole face/);
});

/**
 * With inactive tabs grey, a benchmark agent could not show an active grey
 * Common tab and recoloured Common green; on the left, its index rail would
 * have covered the HUD's menu tiles. One reference game dims inactive tabs in
 * their own colours and puts its rail on the right.
 */
test("MODERN STUDS tabs dim in their own colours and the rail defaults to the right", async () => {
  const kit = await read("references/themes/modern-studs/part-2.md");
  assert.match(kit, /local function setTab\(tab, colorName, active\)/);
  assert.match(kit, /placement: on the RIGHT by default/);
  assert.doesNotMatch(kit, /every other tab `grey`/);
  const theme = await read("references/themes/modern-studs/part-1.md");
  assert.doesNotMatch(theme, /grey for disabled, owned, and inactive tabs/);
  const slots = await read("references/selected/modern-studs/grid-inventory.md");
  assert.match(slots, /tab rail on the panel's RIGHT edge \(outside\)/);
  assert.doesNotMatch(slots, /the active tab in colour and the others grey/);
});

/**
 * Three simulator games put a faint pattern on their panels, draw item art big
 * with labels over it, colour item tiles by tier, and draw HUD icons over the
 * ends of their pills. Rendered in Studio, the recovered SIM scaffold also
 * failed the UI audit on every dialog (title and close crossing the drop
 * shadow's edge), and its shop assumed a 1080p content width, so five cards
 * wrapped into rows of 3 and 2. The SIM refresh carries those fixes, loads with
 * every SIM route, and leaves the recovered files unchanged.
 */
test("the SIM refresh loads with SIM routes and carries its measured fixes", async () => {
  const entrypoint = await read("SKILL.md");
  assert.match(entrypoint, /with \*\*SIM\*\*: .*`references\/themes\/sim-refresh\.md`, which updates them/);
  const refresh = await read("references/themes/sim-refresh.md");
  assert.match(refresh, /Repository-authored/);
  assert.match(refresh, /card\.Image = PATTERN/);
  assert.match(refresh, /shadow\.Size = UDim2\.new\(1, 6, 1, -34\)/);
  assert.match(refresh, /local function makeItemTile\(parent, item\)/);
  assert.match(refresh, /CONTENT_W = content\.AbsoluteWindowSize\.X - 40/);
  assert.match(refresh, /parented to the tile's ICON/);
  // Its one new asset is a public Creator Store decal, named with its image.
  assert.deepEqual([...new Set(assetIds(refresh))], ["14605469420"]);
  assert.match(refresh, /decal 14605469461 "Star Pattern"/);
  // The recovered parts stay as captured; the refresh overrides them.
  assert.match(await read("references/themes/recovered/sim-2.md"), /The card face stays CLEAN white/);
  assert.match(await read("references/core/contradictions.md"), /## SIM refresh vs recovered SIM/);
});

test("the recovered STUDS shop keeps the composition anchors that prevent viewport stretching", async () => {
  const source = await read("references/selected/studs/shop-grid.md");
  assert.match(source, /Panel: 45% screen width, centered/);
  assert.match(source, /CellSize = UDim2\.fromOffset\(255, 235\)/);
  assert.match(source, /3 columns/);
  assert.match(source, /never scale cards up to fill vertical space/);
  assert.match(source, /never leave a dead region under the cards/);
});

/**
 * STUDS panels are sized as separate fractions of screen width and height, so a
 * 2248×980 Studio window stretched the shop, and every run spent a repair
 * pass locking it. The lock is now part of the construction.
 */
test("a STUDS panel keeps its 1080p proportions on wide and narrow windows", async () => {
  const generation = await read("references/core/generation.md");
  assert.match(generation, /`AspectRatio = \(widthScale × 16\) \/ \(heightScale × 9\)`/);
  assert.match(generation, /from the panel's `AbsoluteSize`, not the viewport/);
  const shop = await read("references/selected/studs/shop-grid.md");
  assert.match(shop, /1080p proportions locked by a `UIAspectRatioConstraint`/);
});

test("the recovered STUDS theme keeps its load-bearing construction rules", async () => {
  const source = `${await read("references/themes/recovered/studs-1.md")}\n${await read("references/themes/recovered/studs-2.md")}`;
  assert.match(source, /4-layer bevel stack/);
  assert.match(source, /applyCloseButton/);
  assert.match(source, /rbxassetid:\/\/92521981645530/);
  assert.match(source, /rbxassetid:\/\/102751665779866/);
  assert.match(source, /350px right and 70px down/);
});

/**
 * The recovered themes banned all motion, and a model that followed them built
 * a correct but lifeless shop even when asked for a polished one. Motion is now
 * allowed as a presentation layer that adds to the theme and never replaces it,
 * while data and game behavior stay unwired.
 */
test("themed screens get the polish layer's motion but still wire no game behavior", async () => {
  const polish = await read("references/core/polish.md");
  assert.match(polish, /never resizes, moves, recolors, or replaces a canonical element/);
  assert.match(polish, /Never tween the `Size` or `Position` of anything/);
  assert.match(polish, /No `RunService` per-frame work/);
  assert.match(polish, /never buy, grant, or read game data/);
  assert.match(polish, /never to `wheel-spin` or `vertical-reel-roll`/);

  for (const part of ["references/themes/recovered/sim-1.md", "references/themes/recovered/studs-1.md"]) {
    const source = await read(part);
    assert.doesNotMatch(source, /no RunService or TweenService/, part);
    assert.match(source, /TweenService is allowed only for the presentation motion in Roqer's polish layer/, part);
    assert.match(source, /no MarketplaceService or product lookups, no RemoteEvents or RemoteFunctions/, part);
  }

  // Measured in Studio: a pulsing tag's text jumped between whole font sizes
  // while its body scaled smoothly, and a 7 px float moved in visible
  // one-pixel hops. Ambient motion pulses colour, not the size of text.
  assert.match(polish, /Never continuously scale anything that contains text/);
  assert.match(polish, /pulse its colour, not its size/);
  assert.match(polish, /move at least 10 px each way/);
  assert.match(polish, /Enum\.EasingStyle\.Sine, Enum\.EasingDirection\.InOut, -1, true/);

  // A tilted tag on a card scrolled out of view drew below the panel: Roblox
  // does not clip rotated descendants of a ScrollingFrame.
  assert.match(polish, /Nothing inside a `ScrollingFrame` is rotated/);
  assert.match(polish, /small upright sticker/);
  assert.doesNotMatch(polish, /rotated sticker|floats or rocks/);

  // A full-width offer row scaled to 1.03 on hover grew wider than its scroll
  // window and poked past the shop's sides. Only buttons and HUD tiles grow.
  assert.match(polish, /\*\*Cards and rows:\*\* no hover scale/);
  assert.doesNotMatch(polish, /\*\*Cards:\*\* hover 1\.03/);
  const modernKit = await read("references/themes/modern-studs/part-2.md");
  assert.match(modernKit, /Buttons and HUD tiles scale on hover; cards, offer rows, and banners do not/);
  // The sparse stud texture tiled across a banner came out as huge, patchy studs.
  const modernTheme = `${await read("references/themes/modern-studs/part-1.md")}\n${modernKit}`;
  assert.doesNotMatch(modernTheme, /102751665779866/);

  const entrypoint = await read("SKILL.md");
  assert.match(entrypoint, /`references\/core\/polish\.md`, except for `wheel-spin` and `vertical-reel-roll`/);
  assert.match(entrypoint, /Never build from a theme or selected body you have not received in full/);
});

test("the UI entrypoint gives recovered selected bodies precedence over generic GUI geometry", async () => {
  const source = await read("SKILL.md");
  assert.match(source, /references\/selected\/studs\/<layout>\.md/);
  assert.match(source, /authoritative for geometry\/composition/i);
  assert.match(source, /generic `roblox-gui` layout advice/);
  // The design-canvas + uniform-root-scale technique is still documented, now
  // scoped to reproducing a reference image rather than offered for any layout.
  assert.match(source, /uniform root `UIScale`/);
});
