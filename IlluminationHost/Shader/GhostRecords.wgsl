//============================================================================================================================================
//                                                           GHOSTRECORDS.WGSL
//============================================================================================================================================
// 🧩 The HMI finish's X-ray ghost as the surface raster and the ghost raster read it: a scan front and an amount.
//
// 📝 The Garage's X-ray (the configurator's scan mode): a front sweeps the car from nose to tail. Vehicle pixels
//    behind it dissolve out of the opaque raster (dithered, so temporal antialiasing resolves the fade) and the
//    ghost raster draws them back as a fresnel hologram — scanlines, a glowing wavefront, the shell's hard edges —
//    over the recombined radiance. Parked past the tail the whole car is a ghost; at amount zero nothing is.

// 📝 Amount ramps 0 → 1 on the mode switch; the scan cycles front → hold → fade like the configurator's (6.6 s).
struct GhostRecord
{
    Scan : vec4f,   // x front [m] in the car-body frame (+X forward), y amount [0, 1], z wire opacity [-], w time [s]
    Tint : vec4f,   // rgb ghost colour (linear), w emission strength [-] in the recombined radiance units
}
