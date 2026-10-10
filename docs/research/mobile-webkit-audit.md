# Mobile WebKit capability audit (node #846)

What iOS/iPadOS Safari can and cannot do for seelite, item by item, from the
question list on #846. Map: #845.

**Current release at writing (2026-10-10):** iOS/iPadOS Safari 27 (BCD marks
`safari_ios` 27 *current*, released 2026-09-14); Chrome Android 155.

**Sources.** "BCD" is MDN browser-compat-data **v8.1.5 (2026-10-08)**, queried
locally by key path; each key path names the file under
<https://github.com/mdn/browser-compat-data> (`api.Element.requestPointerLock`
is `api/Element.json`). WebKit source is pinned to commit
`437139e30888c5e1b4c35f889f32e1d0c39d018e`. Every other URL was fetched while
writing this and says what the row claims. Where two sources disagree, the row
says **CONFLICT** and names both. "Unknown" means no primary source was found;
it is not a guess that the answer is no.

**Status words.** *Supported*: shipped and usable as seelite would use it.
*Partial*: shipped with a restriction that matters here. *Absent*: not shipped
in current Safari.

**What this audit cannot settle.** Several rows (memory, RGBA16F sample
counts, which keys iPadOS swallows, the iPad mouse pointer lock) have no
published answer and can only be measured on the principal's devices.

---

## 1. Pointer lock

| Item | iOS / iPadOS Safari | Since | Workaround if absent | Source | Android Chrome |
|---|---|---|---|---|---|
| `Element.requestPointerLock`, `document.pointerLockElement`, `exitPointerLock` | **Absent** (iPhone and iPad) | — | Steer without a lock: touch drag or virtual stick (relative deltas from `PointerEvent`), tilt, or pad | BCD `api.Element.requestPointerLock`, `api.Document.pointerLockElement`, `api.Document.exitPointerLock` (all `safari_ios: false`); caniuse lists iOS Safari 3.2–27.2 as not supported: <https://caniuse.com/pointerlock> | **CONFLICT:** BCD says supported since 144, and a comment on WebKit bug 216621 says it shipped in 144.0.7559.31 (Feb 2026). caniuse lists 154 as not supported |
| iPad with a paired mouse or trackpad | **Unknown.** WebKit landed "[iOS] Pointer lock should be gated behind mouse availability" (298248@main, 2025-08-05). No release note, BCD or caniuse entry says it shipped, and the umbrella bug is still NEW (last modified 2026-07-06) | — | As above | <https://bugs.webkit.org/show_bug.cgi?id=296923>, <https://bugs.webkit.org/show_bug.cgi?id=216621>, <https://bugs.webkit.org/show_bug.cgi?id=272168> | — |
| iPhone with a mouse | **Absent, by design.** iPhone mice work only through AssistiveTouch, which WebKit receives as touch input, "so no, it will not work" (bug 296923, comment 4) | — | — | <https://bugs.webkit.org/show_bug.cgi?id=296923> | — |

**For seelite.** `src/main.ts:5146` calls
`this.renderer.domElement.requestPointerLock()` inside
`Promise.resolve(...)`. The click handler from `src/main.ts:5120` to `:5146`
has no check that the method exists. Where the method is absent, the call
throws a synchronous `TypeError` before `Promise.resolve` can wrap it, so the
`.catch` never runs. The comment at `:5140–:5144` guards against an engine
that returns `undefined`, not against one where the method is missing. This is
a finding only; nothing here was fixed. `canvasHoldsLock()`
(`src/main.ts:9199`) compares `document.pointerLockElement` with the canvas,
and reads false when that property is `undefined`. The `mousemove` steering
path (`src/main.ts:5150`) is therefore dead on iOS. Steering keeps only the
keyboard and the pad until a touch route exists.

## 2. Fullscreen, orientation lock, standalone launch

