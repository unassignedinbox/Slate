# Eevee-style realtime GI in the browser

A standalone **WebGL 2** deferred renderer, built without Three.js or any remote runtime dependency. It uses an ShaderBall-inspired 6×4 material grid and implements the important realtime pieces rather than faking indirect light with an ambient term.

## Pipeline

```text
shadow-map depth pass
    ↓
HDR G-buffer (view position · normal/roughness · albedo/metalness · direct PBR/emission)
    ↓
half-resolution SSGI
  cosine-hemisphere rays → projection to screen → depth/thickness intersection → hit radiance reuse
    ↓
temporal resolve (history clamp; reset on camera/quality changes)
    ↓
two-pass depth/normal-guided bilateral denoise
    ↓
joint-bilateral upsample + direct HDR + indirect HDR → ACES tone map → browser canvas
```

The shader sources are embedded in `main.js`, deliberately adjacent to the WebGL pass scheduling so the render graph is easy to audit:

- **Shadow map:** depth-only 1024² PCF shadow pass for the direct area-light approximation.
- **G-buffer:** four HDR `RGBA16F` targets: camera/view-space position, normal+roughness, albedo+metalness, and direct/emissive lighting.
- **SSGI:** stochastic cosine-hemisphere screen-space rays at half resolution. A ray is marched in view space, projected through the active projection matrix, and tested against G-buffer position/thickness. On a hit it reuses that visible hit's direct/emissive radiance as a one-bounce indirect estimate.
- **Temporal:** history is only reused while the camera and GI controls are stable. Changing any of them clears both history textures; this avoids invalid reprojection ghosts.
- **Denoise / upsample:** two bilateral passes use G-buffer depth and normal similarity; the final full-resolution composite uses a joint-bilateral GI upsample before ACES tone mapping.

This is **Eevee-style screen-space GI**, not SurfelGI: it only knows visible G-buffer surfaces and therefore has normal SSGI limitations—off-screen lighting cannot contribute and rays can miss hidden geometry. The green/blue control-panel indicator is the indirect component; turning GI off removes the entire SSGI/temporal/denoise sequence.

## Run

From the repository root:

```bash
python3 -m http.server 8080 --bind 0.0.0.0
```

Open `http://localhost:8080/Experimental/EeveeRealtimeGI/` locally, or use Arena's live-preview address when the server is launched through Agent Mode.

## Controls

- **Drag:** orbit the ShaderBall camera.
- **Scroll:** zoom.
- **Screen-space GI:** enable/disable SSGI and all dependent passes.
- **Temporal accumulation:** toggle the stable-camera history resolve.
- **Rays / pixel** and **March steps:** real ray-march work controls, not cosmetic values.
- **GI intensity:** final HDR indirect multiplier.
- **Render scale:** reallocates G-buffer and GI targets; half-resolution SSGI tracks it.

## Browser requirements

WebGL 2 and `EXT_color_buffer_float` are required. Most desktop Chrome, Firefox, Edge, and current Safari versions on discrete GPUs meet this; the page displays an explicit explanation otherwise.
