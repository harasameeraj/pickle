# Generates the promo narration with Kokoro (local neural TTS). See AGENTS.md > Promo video.
# Usage: python gen_voice.py <models_dir> <out_dir> [voice]
import json, sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
from kokoro_onnx.config import EspeakConfig
import espeakng_loader
M = sys.argv[1]; OUT = sys.argv[2]; VOICE = sys.argv[3] if len(sys.argv) > 3 else 'af_heart'
k = Kokoro(f"{M}/kokoro-v1.0.onnx", f"{M}/voices-v1.0.bin", espeak_config=EspeakConfig(lib_path="/opt/homebrew/lib/libespeak-ng.dylib", data_path="/opt/homebrew/share/espeak-ng-data"))
# id, spoken text, caption text, slot length (s) the line must fit in
lines = [
 ("v1",  "You lost that point.", "You lost that point.", 1.4),
 ("v2",  "But do you actually know why?", "But do you actually know why?", 2.1),
 ("v3",  "Meet Kitchen IQ. An AI coach that watches every shot you play.", "Meet KitchenIQ. An AI coach that watches every shot you play.", 3.85),
 ("v4",  "Just film your game. It tracks every player, every rally, and keeps the score for you.", "Just film your game. It tracks every player, every rally, and keeps the score for you.", 5.0),
 ("v5a", "Then it grades every single shot.", "Then it grades every single shot.", 1.9),
 ("v5b", "From brilliant... to blunder.", "From brilliant... to blunder.", 1.9),
 ("v6",  "See the exact moment the match turned.", "See the exact moment the match turned.", 2.4),
 ("v7",  "Replay any rally in 3D, and see the shot you should have hit.", "Replay any rally in 3D, and see the shot you should have hit.", 3.8),
 ("v8",  "Then your coach tells you the one thing to fix.", "Then your coach tells you the one thing to fix.", 2.65),
 ("v9a", "Stop guessing.", "Stop guessing.", 0.95),
 ("v9b", "Start winning.", "Start winning.", 1.15),
 ("v10", "Kitchen IQ. Coming soon.", "KitchenIQ. Coming soon.", 3.0),
]
meta = {}
for id_, spoken, caption, slot in lines:
    speed = 1.0
    for _ in range(6):
        audio, sr = k.create(spoken, voice=VOICE, speed=speed, lang="en-us")
        # trim leading/trailing silence
        a = np.abs(audio); thr = a.max() * 0.02
        idx = np.where(a > thr)[0]
        audio = audio[max(0, idx[0] - int(0.02*sr)): idx[-1] + int(0.08*sr)]
        dur = len(audio) / sr
        if dur <= slot: break
        speed = round(speed * min(1.2, dur / slot) + 0.01, 3)
    # word-onset estimate: gaps of >120ms of near-silence
    env = np.convolve(np.abs(audio), np.ones(int(0.01*sr))/int(0.01*sr), mode='same')
    quiet = env < env.max()*0.04
    gaps, start = [], None
    for i, q in enumerate(quiet):
        if q and start is None: start = i
        if not q and start is not None:
            if (i - start) / sr > 0.12: gaps.append(round(i / sr, 3))
            start = None
    sf.write(f"{OUT}/{id_}.wav", audio, sr, subtype='PCM_16')
    meta[id_] = {"text": caption, "dur": round(dur, 3), "speed": speed, "onsets_after_pauses": gaps}
    print(id_, round(dur,2), "slot", slot, "speed", speed, gaps)
json.dump(meta, open(f"{OUT}/lines.json", "w"), indent=1)