| Item | iOS / iPadOS Safari | Since | Workaround if absent | Source | Android Chrome |
|---|---|---|---|---|---|
| `Element.requestFullscreen` on **iPad** | **Partial.** Prefixed (`webkit`) from 12, unprefixed from 16.4. BCD notes an overlay button that cannot be disabled, and that swiping down exits fullscreen, "making it unsuitable for some use cases like games" | 12 (prefixed), 16.4 | Standalone (Home Screen) launch | BCD `api.Element.requestFullscreen`, `api.Document.fullscreenEnabled` | Supported since 71 (prefixed since 18) |
| `Element.requestFullscreen` on **iPhone** | **Absent.** BCD: "Only available on iPad, not on iPhone." WebKit bug 206854 is still NEW. A 2026-06-08 comment there says the Safari 27 beta notes have "still nothing for element fullscreen on iPhone" | — | Standalone (Home Screen) launch is the only way to drop the browser UI | BCD as above; <https://bugs.webkit.org/show_bug.cgi?id=206854> | Supported |
| `screen.orientation` (read `type` and `angle`, `change` event) | Supported | 16.4 | — | BCD `api.ScreenOrientation`, `api.Screen.orientation` | Supported since 38/39 |
| `screen.orientation.lock()` | **Absent** | — | Detect portrait (`screen.orientation.type`, or a `(orientation: portrait)` media query) and show the "turn the device" prompt the map already requires | BCD `api.ScreenOrientation.lock` (`safari_ios: false`) | Supported since 38. Chrome normally requires fullscreen first; not verified here |
| Manifest `orientation` | **Absent** | — | Same prompt | BCD `manifests.webapp.orientation` | Supported since 39 |
| Manifest `display: standalone` | Supported | 11.3 | — | BCD `manifests.webapp.display.standalone` | Supported |
| Manifest `display: fullscreen` / `minimal-ui` | **Absent** | — | `standalone` | BCD `manifests.webapp.display.fullscreen` | Supported |
| `@media (display-mode: …)` (detect a standalone launch) | Supported | 12.2 | — | BCD `css.at-rules.media.display-mode` | Supported since 42 |
| Home Screen behaviour on iOS/iPadOS 26+ | "By default, every website added to the Home Screen opens as a web app", with or without a manifest. The user can turn off "Open as Web App" | 26 | — | <https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/> | — |
| Screen Wake Lock | Supported. From 16.4 to 18.4 it did not work in Home Screen web apps | 18.4 (fully) | — | BCD `api.Navigator.wakeLock` | Supported since 84 |

**For seelite.** No source code calls `requestFullscreen` or
`screen.orientation`. A search of `src/*.ts` finds neither. On iPhone, the
only full-screen route is a Home Screen launch, and the swipe-down exit makes
iPad element fullscreen fragile as well. The portrait prompt has to be a
detect-and-ask, because no lock exists.

## 3. Gamepad API

| Item | iOS / iPadOS Safari | Since | Workaround if absent | Source | Android Chrome |
|---|---|---|---|---|---|
| `navigator.getGamepads()` | Supported | 10.3 | — | BCD `api.Navigator.getGamepads` | Supported since 35 |
| `gamepadconnected` event | Supported since 16 (from 10.3 to 16 the `ongamepadconnected` property was missing) | 16 | Not needed: seelite polls | BCD `api.Window.gamepadconnected_event` | Supported |
| `Gamepad.mapping === "standard"` | Supported for every controller that GameController.framework exposes as an *extended gamepad*: WebKit sets `m_mapping = standardGamepadMappingString()` when `extendedGamepad` is non-nil. Which retail pads iOS classes as extended is not on Apple's support page | 10.3 | — | WebKit `Source/WebCore/platform/gamepad/cocoa/GameControllerGamepad.mm:101-102` at the pinned commit: <https://github.com/WebKit/WebKit/blob/437139e30888c5e1b4c35f889f32e1d0c39d018e/Source/WebCore/platform/gamepad/cocoa/GameControllerGamepad.mm#L101-L102>; BCD `api.Gamepad.mapping` | Supported |
| Bluetooth pads on iOS | Xbox, PlayStation and "other Bluetooth game controller[s]" pair. Apple's page lists no per-model iOS minimum | — | — | <https://support.apple.com/en-us/111099> | — |
| Pad seen by Safari on a real iPhone | A PS4 controller on an iPhone running iOS 17.2.1 was "detected" with its input in Safari (it was missing only in WKWebView, since fixed) | — | — | <https://bugs.webkit.org/show_bug.cgi?id=269292> | — |
| Exposure rule | Per spec, `getGamepads()` returns an empty list until a "gamepad user gesture" (a button press or axis move) has been seen | — | — | <https://w3c.github.io/gamepad/> | Same rule |
| Secure context | The spec does **not** mark `getGamepads` `[SecureContext]`. Access is gated by the Permissions Policy `gamepad` (default allowlist `*`). Safari's own secure-context behaviour: unknown | — | — | <https://w3c.github.io/gamepad/> | — |
| `vibrationActuator` (rumble) | **Absent** | — | — | BCD `api.Gamepad.vibrationActuator` | Supported since 68 |

