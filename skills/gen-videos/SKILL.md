---
name: gen-videos
description: Generate videos from a text prompt or from an input image using Google's Veo API via the @google/genai SDK. Use this skill when the user asks to create, generate, render, or animate a video, turn an image into a video, or specifically mentions using Veo / AI video generation.
---

# Video Generator Skill

This skill generates videos using Google's **Veo** models via the `@google/genai` SDK.
Input can be **text** (text-to-video) or an **image** (image-to-video / animate an image).

## Requirements

- **Node.js 18+**
- The `GEMINI_API_SKILL` environment variable must be set (same key as the `gen-images` skill). The script picks it up automatically; if missing it will exit and ask the user to set it.
- Veo requires a **paid (billing-enabled)** Google AI Studio project. Free tier does not include video.
- Install the dependency first — this repo does not ship `node_modules`:
  ```bash
  cd <skill-dir>/scripts && npm install
  ```

## How to use this skill

The script lives in `scripts/` **next to this `SKILL.md`** — call that directory `<skill-dir>`.

Video generation is a long-running operation: the script submits the job, polls every 10s until it is done, then downloads the MP4.

**Text → video:**
```bash
node <skill-dir>/scripts/generate-video.js "YOUR DETAILED PROMPT HERE" "output_filename.mp4"
```

**Image → video** (animate an existing image — pass the image path as the 3rd argument; the prompt may be empty `""` but a prompt describing the motion gives better results):
```bash
node <skill-dir>/scripts/generate-video.js "describe the desired motion" "output_filename.mp4" "/path/to/input_image.jpg"
```

*Note: relative output paths are saved to the current working directory. Use an absolute path to control the destination.*

## Configuration

Environment variables (optional):
- `VEO_MODEL` — model id. Default `veo-3.0-generate-001` (latest, includes audio). If your key/region does not support Veo 3, set `VEO_MODEL=veo-2.0-generate-001` (no audio).
- `VEO_ASPECT_RATIO` — `16:9` (default) or `9:16`.

## Handling Output

- On success, notify the user of the saved MP4 path.
- If it fails due to a missing API key, instruct the user to set it:
  - macOS / Linux: `export GEMINI_API_SKILL="your_api_key_here"`
  - Windows (PowerShell): `[Environment]::SetEnvironmentVariable("GEMINI_API_SKILL", "your_api_key_here", "User")`
- If it fails with a model-not-found / unsupported error on Veo 3, suggest retrying with `VEO_MODEL=veo-2.0-generate-001`.
- Relay any other API error (safety/RAI filtering, quota, billing, network) message to the user.
