---
name: video-gen
description: Generate videos with AI models — text-to-video and reference-driven video (image-to-video, reference-to-video, video continuation) via the ai-video-gen CLI. Use when the user wants to create a video from a description or animate/extend images or clips.
---

# Video Generation Skill

Generate or animate videos through the `ai-video-gen` CLI. **Every call costs
~$0.02–$0.30 at defaults** (seedance-2.0-fast/-mini, 5s, 720p, audio off) and
**takes 1–5 minutes** — mention both when the user asks for multiple videos.
Higher tiers (veo, sora-2-pro, 4K) run $1–2 per clip.

## Before First Use

If `vidgen` is not set up yet, run once:

```bash
~/.pi/agent-git/skills/video-gen/scripts/setup.sh
```

It syncs the project environment and verifies the install.

## Required Inputs — gather before running

1. **prompt** (always required) — what the video should show, or the
   animation/edit instruction.
2. **generate vs animate** — no reference inputs → GENERATE. With references →
   ANIMATE: `--first-frame image.png` (image-to-video; `--last-frame` for
   first→last interpolation), repeatable `--image` (reference-to-video,
   subject consistency — cannot combine with frames), or `--video clip.mp4`
   (continuation/edit — **replicate provider only**). Do not invent paths:
   if the user wants an animate but gives no input, ask for the path.
3. Optional knobs — only ask if the user volunteers them, otherwise use
   defaults: `--duration` seconds (pin 5s), `--aspect-ratio` (16:9),
   `--resolution` (`480p`/`720p`/`1080p`/`4K`; pin 720p), `--audio on|off`
   (pinned off on seedance — its audio path terminal-fails some prompts on a
   copyright classifier), `--model`, model-specific `--extra key=value`
   (e.g. `--extra seed=42`). A second provider is available:
   `--provider openrouter` (30 models via the unified Video API; default
   `bytedance/seedance-2.0-mini`; needs `OPENROUTER_API_KEY`; no
   `--video` inputs there). Check `vidgen models` for capabilities before
   switching.

## Running

The wrapper is `scripts/vidgen` in this skill's folder. stdout is **always
valid JSON**; stderr carries a human summary. Exit codes: `0` ok · `1`
provider failure (retryable ones were already retried) · `2` usage/config.

Generate (text-to-video):

```bash
~/.pi/agent-git/skills/video-gen/scripts/vidgen generate \
  --prompt "a drone shot over a lotus pond at dawn"
```

With knobs:

```bash
~/.pi/agent-git/skills/video-gen/scripts/vidgen generate \
  --prompt "a neon koi" --aspect-ratio 9:16 --duration 8 --resolution 1080p \
  --model google/veo-3.1 --extra seed=42
```

Animate (reference-driven):

```bash
~/.pi/agent-git/skills/video-gen/scripts/vidgen animate \
  --prompt "slow push-in as the sky deepens" --first-frame still.png

~/.pi/agent-git/skills/video-gen/scripts/vidgen animate \
  --prompt "feature this character" --image ref1.png --image ref2.png

~/.pi/agent-git/skills/video-gen/scripts/vidgen animate \
  --prompt "continue this clip as night falls" --video clip.mp4
```

## Handling the result

Parse stdout as JSON. On `"status": "ok"`, the video is saved at
`video.path` — under the `output_dir` from the result, i.e.
`<cwd>/outputs/<request-hash>/` with the skill default — alongside
`request.json` + `metadata.json` with job id, provider URL, timing, and
usage/cost as reported. Tell the user the saved path.

On `"status": "error"`: `retryable: true` means another attempt may work
(just re-run the same command); otherwise report `error_code` + `message`
to the user. If a run died mid-wait on a network blip, the job may still
have completed server-side — mention checking the provider dashboard before
re-running (a re-run is a new paid job).

## Introspection

```bash
~/.pi/agent-git/skills/video-gen/scripts/vidgen models   # both providers' fleets
~/.pi/agent-git/skills/video-gen/scripts/vidgen doctor   # credentials/health/captures
```

## Notes

- Defaults: replicate `bytedance/seedance-2.0-fast` · openrouter
  `bytedance/seedance-2.0-mini`; cost pins (5s / 720p / audio off) apply
  unless the user explicitly upgrades.
- Duration/resolution clamp DOWN (or to the model's floor) — never a silent
  upgrade; aspect is strict (typed error when the model lacks the ratio).
- A model set in `ALLOWED_MODELS__REPLICATE` / `ALLOWED_MODELS__OPENROUTER`
  (.env) must be listed there or explicit `--model` overrides are rejected.
- Relative `--first-frame`/`--image`/`--video`/`--output-dir` paths resolve
  against YOUR current working directory; outputs land in `<cwd>/outputs/`
  unless `--output-dir` is given.
- Reference rules are typed errors, never silent: `--last-frame` needs
  `--first-frame`; frames cannot combine with `--image`; `--video`
  cardinality is per model.