**For seelite.** `src/gamepad.ts` polls `navigator.getGamepads()` once per
frame and has no listener (`src/gamepad.ts:11`). It refuses pads that are off
the standard mapping (`src/gamepad.ts:50`). Both match what WebKit ships. The
pad appears on the frame after the first press, which the spec's gesture rule
requires anyway. A pad that iOS exposes as a micro rather than an extended
gamepad reports `mapping: ""`, and seelite refuses it. No source says which
retail pads that covers.

## 4. DeviceOrientation / DeviceMotion

| Item | iOS / iPadOS Safari | Since | Workaround if absent | Source | Android Chrome |
|---|---|---|---|---|---|
| `deviceorientation` / `devicemotion` events | Supported | 4.2 | — | BCD `api.Window.deviceorientation_event`, `api.Window.devicemotion_event` | Supported since 18/31. Before 50, Chrome gave absolute rather than relative values |
| `DeviceOrientationEvent.requestPermission()` / `DeviceMotionEvent.requestPermission()` | Supported, and required before any event fires | **CONFLICT:** BCD says 14.5. A-Frame's docs and the yal.cc write-up both say iOS 13 | — | BCD `api.DeviceOrientationEvent.requestPermission_static`; <https://yal.cc/js-device-motion/> | BCD lists `requestPermission` since 152. Chrome historically fired the events without a prompt |
| User-gesture rule | Requires transient activation. Otherwise it rejects with `NotAllowedError` while the state is `"prompt"`. yal.cc observed that `touchstart` does not count and `touchend` does | — | Call it from the same tap that starts tilt steering | <https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static>; <https://yal.cc/js-device-motion/> | — |
| HTTPS | "iOS will auto-decline the requestPermission call if the page is not loaded over HTTPS" (yal.cc). MDN marks the method secure-context-only | — | Test over HTTPS | As above | Secure-context per MDN ("some or all browsers") |
| Event rate | **60 Hz:** WebKit's iOS motion manager sets `kMotionUpdateInterval = 1.0f / 60.0f` | — | — | <https://github.com/WebKit/WebKit/blob/437139e30888c5e1b4c35f889f32e1d0c39d018e/Source/WebCore/platform/ios/WebCoreMotionManager.h#L34> | Unknown |

**For seelite.** No code reads orientation or motion today. A tilt route
needs: a tap that calls `requestPermission()` and is handled on `touchend` or
`click`, not `touchstart`; an HTTPS origin; and a 60 Hz input stream, which
the 60 fps loop would have to sample or interpolate.

## 5. Hardware keyboard on iPad

| Item | iOS / iPadOS Safari | Since | Workaround if absent | Source | Android Chrome |
|---|---|---|---|---|---|
| `KeyboardEvent.key` / `.code` | Supported | 10.3 | — | BCD `api.KeyboardEvent.key`, `api.KeyboardEvent.code` | `code` is partial: BCD says "The value is always empty", which describes the soft keyboard |
| Escape | Many iPad keyboards have no Escape key. Cmd+. is meant to send Escape. WebKit fixed that in 2019 (r245644), and a follow-up (bug 199393, referenced from the thread) found it arrived with the identifier "Period", not "Escape" | 2019 fix; shipping version not stated | Bind a second, non-Escape key to every Escape action | <https://bugs.webkit.org/show_bug.cgi?id=198137> | — |
| Escape and user activation | Per the HTML spec, a `keydown` of Esc never grants activation, and neither does "a shortcut key reserved by the user agent" | — | — | <https://html.spec.whatwg.org/multipage/interaction.html#activation-triggering-input-event> | Same rule |
| Which keys the system takes (Cmd combinations, Tab, F-keys, Globe) | **Unknown.** No primary source found | — | Measure on the principal's iPad | — | — |
| `navigator.keyboard.lock()` (capture system keys) | **Absent** | — | — | BCD `api.Navigator.keyboard`, `api.Keyboard.lock` | Supported since 68 |

