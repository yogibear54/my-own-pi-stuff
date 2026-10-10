---
name: image-gen
description: Generate and edit images with AI models — text-to-image and reference-image editing via the ai-image-gen CLI. Use when the user wants to create a new image from a description or modify an existing image.
---

# Image Generation Skill

Generate or edit images through the `ai-image-gen` CLI. Every call costs
~**$0.012** at defaults (gpt-image-2, quality low) — mention this when the
user asks for many images.

## Before First Use

If `imggen` is not set up yet, run once:

```bash
~/.pi/agent-git/skills/image-gen/scripts/setup.sh
```

It syncs the project environment and verifies the install.

## Required Inputs — gather before running

1. **prompt** (always required) — what the image should show, or the edit
   instruction.
2. **edit vs generate** — if the user references an existing image, this is
   an EDIT: collect the image path(s) for `--image`. Otherwise it is
   GENERATE.
3. Optional knobs — only ask if the user volunteers them, otherwise use
   defaults: `--model` (default `openai/gpt-image-2`), `--aspect-ratio`
   (default `1:1`), `--resolution-tier` (`1K`/`2K`/`4K`),
   `--output-format` (`png`), model-specific `--extra key=value`
   (e.g. `--extra seed=42`).

Do not invent reference-image paths: if the user wants an edit but gives no
image, ask for the path.

## Running

The wrapper is `scripts/imggen` in this skill's folder. stdout is **always
valid JSON**; stderr carries a human summary. Exit codes: `0` ok · `1`
provider failure (retryable ones were already retried) · `2` usage/config.

Generate:

```bash
~/.pi/agent-git/skills/image-gen/scripts/imggen generate --prompt "a watercolor lotus"
```

With knobs:

```bash
~/.pi/agent-git/skills/image-gen/scripts/imggen generate \
  --prompt "a watercolor lotus" --aspect-ratio 16:9 \
  --model bytedance/seedream-5-lite --extra seed=42
```

Edit (one or more reference images):

```bash
~/.pi/agent-git/skills/image-gen/scripts/imggen edit \
  --prompt "make it a pencil sketch" --image /path/to/photo.png
```

## Handling the result

Parse stdout as JSON. On `"status": "ok"`, the image is saved at
`image.path` — under the `output_dir` from the result, i.e.
`<cwd>/outputs/<request-hash>/` with the skill default — alongside
`request.json` + `metadata.json` with prediction id, provider URL, and usage
tokens. Tell the user the saved path.

On `"status": "error"`: `retryable: true` means another attempt may work
(just re-run the same command); otherwise report `error_code` + `message`
to the user.

## Introspection

```bash
~/.pi/agent-git/skills/image-gen/scripts/imggen models   # 24-model capability table
~/.pi/agent-git/skills/image-gen/scripts/imggen doctor   # token/provider/capture health
```

## Notes

- Default model is `openai/gpt-image-2` with `quality: low` pinned. Other
  models: check `imggen models` first; a model set in `ALLOWED_MODELS__REPLICATE`
  (.env) must be listed there or overrides are rejected.
- Relative `--image` / `--output-dir` paths resolve against YOUR current
  working directory; outputs land in the project's `outputs/` folder unless
  `--output-dir` is given.
- Reference-image cardinality is per model (e.g. qwen/grok accept exactly
  one) — errors say so explicitly.
