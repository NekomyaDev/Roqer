# MODERN STUDS selected body: notification-alert

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: partial. Both reference games show short top-of-screen banners and toasts; stack geometry and lifetimes are carried from the CLASSIC STUDS notification body.

# SELECTED LAYOUT GUIDE (loaded via layout="notification-alert")

For: toasts, popup notifications, reward and achievement banners, server announcements, error and status messages: transient feedback that appears, informs, and leaves on its own. NOT for dialogs that wait for a decision (centered-dialog) or always-on readouts (hud-zone-system).

The defining trait: **short-lived studded message chips at the top edge that never block play.**

## Measurements (1080p)

- Stack container: ONE transparent Frame, `AnchorPoint = Vector2.new(0.5, 0)`, `Position = UDim2.new(0.5, 0, 0, 78)` (below the Core UI bar), vertical `UIListLayout` with ~1% screen-height gaps. Newest toast at the top.
- Toast: a `chip` block, ~26% screen width x ~6% screen height. Face content: icon (Fit, square, ~70% of face height) at the left with ~2% margin, then ONE line of message text (stroke 2.5, `TextTruncate = Enum.TextTruncate.AtEnd`). Reward toasts carry the matching currency or item icon.
- Face colour encodes type: green success/reward, red error/warning, gold rare/achievement, blue information. Construction never changes, only the colour.
- Static generation renders the system mid-life: 2-3 sample toasts of different types stacked, hardcoded content.
- Announcement variant: ONE wide `chip` block, ~42% x ~7% of the screen, gold, extruded text, above the toasts; it replaces itself and never stacks.
- Behaviour, ONLY when a later task wires it: tween in at most 0.3 s (the polish pop on a `UIScale`), hold 3-5 s, tween out, Destroy; at most 3 toasts visible; the announcement holds up to 8 s.

## Rules

- Toasts never block: no backdrop, no blur, no buttons on a toast.
- Never centre-screen: toasts live at the top edge.
- ONE line per toast; long text truncates.
- Chips are uniform in size and construction; only colour and content vary.
- Toasts stack; they never overlap or sit side by side.
