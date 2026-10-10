# MODERN STUDS selected body: wheel-spin

> Repository-authored. MODERN STUDS has no wheel template of its own.

# SELECTED LAYOUT GUIDE (loaded via layout="wheel-spin")

For: prize wheel / lucky wheel / spin-to-win screens: a radial wheel of 8 prize wedges, a pointer, a SPIN button, and spin-pack purchase buttons. NOT for vertical rolling reels (vertical-reel-roll), shops, or reward dialogs.

## Route

- A wheel is a specialized template layout, and the maintained template exists only for SIM and STUDS. With MODERN STUDS active, deploy the **STUDS** wheel exactly: load `references/specialized/wheel-spin.md` and `templates/studs/wheel-spin.lua` in the same route call, and follow that contract.
- Customize only the documented `CONFIG` values. Never restyle the template with the modern surface kit, redraw its geometry, or move its managed prefix: its bytes are protected.
- Tell the user once, in the run's reply, that the wheel uses the classic STUDS construction because MODERN STUDS has no wheel template yet.
- The rest of the screen (a HUD tile that opens the wheel, a confirmation) still uses MODERN STUDS.
