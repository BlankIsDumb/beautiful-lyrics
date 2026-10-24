# Completed local.4 checkpoint

Current requested implementation is built, installed and runtime-checked.
Working tree contains uncommitted local.3/local.4 work; do not discard it.
No commit or push performed. See VALIDATION.md for detailed evidence.

## Delivered
- Behavior above Spicy: on-song-change / when-required fetching, sidebar toggle,
  individual provider switches. Shared 800 ms burst gate unchanged.
- Disabled providers bypass caches and fetches. Sidebar enabled overrides demand;
  disabling cleans up its observers/cards.
- Topbar no-drag styles on injected buttons and descendants. Physical mouse
  confirmation remains needed; Comfy source/settings unchanged.
- Spicy uses loopback relay, no public proxy or credential/lyrics persistence.
  Client key with no-Origin requests enabled works. Never print saved credentials.
- Spicy word lyrics rendered live (298 timed segments) with attribution.
- Live on-demand, completed-result reuse and provider switches passed.
- Local preparation failures retained as diagnostics while valid fallbacks render.

## Relay operation
Run scripts/start-spicy-relay.ps1 after reboot (Node 20+). Binds 127.0.0.1:8967;
no autorun installed. Verify /health instead of trusting old process IDs.
Only exact Spotify Origin, fixed Spicy endpoint and validated IDs accepted.
Upstream omits Origin; only the Spicy token goes to Spicy.

## Findings / remaining limitations
- 3Qk92ozKLvbNyFMwkjNPfO: Lyrics Plus used LRCLIB; our parser supports it.
  Earlier miss has no confirmed cause. Spotify returned plaintext; NetEase line
  sync without YRC; Spicy word sync.
- Spotify/NetEase investigated, not implemented. No quota guarantee inferred.
- Sidebar DOM compatibility needs a separate pass; toggle plumbing complete.
- Earlier missing Spicy candidate could not be reproduced; no invented fix.
- Provider settlement waits for all attempted providers. Progressive display,
  provider expansion and performance redesign remain outside scope.

41 tests pass with loopback access. Build/source whitespace checks pass.
Bundle SHA256 E39D56C59A84598B371A150BC3F02397C9F1D2880CC7D6BB023E5BAA0D29B3B0.
Comfy applied hashes/settings unchanged, checkout clean. Prior preferences/page/
paused playback restored; temporary runtime listeners removed.

CDP 127.0.0.1:8088; probes/screenshots outside repo:
C:/Users/blank/Desktop/cd/.beautiful-lyrics-validation.
For WebSocket use Node24:
C:/Users/blank/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe.

Latest follow-up: startup toast and macOS launcher are installed/documented.
See VALIDATION.md and LOCAL.md. Relay restarted with browser-readable health route.
Actual macOS execution remains unverified; bash syntax checked on Windows Git Bash.
The bundle hash above belongs to the preceding build and is now superseded.

Latest pass: GHOST preparation fixed by rebuilding corrupted embedded dictionary.
New integrity guard verifies every emitted/persisted payload; all-failed provider
preparation now exposes reasons. 42 tests pass. See AUDIT-2026-10-24.md for the
remaining concrete issues and suggested order. No commit/push. Current bundle
SHA256 3B25F26ED783DDDC205D9A7636152D193B3BCF843D44837CE4B083A80FB7B7C3.
