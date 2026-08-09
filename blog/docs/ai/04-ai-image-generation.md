---
title: AI Image Generation
slug: ai-image-generation
description: Generate images, textures, skyboxes, and perform editing operations like background removal, inpainting, and upscaling using AI.
status: draft
audience: creators
prerequisites: [getting-started/02-editor-tour]
---

# AI Image Generation

> **Playground scope:** image-generation controls depend on a supported
> browser-direct provider and a browser-stored key. Account-backed quotas,
> remote upload libraries, and server-managed generation are not deployed
> Playground features.

StemStudio includes AI-powered image generation tools that let you create textures, skyboxes, and general-purpose images from text prompts. You can also edit existing images with background removal, inpainting (mask-and-replace), and upscaling.

## What This Page Is For

Use this page when you need to answer questions like:

- How do I generate an image or texture from a text prompt?
- How do I create a skybox with AI?
- How do I remove an image background or inpaint a region?
- How do I upscale a low-resolution image?

## Text-To-Image Generation

Generate images from text descriptions. Useful for concept art, UI elements, or general-purpose assets.

### How To Generate

1. Open the image generation tool in the editor.
2. Enter a **prompt** describing the image you want.
3. Optionally enter a **negative prompt** to exclude unwanted features.
4. Set the image dimensions (**width** and **height**).
5. Set the number of samples to generate.
6. Click **Generate**.

### Parameters

| Parameter | Description |
|-----------|-------------|
| **prompt** | Text description of the image |
| **negativePrompt** | Features to exclude |
| **width** | Image width in pixels |
| **height** | Image height in pixels |
| **numSamples** | Number of image variations to generate |

## Image-To-Image Generation

Start with an existing image and transform it based on a text prompt. This keeps the composition of the original image while applying new styles or modifications.

### Parameters

Same as text-to-image, plus:

| Parameter | Description |
|-----------|-------------|
| **image** | The source image to transform |

This is useful for:

- Applying a consistent art style to reference photos
- Creating variations of an existing asset
- Transforming sketches into finished artwork

## Texture Generation

Generate seamless textures for use on 3D objects. Textures are generated specifically for tiling and material use.

### Text-To-Texture

Describe a surface material and generate a tileable texture:

- "Rough stone wall with moss in the cracks"
- "Clean white marble with gray veins"
- "Rusty metal plate with rivets"

### Image-To-Texture

Provide a reference image and generate a matching seamless texture. Useful when you have a photo of a material and want a clean, tileable version.

### Parameters

Same parameters as image generation. The endpoint is optimized for producing results that tile well as material textures.

## Skybox Generation

Generate 360-degree skybox images from text prompts. Skyboxes are used as the background environment for your scene.

### How To Generate A Skybox

1. Open the skybox generation tool.
2. Enter a prompt describing the environment:
   - "Sunset over a calm ocean with scattered clouds"
   - "Dense forest clearing with rays of light"
   - "Alien planet with two moons and purple sky"
3. Optionally choose a **style** preset.
4. Click **Generate**.

### Parameters

| Parameter | Description |
|-----------|-------------|
| **prompt** | Text description of the environment |
| **negativePrompt** | Features to exclude |
| **width** | Image width in pixels |
| **style** | Style preset for the skybox |
| **numSamples** | Number of variations |

The generated skybox is formatted for use as a scene background. Once generated, you can apply it to your scene through the scene settings.

## Background Removal

Remove the background from an existing image, producing a transparent PNG. This is useful for:

- Creating sprite-like assets from photos
- Isolating objects for use as textures or UI elements
- Preparing reference images for image-to-3D generation

### How To Use

1. Upload or select an image asset.
2. Use the **Remove Background** tool.
3. The result is a new image with a transparent background.

### Parameters

| Parameter | Description |
|-----------|-------------|
| **assetId** | ID of the image asset to process |

## Inpainting (Mask Replace)

Replace a specific region of an image using a mask. You paint over the area you want to change and provide a text prompt describing what should replace it.

### How To Use

