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
  for (const layout of ["wheel-spin", "vertical-reel-roll"]) {
    const source = await read(`references/selected/modern-studs/${layout}.md`);
    assert.match(source, new RegExp(`templates/studs/${layout}\\.lua`), `${layout} must route to the STUDS template`);
  }

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
