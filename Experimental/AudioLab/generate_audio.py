#!/usr/bin/env python3
"""
Procedural Audio Generator for Slate / Project Zero Racing Game
Generates naturalistic WAV files using numpy + wave (no external deps)
All files 44.1kHz, 16-bit, stereo where appropriate
"""

import numpy as np
import wave
import struct
import os
import random
import math
from pathlib import Path

SR = 44100
ROOT = Path(__file__).parent / "Content" / "Audio"
ROOT2 = Path(__file__).parent.parent.parent / "Projects" / "Project-Zero" / "Content" / "AudioArchives"

def ensure_dir(p):
    p.mkdir(parents=True, exist_ok=True)

def write_wav(path, data, sr=SR, stereo=False):
    """
    data: np array float32 -1..1, shape (samples,) mono or (2, samples) stereo or (samples,2)
    """
    ensure_dir(path.parent)
    # normalize
    if isinstance(data, np.ndarray):
        if data.ndim == 1:
            channels = 1
            samples = data
        elif data.ndim == 2:
            if data.shape[0] == 2: # (2, N)
                channels = 2
                samples = np.vstack([data[0], data[1]]).T.reshape(-1) # interleave later?
                # Actually we want interleaved for stereo
                interleaved = np.empty((data.shape[1]*2,), dtype=np.float32)
                interleaved[0::2] = data[0]
                interleaved[1::2] = data[1]
                samples = interleaved
                channels = 2
            else: # (N,2)
                channels = 2
                interleaved = data.reshape(-1)
                samples = interleaved
        else:
            raise ValueError("bad shape")
    else:
        raise ValueError("data must be ndarray")

    # clip and convert to int16
    samples = np.clip(samples, -1.0, 1.0)
    int_data = (samples * 32767).astype(np.int16)

    with wave.open(str(path), 'w') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(int_data.tobytes())
    # also copy to Project-Zero path
    try:
        dest = ROOT2 / path.relative_to(ROOT)
        ensure_dir(dest.parent)
        with wave.open(str(dest), 'w') as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            wf.writeframes(int_data.tobytes())
    except Exception as e:
        print(f"copy failed for {path}: {e}")

    print(f"✓ {path.name} ({len(samples)//channels / sr:.2f}s)")

def white_noise(n, stereo=False):
    if stereo:
        return np.random.uniform(-1,1,size=(2,n))
    return np.random.uniform(-1,1,size=n)

