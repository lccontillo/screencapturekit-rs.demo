# Automatic Cinematic Zoom — Feasibility & Implementation Plan

## 1. Short answer

Yes — mouse telemetry alone is enough to build a working version of this. It's the primary
signal every tool in this space uses. But telemetry as currently captured (raw `move` samples
only) is missing two things that make the difference between "okay" and "Screen Studio–grade":
**click/interaction events** and **hold/dwell duration**. Position alone can approximate it;
position + clicks gets you most of the way there; position + clicks + a few heuristics gets you
very close.

This doc lays out what signal is needed, the processing pipeline, the algorithm for each stage,
and a phased build plan.

## 2. How the category actually does this

Researched how comparable tools (Screen Studio and several competitors — Screenify, ScreenKite,
Creavit, FocuSee) describe their own systems, since none publish source. The consistent pattern:

- **Clicks are the primary anchor.** Every tool treats a mouse-down as a strong signal that
  "something important is happening here" — it's the single most reliable zoom trigger.
- **Cursor position/velocity is the secondary signal**, used to pan smoothly between click
  anchors and to decide *when* to zoom out again (sustained fast movement = user is
  navigating away, not focusing).
- **It's a post-processing step, not a live effect.** Recording captures raw position + clicks
  (+ often active-window changes) at full fidelity; the zoom keyframes and camera path are
  computed afterward, then rendered as a non-destructive, editable layer.
- **Smoothing is treated as its own dedicated sub-system** — bezier/eased interpolation of the
  cursor path prevents micro-jitter from turning into visible camera shake once magnified.
- **Everything is user-tunable after the fact**: zoom intensity, speed, hold duration, and
  individual keyframes can be overridden — automatic-but-editable, not automatic-and-final.

This confirms the shape of the plan below: telemetry → clustering/anchor-detection → camera
keyframes → smoothed playback path → user override layer.

## 3. What signal we have vs. what we need

| Signal | Have today | Needed for good results | Notes |
|---|---|---|---|
| Cursor position (x/y over time) | ✅ | ✅ | Already captured at high resolution |
| Mouse down/up events | ❌ | ✅ **critical** | Currently only `type: "move"` events exist. This is the single biggest gap — see §7. |
| Click target / element bounds | ❌ | 🟡 nice-to-have | Would need OS accessibility APIs, not just mouse telemetry. Out of scope for v1. |
| Scroll events | ❌ | 🟡 nice-to-have | Useful for detecting "reading" behavior in long pages |
| Key press events | ❌ | 🟡 nice-to-have | Typing bursts are another strong "hold the zoom here" signal |
| Window/app bounds or screen resolution | Partial (`screenBounds`) | ✅ | Needed to keep zoom rects within frame and to reason about aspect ratio |
| Idle/dwell time (derivable from position) | ✅ (derivable) | ✅ | Can be computed from existing `t` deltas where position barely changes |

**Bottom line:** position-only telemetry can drive a *cursor-follow* zoom (continuously
recentering on the cursor, à la "Cursor-follow" tools mentioned in the research above). To get
*click-anchored cinematic* zoom like Screen Studio, we need to add click events to the capture
schema. This is a small capture-side change (see §7) and is the highest-leverage next step.

## 4. Proposed pipeline

```
Raw telemetry (move + click events)
        │
        ▼
1. Preprocessing        — clean, resample, denoise
        │
        ▼
2. Focus detection       — find "moments that matter": clicks, dwell clusters, typing bursts
        │
        ▼
3. Region computation    — turn each focus moment into a bounding box + zoom level
        │
        ▼
4. Keyframe consolidation— merge nearby regions, enforce min hold time, discard noise
        │
        ▼
5. Camera path generation— eased, cinematic interpolation between keyframes (GSAP timeline)
        │
        ▼
6. Render / preview      — apply as a crop+scale transform on the video track
        │
        ▼
7. Manual override layer — user can drag/resize/delete/add keyframes post-hoc
```

Stages 1–4 are pure data processing and can run entirely offline on the telemetry JSON, decoupled
from video. Stage 5 is exactly the kind of thing the GSAP timeline we already built is suited for
— it becomes "camera x/y/scale" instead of "cursor x/y."

