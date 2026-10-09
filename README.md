# Slate

## HMI prototype

Browser prototype of the vehicle HMI (Android-style shell, 3D apps, online features). Design notes: [`docs/HMI_DESIGN.md`](docs/HMI_DESIGN.md). Run with `cd hmi && python3 -m http.server 8080`.

### 3D in-car preview

`/` (`hmi/index.html`) is a 3D cabin with the live HMI on a tilted tablet. Taps on the tablet work.
The flat 2D HMI is at `/app.html`. See [`docs/HMI_DESIGN.md`](docs/HMI_DESIGN.md) section 12.