def pink_noise(n, stereo=False):
    # simple pink via filtering white
    def gen(length):
        white = np.random.randn(length)
        # Paul Kellet's pink filter
        b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
        a = [1, -2.494956002, 2.017265875, -0.522189400]
        # implement IIR manually for speed using lfilter approximation via cumulative
        # Use simple 1/f via cumsum of white then highpass? We'll do rough: integrate and normalize
        pink = np.zeros(length)
        # Use Voss-McCartney approximation: sum of several white noises at different rates
        num_sources = 5
        for i in range(num_sources):
            # downsampled white
            step = 2**i
            src = np.random.randn(length//step + 1)
            # upsample via repeat
            up = np.repeat(src, step)[:length]
            pink += up
        pink = pink / np.max(np.abs(pink)) * 0.8
        return pink.astype(np.float32)
    if stereo:
        return np.array([gen(n), gen(n)])
    return gen(n)

def lowpass_filter(signal, cutoff, sr=SR, resonance=0.0):
    # simple one-pole lowpass
    rc = 1.0 / (2 * math.pi * cutoff)
    dt = 1.0 / sr
    alpha = dt / (rc + dt)
    if signal.ndim == 2:
        out = np.zeros_like(signal)
        for ch in range(signal.shape[0]):
            y = 0
            for i in range(signal.shape[1]):
                y = y + alpha * (signal[ch,i] - y)
                out[ch,i] = y
        return out
    else:
        out = np.zeros_like(signal)
        y = 0
        for i in range(len(signal)):
            y = y + alpha * (signal[i] - y)
            out[i] = y
        return out

def highpass_filter(signal, cutoff, sr=SR):
    rc = 1.0 / (2 * math.pi * cutoff)
    dt = 1.0 / sr
    alpha = rc / (rc + dt)
    if signal.ndim == 2:
        out = np.zeros_like(signal)
        for ch in range(signal.shape[0]):
            y = 0
            x_prev = 0
            for i in range(signal.shape[1]):
                y = alpha * (y + signal[ch,i] - x_prev)
                x_prev = signal[ch,i]
                out[ch,i] = y
        return out
    else:
        out = np.zeros_like(signal)
        y = 0
        x_prev = 0
        for i in range(len(signal)):
            y = alpha * (y + signal[i] - x_prev)
            x_prev = signal[i]
            out[i] = y
        return out

def bandpass(signal, low, high, sr=SR):
    return highpass_filter(lowpass_filter(signal, high, sr), low, sr)

def lfo(n, freq, sr=SR, phase=0):
    t = np.arange(n) / sr
    return np.sin(2*np.pi*freq*t + phase)

def envelope_adsr(n, a=0.1, d=0.2, s=0.7, r=0.3, sr=SR):
    total = n
    a_n = int(a*sr)
    d_n = int(d*sr)
    r_n = int(r*sr)
    s_n = max(0, total - a_n - d_n - r_n)
    env = np.zeros(total)
    if a_n>0:
        env[:a_n] = np.linspace(0,1,a_n)
    if d_n>0:
        env[a_n:a_n+d_n] = np.linspace(1,s,d_n)
    if s_n>0:
        env[a_n+d_n:a_n+d_n+s_n] = s
    if r_n>0:
        env[a_n+d_n+s_n:] = np.linspace(s,0,r_n)
    return env

def fade(data, ms=50, sr=SR):
    n = int(ms/1000*sr)
    if data.ndim == 2:
        fade_in = np.linspace(0,1,n)
        fade_out = np.linspace(1,0,n)
        data = data.copy()
        data[:, :n] *= fade_in
        data[:, -n:] *= fade_out
    else:
        fade_in = np.linspace(0,1,n)
        fade_out = np.linspace(1,0,n)
        data = data.copy()
        data[:n] *= fade_in
        data[-n:] *= fade_out
    return data

# === GENERATORS ===

def gen_wind_variants():
    # Light breeze - soft low filtered pink, gentle modulation
    dur = 8.0
    n = int(dur*SR)
    base = pink_noise(n, stereo=True) * 0.6
    # slow amplitude mod
    mod = 0.5 + 0.5 * lfo(n, 0.12) * 0.5 + 0.3 * lfo(n, 0.07, phase=1.2)
    mod_stereo = np.array([mod, np.roll(mod, int(0.2*SR))])
    base = base * mod_stereo * 0.8
    base = lowpass_filter(base, 800)
    base = fade(base, 500)
    write_wav(ROOT / "Ambience" / "Wind_Breeze_Light.wav", base)

    # Medium breeze
    dur = 8.0
    n = int(dur*SR)
    base = pink_noise(n, stereo=True) * 0.8
    mod = 0.6 + 0.4 * lfo(n, 0.2) + 0.2 * lfo(n, 0.35)
    mod_s = np.array([mod, np.roll(mod, int(0.15*SR))])
    base = base * mod_s
    base = lowpass_filter(base, 1200)
    # add slight high rustle
    high = white_noise(n, stereo=True) * 0.15
    high = highpass_filter(high, 3000)
    base = base + high * mod_s * 0.5
    base = fade(base, 500)
    write_wav(ROOT / "Ambience" / "Wind_Breeze_Medium.wav", base)

    # Strong gust - bursts
    dur = 10.0
    n = int(dur*SR)
    base = pink_noise(n, stereo=True) * 0.4
    # create 4 gusts
    for _ in range(4):
        start = random.randint(0, n - int(2*SR))
        length = random.randint(int(1.5*SR), int(3*SR))
        gust_env = np.hanning(length) * random.uniform(0.8,1.5)
        gust_noise = pink_noise(length, stereo=False) * gust_env
        gust_noise = lowpass_filter(gust_noise, random.randint(900,1800))
        # add to both channels with slight offset
        end = start+length
        if end > n: end = n
        l = end-start
        base[0, start:end] += gust_noise[:l] * 0.9
        base[1, start:end] += np.roll(gust_noise, int(0.05*SR))[:l] * 0.9
    base = np.clip(base, -1, 1)
    base = fade(base, 800)
    write_wav(ROOT / "Ambience" / "Wind_Gust_Strong.wav", base)

    # Howling wind - higher, eerie
    dur = 9.0
    n = int(dur*SR)
    base = pink_noise(n, stereo=True) * 0.5
    # howl = sine with varying freq + noise
    t = np.arange(n)/SR
    howl_freq = 180 + 120 * np.sin(2*np.pi*0.08*t) + 80*np.sin(2*np.pi*0.23*t)
    howl = np.sin(2*np.pi*howl_freq*t) * 0.3
    howl2 = np.sin(2*np.pi*howl_freq*1.5*t) * 0.15
    stereo_howl = np.array([howl+howl2, np.roll(howl, int(0.03*SR))+np.roll(howl2,int(0.02*SR))])
    base = base*0.6 + stereo_howl*0.7
    base = bandpass(base, 200, 2500)
    base = fade(base, 600)
    write_wav(ROOT / "Ambience" / "Wind_Howling.wav", base)

    # Desert wind - dry, sandy, low rumble + high hiss
    dur = 10.0
    n = int(dur*SR)
    low = pink_noise(n, stereo=True)*0.7
    low = lowpass_filter(low, 400)
    high = white_noise(n, stereo=True)*0.25
    high = highpass_filter(high, 5000)
    mod = 0.5 + 0.5*lfo(n, 0.05)
    mod_s = np.array([mod, mod])
    mix = low*mod_s*0.8 + high*0.6
    mix = fade(mix, 700)
    write_wav(ROOT / "Ambience" / "Wind_Desert.wav", mix)

    # Mountain wind - strong, cold, wide stereo
    dur = 10.0
    n = int(dur*SR)
    base = white_noise(n, stereo=True)*0.8
    base = bandpass(base, 150, 3000)
    # deep rumble
    rumble = pink_noise(n, stereo=False)*0.5
    rumble = lowpass_filter(rumble, 120)
    base[0] += rumble*0.8
    base[1] += np.roll(rumble, int(0.08*SR))*0.8
    # fast gusts
    mod = 0.4 + 0.6*np.abs(lfo(n, 0.18)) + 0.2*lfo(n, 0.9)
    base *= np.array([mod, np.roll(mod,int(0.1*SR))])
    base = fade(base, 800)
    write_wav(ROOT / "Ambience" / "Wind_Mountain.wav", base)

    # Clouds - soft atmospheric pad, very light
    dur = 12.0
    n = int(dur*SR)
    # super low filtered noise + subtle sine
    base = pink_noise(n, stereo=True)*0.3
    base = lowpass_filter(base, 300)
    t = np.arange(n)/SR
    pad = np.sin(2*np.pi*55*t)*0.15 + np.sin(2*np.pi*110.5*t)*0.08
    pad_stereo = np.array([pad, np.roll(pad,int(0.5*SR))*0.9])
    mix = base + pad_stereo*0.5
    # very slow mod
    mod = 0.7 + 0.3*lfo(n, 0.03)
    mix *= np.array([mod, mod])
    mix = fade(mix, 1500)
    write_wav(ROOT / "Ambience" / "Clouds_Light.wav", mix)

def gen_foliage():
    # Tree leaves rustle light
    dur = 6.0
    n = int(dur*SR)
    # granular high freq noise bursts
    base = np.zeros((2,n), dtype=np.float32)
    for _ in range(120):
        start = random.randint(0, n- int(0.3*SR))
        length = random.randint(int(0.05*SR), int(0.25*SR))
        grain = white_noise(length, stereo=False)
        grain = highpass_filter(grain, 3000)
        grain = lowpass_filter(grain, 9000)
        env = np.hanning(length) * random.uniform(0.2,0.6)
        grain *= env
        ch = random.choice([0,1])
        base[ch, start:start+length] += grain
        base[1-ch, start:start+length] += grain*0.3
    base = fade(base, 300)
    write_wav(ROOT / "Foliage" / "Tree_Leaves_Rustle_Light.wav", base)

    # Heavy rustle
    dur = 6.0
    n = int(dur*SR)
    base = np.zeros((2,n), dtype=np.float32)
    for _ in range(200):
        start = random.randint(0, n- int(0.4*SR))
        length = random.randint(int(0.08*SR), int(0.35*SR))
        grain = white_noise(length, stereo=False)
        grain = bandpass(grain, 1500, 8000)
        env = np.hanning(length) * random.uniform(0.3,0.9)
        grain *= env
        ch = random.choice([0,1])
        base[ch, start:start+length] += grain
        base[1-ch, start:start+length] += grain*random.uniform(0.2,0.6)
    # add branch creak low
    t = np.arange(n)/SR
    creak = np.sin(2*np.pi*80*t + 5*np.sin(2*np.pi*2*t)) * 0.05 * (np.random.rand(n)>0.995).astype(float)
    # simple: random low thumps
    for _ in range(8):
        pos = random.randint(0, n-int(0.1*SR))
        thump = np.sin(2*np.pi*90*np.arange(int(0.08*SR))/SR) * np.hanning(int(0.08*SR)) * 0.4
        base[0, pos:pos+len(thump)] += thump
        base[1, pos:pos+len(thump)] += thump*0.8
    base = fade(base, 400)
    write_wav(ROOT / "Foliage" / "Tree_Leaves_Rustle_Heavy.wav", base)

    # Branches sway - low creak + rustle
    dur = 8.0
    n = int(dur*SR)
    base = pink_noise(n, stereo=True)*0.2
    base = lowpass_filter(base, 600)
    # creaks
    for _ in range(6):
        start = random.randint(0, n-int(0.5*SR))
        length = int(random.uniform(0.3,0.8)*SR)
        freq = random.uniform(40,120)
        t = np.arange(length)/SR
        creak = np.sin(2*np.pi*freq*t + 10*np.sin(2*np.pi*3*t)) * np.hanning(length) * 0.5
        base[0, start:start+length] += creak*0.7
        base[1, start:start+length] += np.roll(creak,int(0.02*SR))*0.7
    base = fade(base, 500)
    write_wav(ROOT / "Foliage" / "Tree_Branches_Sway.wav", base)

    # Grass shuffle walk
    dur = 4.0
    n = int(dur*SR)
    base = np.zeros((2,n))
    # 6 footsteps in grass
    step_interval = int(SR*0.6)
    for i in range(6):
        start = i*step_interval + random.randint(-int(0.05*SR), int(0.05*SR))
        if start<0 or start+int(0.3*SR)>=n: continue
        length = int(0.25*SR)
        step = white_noise(length, stereo=False)
        step = bandpass(step, 800, 5000)
        env = np.array([0]*int(0.02*SR) + list(np.linspace(0,1,int(0.03*SR))) + [1]*int(0.05*SR) + list(np.linspace(1,0,int(0.15*SR))))
        if len(env)<length:
            env = np.pad(env,(0,length-len(env)))
        else:
            env = env[:length]
        step *= env * random.uniform(0.5,0.9)
        # stereo spread
        base[0, start:start+length] += step*random.uniform(0.6,1.0)
        base[1, start:start+length] += step*random.uniform(0.4,0.8)
    base = fade(base, 200)
    write_wav(ROOT / "Foliage" / "Grass_Shuffle_Walk.wav", base)

    # Grass rustle wind
    dur = 7.0
    n = int(dur*SR)
    base = np.zeros((2,n))
    for _ in range(300):
        start = random.randint(0, n-int(0.15*SR))
        length = random.randint(int(0.03*SR), int(0.12*SR))
        grain = white_noise(length, stereo=False)
        grain = bandpass(grain, 2000, 7000)
        grain *= np.hanning(length) * random.uniform(0.1,0.4)
        ch = random.randint(0,1)
        base[ch, start:start+length] += grain
    # wind bed
    bed = pink_noise(n, stereo=True)*0.15
    bed = highpass_filter(bed, 1000)
    base += bed
    base = fade(base, 400)
    write_wav(ROOT / "Foliage" / "Grass_Rustle_Wind.wav", base)

def gen_terrain():
    # Sand rolling
    dur = 6.0
    n = int(dur*SR)
    base = pink_noise(n, stereo=True)*0.5
    base = bandpass(base, 200, 2000)
    # rolling mod
    mod = 0.6 + 0.4*lfo(n, 0.5) + 0.2*lfo(n, 1.3)
    base *= np.array([mod, np.roll(mod,int(0.07*SR))])
    # granular sand
    for _ in range(80):
        start = random.randint(0, n-int(0.1*SR))
        length = random.randint(int(0.02*SR), int(0.08*SR))
        grain = white_noise(length, stereo=False)*random.uniform(0.2,0.6)
        grain = bandpass(grain, 800, 4000)
        grain *= np.hanning(length)
        base[0, start:start+length] += grain*0.5
        base[1, start:start+length] += grain*0.4
    base = fade(base, 300)
    write_wav(ROOT / "Terrain" / "Sand_Rolling.wav", base)

    # Sand shifting wind
    dur = 8.0
    n = int(dur*SR)
    base = white_noise(n, stereo=True)*0.3
    base = highpass_filter(base, 3000)
    base = lowpass_filter(base, 6000)
    mod = 0.3 + 0.7*np.abs(lfo(n, 0.11))
    base *= np.array([mod, np.roll(mod,int(0.12*SR))])
    # low wind
    low = pink_noise(n, stereo=True)*0.3
    low = lowpass_filter(low, 400)
    mix = base*0.6 + low*0.8
    mix = fade(mix, 500)
    write_wav(ROOT / "Terrain" / "Sand_Shifting_Wind.wav", mix)

    # Gravel roll light
    dur = 5.0
    n = int(dur*SR)
    base = np.zeros((2,n))
    for _ in range(400):
        start = random.randint(0, n-int(0.05*SR))
        length = random.randint(int(0.005*SR), int(0.02*SR))
        click = white_noise(length, stereo=False)
        click = highpass_filter(click, 1500)
        click *= np.hanning(length)*random.uniform(0.2,0.8)
        ch = random.randint(0,1)
        base[ch, start:start+length] += click
    # bed
    bed = pink_noise(n, stereo=True)*0.15
    bed = bandpass(bed, 300, 2500)
    base += bed*0.5
    base = fade(base, 200)
    write_wav(ROOT / "Terrain" / "Gravel_Roll_Light.wav", base)

    # Gravel crunch walk
    dur = 4.0
    n = int(dur*SR)
    base = np.zeros((2,n))
    step_interval = int(SR*0.55)
    for i in range(6):
        start = i*step_interval
        length = int(0.3*SR)
        if start+length>=n: break
        # crunch = many small clicks
        crunch = np.zeros(length)
        for _ in range(30):
            p = random.randint(0, length-int(0.01*SR))
            l = random.randint(int(0.005*SR), int(0.02*SR))
            c = white_noise(l, stereo=False)
            c = highpass_filter(c, 2000)
            c *= np.hanning(l)*random.uniform(0.3,1.0)
            crunch[p:p+l] += c[:min(l,length-p)]
        env = np.hanning(length)*0.8 + 0.2
        crunch *= env
        base[0, start:start+length] += crunch*0.8
        base[1, start:start+length] += crunch*0.6
    base = fade(base, 200)
    write_wav(ROOT / "Terrain" / "Gravel_Crunch_Walk.wav", base)

def gen_vehicle_surfaces():
    # Helper for tire surface loop
    def surface_loop(name, low_freq, high_freq, roughness, rumble_amt):
        dur = 6.0
        n = int(dur*SR)
        # tire hiss
        hiss = white_noise(n, stereo=True)*roughness
        hiss = bandpass(hiss, high_freq[0], high_freq[1])
        # road rumble low
        rumble = pink_noise(n, stereo=True)*rumble_amt
        rumble = lowpass_filter(rumble, low_freq)
        # engine bed low
        t = np.arange(n)/SR
        engine = np.sin(2*np.pi*60*t)*0.05 + np.sin(2*np.pi*120*t)*0.03
        engine_s = np.array([engine, engine*0.9])
        # modulation for speed variation
        mod = 0.8 + 0.2*lfo(n, 0.3) + 0.1*lfo(n, 2.5)
        mix = (hiss*0.7 + rumble*0.9)*np.array([mod, np.roll(mod,int(0.02*SR))]) + engine_s*0.3
        mix = fade(mix, 400)
        write_wav(ROOT / "Vehicle" / "Surfaces" / f"{name}.wav", mix)

    surface_loop("Car_Sand_Drive_Loop", 250, (800, 3500), 0.6, 0.7)
    surface_loop("Car_Gravel_Drive_Loop", 300, (1500, 6000), 0.9, 0.6)
    surface_loop("Car_Tarmac_Drive_Loop", 180, (1000, 4000), 0.35, 0.4)
    surface_loop("Car_Wet_Tarmac_Drive", 200, (2000, 7000), 0.6, 0.35)
    surface_loop("Car_Dirt_Drive_Loop", 280, (600, 3000), 0.65, 0.75)
    surface_loop("Car_Mud_Drive", 220, (400, 2000), 0.5, 0.9)
    surface_loop("Car_Grass_Drive", 200, (800, 3500), 0.45, 0.5)

def gen_tires():
    # Short screech
    dur = 1.2
    n = int(dur*SR)
    t = np.arange(n)/SR
    # high pitched squeal sweep
    freq = 800 + 1200*np.exp(-3*t) + 300*np.sin(2*np.pi*8*t)
    squeal = np.sin(2*np.pi*freq*t) * np.exp(-1.5*t) * 0.7
    # add harmonic
    squeal2 = np.sin(2*np.pi*freq*2.01*t) * np.exp(-2*t) * 0.3
    # noise
    noise = white_noise(n, stereo=False)*0.2
    noise = bandpass(noise, 2000, 6000)
    env = envelope_adsr(n, a=0.02, d=0.2, s=0.4, r=0.6)
    mono = (squeal+squeal2+noise)*env
    stereo = np.array([mono, mono*0.9])
    stereo = fade(stereo, 80)
    write_wav(ROOT / "Vehicle" / "Tires" / "Tire_Screech_Short.wav", stereo)

    # Long screech
    dur = 3.0
    n = int(dur*SR)
    t = np.arange(n)/SR
    freq = 1000 + 800*np.sin(2*np.pi*0.8*t) + 400*np.exp(-0.8*t)
    squeal = np.sin(2*np.pi*freq*t) * 0.6
    squeal2 = np.sin(2*np.pi*freq*1.5*t)*0.25
    # amplitude mod for tire chatter
    mod = 0.6 + 0.4*lfo(n, 12) * 0.5 + 0.2*lfo(n, 25)
    env = envelope_adsr(n, a=0.05, d=0.3, s=0.7, r=0.8)
    mono = (squeal+squeal2)*mod*env
    # add road noise bed
    bed = white_noise(n, stereo=False)*0.1
    bed = bandpass(bed, 800, 3000)
    mono += bed*env
    stereo = np.array([mono, np.roll(mono,int(0.01*SR))])
    stereo = fade(stereo, 100)
    write_wav(ROOT / "Vehicle" / "Tires" / "Tire_Screech_Long.wav", stereo)

    # Drift screech - oscillating
    dur = 4.0
    n = int(dur*SR)
    t = np.arange(n)/SR
    freq = 900 + 500*np.sin(2*np.pi*1.2*t) + 200*np.sin(2*np.pi*3.5*t)
    squeal = np.sin(2*np.pi*freq*t) * 0.65
    squeal2 = np.sin(2*np.pi*freq*2*t)*0.2
    mod = 0.5 + 0.5*lfo(n, 2.0) + 0.2*lfo(n, 8)
    env = envelope_adsr(n, a=0.1, d=0.5, s=0.8, r=0.5)
    mono = (squeal+squeal2)*mod*env
    # engine low during drift
    engine = np.sin(2*np.pi*80*t)*0.1*env
    mono += engine
    stereo = np.array([mono, np.roll(mono,int(0.015*SR))])
    stereo = fade(stereo, 150)
    write_wav(ROOT / "Vehicle" / "Tires" / "Tire_Screech_Drift.wav", stereo)

    # Brake lock
    dur = 1.8
    n = int(dur*SR)
    t = np.arange(n)/SR
    freq = 600 + 400*np.exp(-2*t)
    squeal = np.sin(2*np.pi*freq*t) * np.exp(-1.2*t) * 0.5
    # low thud
    thud = np.sin(2*np.pi*40*t) * np.exp(-8*t) * 0.8
    noise = white_noise(n, stereo=False)*0.3
    noise = lowpass_filter(noise, 1200)
    env = envelope_adsr(n, a=0.01, d=0.3, s=0.2, r=0.6)
    mono = (squeal+thud+noise*0.3)*env
    stereo = np.array([mono, mono*0.85])
    stereo = fade(stereo, 80)
    write_wav(ROOT / "Vehicle" / "Tires" / "Tire_Brake_Lock.wav", stereo)

def gen_impacts():
    # Light hit
    dur = 0.8
    n = int(dur*SR)
    t = np.arange(n)/SR
    thud = np.sin(2*np.pi*120*t) * np.exp(-20*t) * 0.9
    click = white_noise(n, stereo=False)*np.exp(-30*t)*0.5
    click = highpass_filter(click, 1000)
    mono = thud + click*0.6
    mono = fade(mono, 20)
    stereo = np.array([mono, mono*0.8])
    write_wav(ROOT / "Vehicle" / "Impacts" / "Car_Hit_Light.wav", stereo)

    # Medium hit
    dur = 1.2
    n = int(dur*SR)
    t = np.arange(n)/SR
    thud = np.sin(2*np.pi*80*t) * np.exp(-12*t) * 1.0
    thud2 = np.sin(2*np.pi*150*t) * np.exp(-18*t) * 0.6
    metal = white_noise(n, stereo=False)*np.exp(-15*t)*0.7
    metal = bandpass(metal, 800, 4000)
    mono = thud+thud2+metal*0.5
    mono = fade(mono, 30)
    stereo = np.array([mono, np.roll(mono,int(0.005*SR))])
    write_wav(ROOT / "Vehicle" / "Impacts" / "Car_Hit_Medium.wav", stereo)

    # Heavy crash
    dur = 2.5
    n = int(dur*SR)
    t = np.arange(n)/SR
    # big low boom
    boom = np.sin(2*np.pi*50*t) * np.exp(-6*t) * 1.2
    boom2 = np.sin(2*np.pi*90*t) * np.exp(-10*t) * 0.8
    # metal crunch = many resonances
    crunch = np.zeros(n)
    for freq in [200, 350, 600, 1100, 1800, 2500]:
        phase = random.uniform(0,6.28)
        decay = random.uniform(8,18)
        amp = random.uniform(0.2,0.6)
        crunch += np.sin(2*np.pi*freq*t + phase) * np.exp(-decay*t) * amp
    # glass / debris noise
    debris = white_noise(n, stereo=False)*np.exp(-4*t)*0.5
    debris = highpass_filter(debris, 2000)
    # add random clatters
    for _ in range(15):
        pos = random.randint(int(0.1*SR), n-int(0.1*SR))
        l = random.randint(int(0.02*SR), int(0.12*SR))
        cl = white_noise(l, stereo=False)*random.uniform(0.3,0.8)
        cl = bandpass(cl, 1000, 6000)
        cl *= np.hanning(l)
        crunch[pos:pos+l] += cl[:min(l,n-pos)]*0.5
    mono = boom+boom2+crunch*0.8+debris*0.4
    mono = np.clip(mono, -1,1)
    mono = fade(mono, 50)
    stereo = np.array([mono, np.roll(mono,int(0.008*SR))])
    write_wav(ROOT / "Vehicle" / "Impacts" / "Car_Crash_Heavy.wav", stereo)

    # Metal crunch
    dur = 1.5
    n = int(dur*SR)
    t = np.arange(n)/SR
    crunch = np.zeros(n)
    for freq in [300, 550, 900, 1600, 2400]:
        crunch += np.sin(2*np.pi*freq*t + random.uniform(0,6.28)) * np.exp(-random.uniform(6,14)*t) * random.uniform(0.3,0.7)
    noise = white_noise(n, stereo=False)*np.exp(-8*t)*0.6
    noise = bandpass(noise, 500, 5000)
    mono = crunch*0.8 + noise*0.5
    mono = fade(mono, 30)
    stereo = np.array([mono, mono*0.9])
    write_wav(ROOT / "Vehicle" / "Impacts" / "Car_Metal_Crunch.wav", stereo)

    # Bumper thud
    dur = 0.6
    n = int(dur*SR)
    t = np.arange(n)/SR
    thud = np.sin(2*np.pi*100*t) * np.exp(-25*t) * 1.0
    thud2 = np.sin(2*np.pi*180*t) * np.exp(-30*t) * 0.5
    mono = thud+thud2
    mono = fade(mono, 20)
    stereo = np.array([mono, mono*0.85])
    write_wav(ROOT / "Vehicle" / "Impacts" / "Car_Bumper_Thud.wav", stereo)

def gen_engine():
    def engine_loop(name, base_freq, rev, dur=4.0):
        n = int(dur*SR)
        t = np.arange(n)/SR
        # fundamental + harmonics with rev
        freq = base_freq * rev
        # engine = sum of harmonics with slight detune and roughness
        engine = np.zeros(n)
        for h in [1,2,3,4,5,6]:
            amp = 1.0 / (h**0.8) * random.uniform(0.7,1.0)
            detune = random.uniform(0.99,1.01)
            engine += np.sin(2*np.pi*freq*h*detune*t) * amp
        # add roughness (random amplitude mod)
        rough = 0.8 + 0.2*lfo(n, 15) + 0.1*lfo(n, 45)
        engine *= rough*0.3
        # exhaust low
        exhaust = np.sin(2*np.pi*freq*0.5*t)*0.2 + pink_noise(n, stereo=False)*0.05
        exhaust = lowpass_filter(exhaust, 300)
        mono = engine*0.6 + exhaust*0.5
        # make loopable via crossfade
        fade_len = int(0.2*SR)
        mono[:fade_len] *= np.linspace(0,1,fade_len)
        mono[-fade_len:] *= np.linspace(1,0,fade_len)
        # crossfade overlap for seamless loop
        mono[:fade_len] += mono[-fade_len:]*0.5
        mono = fade(mono, 50)
        stereo = np.array([mono*0.9, mono*1.0])
        write_wav(ROOT / "Vehicle" / "Engine" / f"{name}.wav", stereo)

    engine_loop("Engine_Idle_Loop", 35, 1.0, dur=4.0)
    engine_loop("Engine_Rev_Low", 55, 1.2, dur=3.0)
    engine_loop("Engine_Rev_High", 85, 1.8, dur=3.0)

    # Turbo spool
    dur = 2.5
    n = int(dur*SR)
    t = np.arange(n)/SR
    # rising whistle
    freq = 800 + 2000*(1-np.exp(-2*t)) + 500*np.sin(2*np.pi*10*t)
    whistle = np.sin(2*np.pi*freq*t) * np.linspace(0,0.6,n) * 0.5
    whistle2 = np.sin(2*np.pi*freq*1.5*t) * np.linspace(0,0.3,n) * 0.3
    air = white_noise(n, stereo=False)*np.linspace(0,0.4,n)
    air = bandpass(air, 3000, 8000)
    mono = whistle+whistle2+air*0.5
    mono = fade(mono, 80)
    stereo = np.array([mono, np.roll(mono,int(0.003*SR))])
    write_wav(ROOT / "Vehicle" / "Engine" / "Engine_Turbo_Spool.wav", stereo)

def gen_ui():
    # simple UI blips using sine
    def blip(name, freq, dur, type='sine'):
        n = int(dur*SR)
        t = np.arange(n)/SR
        if type=='sine':
            tone = np.sin(2*np.pi*freq*t) * np.exp(-8*t) * 0.6
        else:
            tone = np.sin(2*np.pi*freq*t) * np.hanning(n) * 0.5
        tone = fade(tone, 10)
        write_wav(ROOT / "UI" / f"{name}.wav", tone)

    blip("UI_Hover", 800, 0.15)
    blip("UI_Click", 1200, 0.12)

if __name__ == "__main__":
    print(f"Generating to {ROOT}")
    ensure_dir(ROOT)
    gen_wind_variants()
    gen_foliage()
    gen_terrain()
    gen_vehicle_surfaces()
    gen_tires()
    gen_impacts()
    gen_engine()
    gen_ui()
    print("Done! All audio generated.")