## 5. Algorithm detail per stage

### 5.1 Preprocessing
- Resample or filter out sub-pixel jitter (very small moves under a threshold, e.g. 2px, within
  a short time window) — these are hand tremor / trackpad noise, not intent.
- Optionally smooth the raw path (the "Smooth Cursor" feature every competitor has) using a
  light spline or moving-average filter. This is cosmetic for playback but also stabilizes the
  velocity signal used downstream, so it's worth doing early.

### 5.2 Focus detection — the core heuristic
Three independent signals, each producing candidate "focus moments," then merged:

1. **Click anchors (strongest signal).** Every `mousedown` (or `mousedown`+`mouseup` close in
   time/space = a click, vs. far apart = a drag) becomes a candidate focus point at that
   location, timestamped.
2. **Dwell clusters (medium signal).** Slide a time window (e.g. 400–800ms) over the position
   stream. If the cursor stays within a small radius (e.g. 30–50px) for the whole window, that
   centroid becomes a candidate focus point. This catches "hovering over a menu to read it"
   even without a click.
3. **Velocity valleys (weak signal / tie-breaker).** Local minima in cursor speed even without a
   full dwell — useful for catching quick deliberate clicks that don't have much dwell before or
   after.

Each candidate gets a **confidence score** (clicks > sustained dwell > brief velocity dip),
which stage 4 uses to decide what's worth a full zoom vs. just a pan.

### 5.3 Region computation
For each focus moment:
- Take the centroid (click point, or dwell cluster centroid).
- Build a bounding box: a fixed base radius (e.g. 15–20% of screen width) around the centroid,
  optionally widened if there was cursor movement *within* the dwell window (e.g. selecting
  text, dragging within a toolbar).
- Convert box size → zoom level: `zoom = viewportWidth / boxWidth`, clamped to a
  min/max (e.g. 1.0x–2.5x) so it never over-magnifies a single click into an unreadable crop or
  under-zooms into a no-op.
- Clamp the box so it stays fully inside the screen bounds (no zooming into a region that would
  push the frame off-canvas).

### 5.4 Keyframe consolidation
Raw focus moments will over-trigger (a user often clicks 3 times in the same button area within
2 seconds). Rules:
- **Merge** focus moments whose regions overlap significantly and whose timestamps are within a
  cooldown window (e.g. 600ms) into a single keyframe spanning the merged time range.
- **Minimum hold time**: every zoom keyframe must be displayed for at least N seconds (e.g.
  1.2–1.5s) even if the underlying focus moment was instantaneous — this is what makes it
  readable/cinematic rather than flickery. Extend the hold, don't cut it short.
- **Cooldown before zooming out**: don't drop back to full-screen the instant activity stops;
  wait a beat (e.g. 500ms of no new focus moments) in case another click follows immediately.
- **Discard low-confidence isolated moments** below a threshold score during fast, sweeping
  cursor motion (the user is navigating, not focusing) — this is the "velocity as a secondary,
  suppressing signal" behavior described in the research.

### 5.5 Camera path generation
This is the part that reuses the GSAP work directly. Each consolidated keyframe becomes:
```js
{ t: 1240, x: 512, y: 300, zoom: 1.8, holdMs: 1500 }
```
Build a GSAP timeline over `camera.x / camera.y / camera.zoom` (applied to the video element or
canvas as `translate + scale`), with:
- **Ease-in fast, hold steady, ease-out fast** per segment (`power2.inOut` reads as "cinematic";
  linear reads as mechanical).
- Transition duration scaled to zoom-level delta (a small pan moves faster than a big zoom jump).
- A hard cap on simultaneous camera speed so consecutive keyframes never produce a whip-pan.

This is structurally identical to the cursor-physics timeline we already built — just applied to
a virtual camera transform instead of a cursor sprite, and driven by keyframes instead of raw
per-sample telemetry.

### 5.6 Manual override layer
Non-destructive by design: keep the auto-generated keyframe list as data, let the user drag
region boxes, adjust zoom %, delete/add keyframes, and adjust global tuning (see §6) — mirroring
what every competitor offers, since fully automatic-and-final zoom is never trusted at 100%.