**For seelite.** `"Escape"` is matched in six modules (`commander-overlay.ts`,
`courier-cockpit-viewer.ts`, `galaxy-map.ts`, `main.ts`, `postcard-panel.ts`,
`settings-panel.ts`). One example is the capture modal at `src/main.ts:9570`.
The keydown handler already lets any Meta/Ctrl chord through to the browser
(`src/main.ts:9568`). `src/postcard-panel.ts:301` handles `Tab`. An iPad
keyboard without an Escape key cannot reach any of the six Escape actions
unless Cmd+. arrives as `key === "Escape"`, and the only source says it did
not.

## 6. Touch and pointer events

| Item | iOS / iPadOS Safari | Since | Workaround if absent | Source | Android Chrome |
|---|---|---|---|---|---|
| Touch events, multi-touch | Supported | 3.2 | — | BCD `api.TouchEvent` | Supported |
| Pointer events | Supported | 13 | — | BCD `api.PointerEvent` | Supported since 55 |
| `touch-action` | `manipulation` since 9.3; `none`, `pan-x`, `pan-y` and `pinch-zoom` since 13. `pan-up`, `pan-down`, `pan-left` and `pan-right` are **absent** | 9.3 / 13 | — | BCD `css.properties.touch-action.*` | Supported since 36 |
| Blocking page zoom with `user-scalable=no` / `maximum-scale` | **Ignored** since iOS 10: "we ignore the `user-scalable`, `min-scale` and `max-scale` settings" | 10 | `touch-action: none` on the canvas (supported since 13) | <https://webkit.org/blog/7367/new-interaction-behaviors-in-ios-10/> | Chrome honours the viewport limits. Not verified here |
| Edge-swipe back/forward navigation | Calling `preventDefault()` in a `touchstart` listener on touches within about 20 px of the screen edge blocks it on iOS Safari 13.4+. This is a third-party report (2020), not a WebKit guarantee | 13.4 | — | <https://pqina.nl/blog/blocking-navigation-gestures-on-ios-13-4/> | — |
| `overscroll-behavior` | Partial: "no effect on scroll containers that have no scrollable overflow" | 16 | — | BCD `css.properties.overscroll-behavior` | Supported since 144 (partial before) |
| `(pointer: coarse)`, `(hover: none)` | Supported | 9 | — | BCD `css.at-rules.media.pointer`, `css.at-rules.media.hover` | Supported. BCD notes that `(hover: hover)` can match falsely on some Samsung devices |
| Those queries on an iPad with a mouse or trackpad | In iOS 13.4 they returned touch values with a mouse paired. A fix that adds a mouse-device check landed as r268086 (2020-10-06). The bug proposes `(any-pointer: fine)` / `(any-hover: hover)` true with a pointing device and `(pointer: fine)` always false, but does not record the final values. Exact current behaviour: unknown | Fix landed 2020-10; shipping version not stated | Measure on device | <https://bugs.webkit.org/show_bug.cgi?id=209292> | — |
| `visualViewport` | Supported | 13 | — | BCD `api.VisualViewport` | Supported since 61 |

**For seelite.** `index.html:5` has
`width=device-width, initial-scale=1.0`. Under the iOS 10 post, that viewport
also qualifies for instant taps. The main game canvas sets no `touch-action`.
The only matches are the galaxy map (`src/galaxy-map.ts:505`, `none`) and the
model viewer (`src/model-viewer.ts:233`). So pinch and double-tap zoom stay
live over the flight view. `src/hover-candidate.ts:142` already records that
Chromium reports `(hover: none)` under touch emulation.

## 7. WebGL2 limits

