# Benchmark audio licenses

These clips are excerpts of public speech used only by the STT benchmark.
They contain no user recordings.

| File | Source | License | Attribution |
| --- | --- | --- | --- |
| `jfk-en.wav` | [whisper.cpp `samples/jfk.wav`](https://github.com/ggerganov/whisper.cpp/blob/master/samples/jfk.wav), excerpt of John F. Kennedy's 1961 inaugural address | Public domain (U.S. government work) | John F. Kennedy, 1961 |
| `sample-fr.wav` | [French Spoken Wikipedia – Dengue – La dengue](https://commons.wikimedia.org/wiki/File:French_Spoken_Wikipedia-_Dengue-_La_dengue.ogg) | CC BY-SA 3.0 | Siddhi sathe, Wikimedia Commons |
| `sample-de.wav` | [De-Bleistift-article](https://commons.wikimedia.org/wiki/File:De-Bleistift-article.ogg) | CC BY-SA 4.0 | Inwe Oronar, Wikimedia Commons |

The French and German clips are the first 30 seconds of the source files,
converted to 16 kHz mono 16-bit PCM WAV. `jfk-en.wav` is the 11-second
speech sample converted to the same format.

The clips are only benchmark inputs; the application never ships them.