## 6. Tunable parameters (for a settings panel, same pattern as the physics panel)

| Parameter | Purpose | Suggested default |
|---|---|---|
| Base zoom level | Default magnification on a focus event | 1.6x |
| Min / max zoom | Clamp range | 1.0x / 2.5x |
| Dwell window | How long cursor must linger to count as a focus cluster | 500ms |
| Dwell radius | How tight the cluster must be | 40px |
| Click confidence weight | How strongly clicks outweigh dwell/velocity signals | high |
| Merge distance / cooldown | When two focus moments count as "the same" | 120px / 600ms |
| Minimum hold time | Shortest a zoom keyframe can be shown | 1.3s |
| Exit cooldown | Delay before zooming back out after activity stops | 500ms |
| Ease curve | Cinematic feel of camera transitions | `power2.inOut` |
| Transition speed cap | Max camera pan/zoom speed | tunable |

## 7. Required change to the capture/telemetry format

Add interaction events alongside `move`, using the same event stream:

```json
{ "t": 1811, "type": "mousedown", "button": "left", "x": 940, "y": 410, "nx": 0.652, "ny": 0.455 }
{ "t": 1863, "type": "mouseup",   "button": "left", "x": 941, "y": 411, "nx": 0.653, "ny": 0.456 }
```

Optionally, `keydown` bursts (grouped by gaps < 1s) as a third weak signal for "user is typing,
hold the zoom here." This is additive — it doesn't change the existing `move` schema, so old
recordings still work with position-only, degraded-quality zoom (dwell + velocity signals only,
no click anchors).

## 8. Edge cases to design for

- **Drag operations** (mousedown → move → mouseup far from the down point): should produce a
  *pan* that follows the drag, not a static zoom on the start point.
  Or fast sweeping motion across most of the screen: suppress zoom entirely, or  zoom out to a
  neutral/wide view rather than chasing it.
- **Idle periods** (no movement for seconds): hold last camera state rather than drifting or
  resetting to full frame.
- **Focus moments near screen edges**: clamp the zoom rect inward so it doesn't request an
  off-canvas crop.
- **Very rapid multi-click** (double-clicks, rapid menu navigation): should consolidate into one
  sustained zoom on the region, not stutter between adjacent keyframes.
- **Multi-monitor recordings**: `screenBounds` needs to reflect the actual captured canvas, and
  focus detection should be aware of which monitor the cursor is on if the capture spans more
  than one.

## 9. Phased build plan

**Phase 1 — Capture:** extend telemetry schema with click (and optionally key) events (§7).
Small, low-risk change; unblocks everything else.

**Phase 2 — Offline analysis engine:** implement §5.1–§5.4 as a pure function
`telemetry → keyframes[]`, testable independent of any rendering, on both real and synthetic
recordings.

**Phase 3 — Camera timeline + preview:** build the GSAP-driven camera path (§5.5) as an
interactive preview overlay, reusing the panel pattern from the cursor-physics demo for the
tunables in §6.

**Phase 4 — Render integration:** apply the same keyframe data as an actual crop/scale transform
on the real video track in the export pipeline (not just a preview widget).

**Phase 5 — Manual override UI:** timeline-level editing of auto-generated keyframes (§5.6).

## 10. Stretch goal — beyond mouse telemetry

The one thing pure telemetry structurally can't give you is *semantic* awareness of what's on
screen (this button vs. that text field). Screen Studio-tier polish sometimes benefits from OS
accessibility APIs to snap the zoom box to the actual UI element bounds rather than an arbitrary
radius around the cursor. That's a meaningfully bigger lift (per-OS, permissions-gated) and is
worth treating as a v2 idea rather than blocking v1 — the heuristic radius-based approach in §5.3
gets close without it.

---

**Next step recommendation:** Phase 1 + Phase 2 are enough to validate the whole approach on
real data before touching any rendering — want me to prototype the analysis engine
(`telemetry → keyframes[]`) against your existing sample recording next?