| Item | iOS / iPadOS Safari | Since | Workaround if absent | Source | Android Chrome |
|---|---|---|---|---|---|
| WebGL2 | Supported | 15 | — | BCD `api.WebGL2RenderingContext` | Supported since 58 |
| `EXT_color_buffer_float` (render to RGBA16F/RGBA32F) | Supported | 15 | — | BCD `api.EXT_color_buffer_float` | Supported since 56 |
| `EXT_color_buffer_half_float` | Supported | 14 | — | BCD `api.EXT_color_buffer_half_float` | Supported since 63 |
| `OES_texture_float_linear` (linear filtering of float32) | BCD note: "Only supported on iPadOS." **iPhone has none** | 8 (iPad) | Half-float, which WebGL2 filters linearly in core | BCD `api.OES_texture_float_linear` | Supported since 29 |
| `EXT_float_blend` | **Removed** (15 → 16) | — | — | BCD `api.EXT_float_blend` | Supported since 75 |
| `renderbufferStorageMultisample`, `getInternalformatParameter` | Supported | 15 | — | BCD `api.WebGL2RenderingContext.renderbufferStorageMultisample`, `.getInternalformatParameter` | Supported since 58 |
| **RGBA16F multisampled sample counts** | **Unknown, no source.** The only survey figure is `MAX_SAMPLES` (iOS: ≥4 in 100% of reports, ≥8 in 21%), and the repo's `CLAUDE.md` names `MAX_SAMPLES` as the wrong question for RGBA16F | — | Ask at runtime (already done) | <https://web3dsurvey.com/webgl2/parameters/MAX_SAMPLES> (`MAX_SAMPLES` only) | `MAX_SAMPLES` ≥4 in 100%, ≥8 in 2% |
| `EXT_disjoint_timer_query_webgl2` | **Absent** | — | Frame-period instruments | BCD `api.EXT_disjoint_timer_query_webgl2` | **Absent** too (BCD `chrome_android: false`) |
| `MAX_TEXTURE_SIZE` | ≥8192 in 100% of iOS reports, ≥16384 in 99% | — | — | <https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE> | ≥4096 in 100%, ≥8192 in 75%, ≥16384 in 3% |
| ASTC compressed textures | Supported | 12 | — | BCD `api.WEBGL_compressed_texture_astc` | Supported since 47 |

**For seelite.** `src/output-stage.ts:264-268` already asks
`getInternalformatParameter(RENDERBUFFER, RGBA16F, SAMPLES)`, and
`grantedSamples` (`:299`) rounds up to a count the context supports. The
black-frame failure in `CLAUDE.md` is therefore guarded against at runtime on
iOS. The guard is not proven there, because no device has been measured.
`src/frame-attribution.ts` reads `unavailable` on both mobile engines, because
neither exposes the timer extension. `src/adaptive-resolution.ts` steers on the
delivered rAF frame period, not on the GPU timer (`:10-13`). Its signal exists
on iOS.

## 8. Memory ceiling

| Item | iOS / iPadOS Safari | Since | Workaround | Source | Android Chrome |
|---|---|---|---|---|---|
| Published per-tab ceiling | **None published.** No Apple or WebKit figure was found | — | Measure on the principal's devices | — | Unknown |
| What happens when it is crossed | iOS terminates the page under memory pressure and Safari reloads it at once. This repeats until Safari shows "A problem repeatedly occurred on …". JavaScript sees no out-of-memory error and no `webglcontextlost` beforehand. Bug 300782 (NEW, iPhone and iPad, iOS 18) says it is easier to trigger on lower-memory devices | — | Stay under budget; the page cannot catch the kill | <https://bugs.webkit.org/show_bug.cgi?id=300782> | A comment on the same bug claims Android loads "4 to 16 times more" before crashing. Anecdotal |
| A reported kill point | An iPad Air 3 on iOS 14.2 was killed at 1.25 GB while a canvas-resize **leak** grew it from under 300 MB. That is one device and one leak, not a ceiling | — | — | <https://bugs.webkit.org/show_bug.cgi?id=219780> | — |

**For seelite.** The figures here are not a budget: the neural voice model
(about 160 MB, per #846), the authored GLBs (36 MB on disk in `src/models/`:
`coriolis.glb` 6.4 MB, `courier-cockpit.glb` 3.0 MB, `courier-hull.glb` 15 MB,
`longwall-miner.glb` 11 MB; GPU and heap footprint not measured) and the
half-float composer targets. Crossing the limit looks like a reload loop, not
an error, so no in-game fallback can react to it.

## 9. Audio unlock and AudioWorklet