1. Select an image asset.
2. Paint a mask over the region you want to replace.
3. Enter a prompt describing what should appear in the masked area.
4. Click **Generate Fill**.

### Parameters

| Parameter | Description |
|-----------|-------------|
| **assetId** | ID of the source image |
| **mask** | The mask defining the region to replace |
| **prompt** | Description of what to put in the masked area |
| **negativePrompt** | Features to exclude from the fill |

### Use Cases

- Replace a sky in a photo with a different sky
- Fix artifacts or unwanted elements in a generated image
- Add objects to a specific location in an existing image

## Image Upscaling

Increase the resolution of an existing image using AI upscaling. This preserves detail while making the image larger.

### Parameters

| Parameter | Description |
|-----------|-------------|
| **assetId** | ID of the image to upscale |
| **scalingFactor** | How much to increase the resolution |
| **style** | Style to apply during upscaling |
| **imageType** | Type of image (helps the AI preserve appropriate details) |
| **prompt** | Optional guidance for the upscaling process |
| **negativePrompt** | Features to exclude |

### When To Upscale

- After generating a small preview image, upscale it for use as a high-res texture
- When importing low-resolution reference images
- To improve texture quality on close-up surfaces

## Pixelation

Convert an image to a pixel art style. This is useful for retro-styled games or for creating simplified versions of complex images.

### Parameters

| Parameter | Description |
|-----------|-------------|
| **assetId** | ID of the image to pixelate |
| **pixelGridSize** | Size of the pixel grid |
| **removeNoise** | Whether to clean up noise in the result |
| **removeBackground** | Whether to make the background transparent |

## Asset Management

Generated images are stored as assets in your project. You can:

- **List assets** -- Browse all generated images with pagination
- **Download assets** -- Download generated images as PNG files
- **Delete assets** -- Remove images you no longer need
- **Upload images** -- Add external images to the generation asset library

Assets can be used across any scene in your project.

## Common Use Cases

| Goal | Tool | Prompt Example |
|------|------|---------------|
| Scene background | Skybox Generation | "Mountain valley at dawn with fog" |
| Floor texture | Text-to-Texture | "Worn wooden planks with nail holes" |
| Wall material | Text-to-Texture | "Red brick wall with white mortar" |
| Character portrait | Text-to-Image | "Fantasy warrior portrait, painted style" |
| UI icon | Text-to-Image + Background Removal | "Golden coin icon, flat design" |
| Concept art | Text-to-Image | "Medieval marketplace with market stalls" |
| Fix a texture | Inpainting | Mask the bad area, prompt the replacement |
| Higher-res texture | Upscaling | Upscale a generated or imported texture |

## Tips For Good Image Prompts

### Be Descriptive About Style

Good: "Watercolor painting of a cozy cottage in autumn with warm colors and soft edges"

Less useful: "A house"

### Specify The Intended Use

For textures, mention they should be seamless:

Good: "Seamless cobblestone path texture, top-down view, consistent lighting"

### Use Negative Prompts

Negative prompts help avoid common issues:

- "blurry, low quality, text, watermark" -- General quality
- "photorealistic" -- When you want a stylized look
- "people, faces" -- When you want environments only

### Match Your Game's Art Style

If your game uses a specific art style, reference it in every prompt to maintain consistency:

- "low-poly style, flat shading" for low-poly games
- "hand-painted, stylized" for stylized games
- "pixel art, 16-bit" for retro games

## Things To Know

- Image generation requires a supported provider key.
- Provider quota, billing, CORS, and content policies apply.
- Generated images are stored in your project's asset library.
- All providers return image URLs that can be used directly as textures.
- Skybox generation produces equirectangular images suitable for scene backgrounds.
- Background removal works best with images that have clear subject-background separation.

## Next Steps

- Read [AI 3D Model Generation](03-ai-model-generation.md) to generate 3D models from text or images.
- Read [AI Copilot](01-ai-copilot.md) to learn how the copilot can help you use these tools.
- Read [Editor Tour](../getting-started/02-editor-tour.md) to find the image generation tools in the editor UI.