| Item | iOS / iPadOS Safari | Since | Workaround if absent | Source | Android Chrome |
|---|---|---|---|---|---|
| Which events grant activation | `keydown` other than Esc or a reserved shortcut; `mousedown`; `pointerdown` only for a mouse; `pointerup` only for a non-mouse pointer; `touchend` | — | — | <https://html.spec.whatwg.org/multipage/interaction.html#activation-triggering-input-event> | Same spec |
| `AudioContext.resume()` | Supported | 9 | — | BCD `api.AudioContext.resume` | Supported since 41 |
| `AudioWorklet` | Supported | 14.5 | — | BCD `api.AudioWorklet`, `api.BaseAudioContext.audioWorklet` | Supported since 66 |
| Ringer / silent switch | Web Audio defaults to the "ambient" audio session, so **the silent switch mutes it**. `navigator.audioSession.type = "playback"` stops that | **CONFLICT:** BCD says `navigator.audioSession` since 16.4; WebKit's comment on 237322 says "since iOS 17" | Set `navigator.audioSession.type = "playback"` | <https://bugs.webkit.org/show_bug.cgi?id=237322>; BCD `api.Navigator.audioSession` | No Audio Session API (BCD `false`) |

**For seelite.** `src/audio-unlock.ts:53-56` listens on `keydown`,
`pointerdown`, `pointerup` and `touchend`. Its header (`:8-16`) states the
same rule as the HTML spec, so #550's fix matches the spec.
`src/music.ts:96` loads an `AudioWorklet` module, which is supported since
14.5. Nothing in `src/` sets `navigator.audioSession`: a search finds no
match. As shipped, an iPhone with the switch on silent plays no game audio.

## 10. Storage and eviction

| Item | iOS / iPadOS Safari | Since | Workaround | Source | Android Chrome |
|---|---|---|---|---|---|
| Seven-day cap on script-written storage | With tracking prevention on, an origin that sees no user interaction in seven days of Safari use loses all script-written storage: IndexedDB, localStorage, SessionStorage, Media keys, and Service Worker registrations and cache | 13.1 (2020) | A visit within the window resets the count | <https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/>; <https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria> | No time-based eviction. Eviction is LRU under storage pressure, per MDN |
| Home Screen web apps and the seven days | **CONFLICT.** WebKit (2020): Home Screen apps "have their own counter of days of use", and "We do not expect the first-party in such a web application to have its website data deleted". MDN's current page names no Home Screen exemption | — | — | Both URLs above | — |
| Quota | Browser app: origin up to 60% of disk, overall up to 80%. A Home Screen web app gets the same quotas. Eviction is LRU across origins, and covers localStorage, Cache API, IndexedDB, Service Worker and File System | 17 | — | <https://webkit.org/blog/14403/updates-to-storage-policy/> | Chrome uses at most 80% of disk (MDN) |
| `navigator.storage.persist()` | Supported. WebKit grants it "based on heuristics like whether the website is opened as a Home Screen Web App". A persistent origin "might be excluded from eviction". Whether that also exempts it from the seven-day ITP deletion is not stated: **unknown** | 15.2 | Home Screen launch improves the odds | <https://webkit.org/blog/14403/updates-to-storage-policy/>; BCD `api.StorageManager.persist` | Supported since 55. Granted on interaction history, with no prompt (MDN) |
| `navigator.storage.estimate()` | Supported | 17 | — | BCD `api.StorageManager.estimate` | Supported since 61 |
| Eviction granularity | The whole origin at once: "If the origin had stored data by using IndexedDB and the Cache API … then both types of data are deleted" | — | — | <https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria> | Same |

**For seelite.** Saves live in IndexedDB (`src/save-store.ts:1330`, database
`seelite-saves`). The voice model's parts live in Cache Storage
(`src/voice-store.ts:61`, `caches.open(MODEL_CACHE_PREFIX + version)`), and
its line cache is also in IndexedDB (`src/voice-store.ts:112`). The seven-day
rule and LRU eviction both apply to all three. Eviction removes the whole
origin, so saves and voice go together. `navigator.storage.persist()` is
called in one place, `src/neural-voice.ts:307`, when the voice starts. Because
persistence is per origin, saves are covered only as a side effect of starting
the voice. Nothing on the save path requests persistence.

---

## Consequences for the map's open nodes

These are findings only. Each line says which options a finding keeps open or
closes; none of it is a decision.

**#849, the input model**
- Pointer lock is absent on iPhone, and on iPad its status is unknown even
  with a mouse (§1). Any option that needs a locked pointer for steering on
  iOS is ruled out. Mouse-move steering is desktop only.
- The tap that turns tilt on must call `requestPermission()` on a gesture that
  counts (`touchend` or `click`, not `touchstart`) and over HTTPS (§4). Tilt
  can therefore only be offered behind an explicit tap, never switched on
  silently. Its input arrives at 60 Hz.
- Pads with the standard mapping are in. The poll-only reader matches WebKit
  (§3). Rumble is out (`vibrationActuator` is absent).
- The iPad keyboard route cannot rely on Escape: the key is often missing, and
  Cmd+. arrived as "Period" in the only source (§5). Options that bind every
  back or close action to Escape alone are ruled out for that route. Which
  keys iPadOS takes is unknown.
- `src/main.ts:5146` throws `TypeError` on every qualifying canvas click where
  `requestPointerLock` is missing (§1). Any input option that keeps that click
  handler live on iOS inherits the error.

**#850, the touch flight prototype**
- Touch steering has to work from `PointerEvent` and `TouchEvent` deltas with
  no lock (§1, §6). Multi-touch and pointer events are supported (13+).
- The flight canvas currently sets no `touch-action`, and
  `user-scalable=no` is ignored (§6). A prototype that does not set
  `touch-action: none` on the game surface keeps pinch and double-tap zoom.
- Edge swipes can only be suppressed by a `touchstart` `preventDefault` near
  the edges, a third-party technique (§6). Controls placed against a screen
  edge carry that risk.
- In iPad element fullscreen, a swipe down exits fullscreen (§2). A prototype
  that maps a downward swipe near the top of the screen to a flight control
  conflicts with that exit gesture.

**#851, layout**
- Portrait cannot be locked out (no `screen.orientation.lock`, no manifest
  `orientation`), so the turn-the-device prompt has to come from detection
  (§2). That is what the map's constraint already asks for.
- iPhone has no element fullscreen. A Home Screen launch (standalone) is the
  only way to drop the browser UI, and since iOS 26 every site added to the
  Home Screen opens as a web app by default (§2). Layouts that assume a full
  screen on iPhone in the browser are ruled out.
- `(pointer: coarse)` / `(hover: none)` are supported, but with a mouse or
  trackpad on an iPad they are not documented (§6). Choosing a layout from
  those queries alone has no source for the iPad-with-trackpad case.

**#852, the quality preset**
- WebGL2, half- and full-float colour buffers, and RGBA16F multisample queries
  are all present (§7). The current renderer's feature set is not ruled out.
- Float32 linear filtering is iPad only (§7). Any preset that depends on it is
  ruled out on iPhone.
- The GPU timer is absent on iOS and on Android Chrome (§7). A preset or
  controller keyed on GPU time is ruled out on mobile.
  `adaptive-resolution.ts`'s frame-period signal is not ruled out.
- There is no published memory ceiling, and crossing it is an uncatchable
  reload loop (§8). A preset cannot rely on a runtime fallback for memory: the
  budget has to be set before load, from on-device measurement.

**#848, the evidence lane**
- Playwright's WebKit is **desktop** WebKit, which has pointer lock and element
  fullscreen. Touch and viewport emulation do not remove those APIs, so a probe
  in emulation cannot reproduce what iOS lacks (§1, §2). That includes the
  `main.ts:5146` throw. A lane that wants those cases needs to stub the APIs
  out or use a real device.
- Tilt permission refuses outside HTTPS (§4). A phone pointed at a plain-http
  LAN dev server cannot test tilt. The real-device tier needs an HTTPS origin.
- The silent switch mutes Web Audio by default (§9). An audio check on a real
  iPhone depends on the switch position until `audioSession` is set.
- Memory, the RGBA16F sample counts, the keys iPadOS takes, pointer lock with
  an iPad mouse, and the `pointer`/`hover` values with a trackpad (§1, §5, §6,
  §7, §8) are unknown in every source. Only the real-device tier can answer
  them.
