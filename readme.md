# 🎤 OpenAI TTS Pitch Controller

A very simple controller using **OpenAI Text-to-Speech**, **Tone.js**, and **SoundTouch** to manipulate pitch

This project lets you enter text, convert it into audio using the OpenAI TTS API, and then modify the sound using different processing engines (**Tone.js** or **SoundTouch**).  
It also includes the ability to **record and download the final audio as an MP3 using lame.js**.

---

## 🚀 Features

### 🔊 TTS Conversion

- Uses the **OpenAI TTS endpoint** to generate a base audio file.
- Multiple male and female voices available.

### 🎚️ Two Processing Engines

#### **Tone.js**

Allows adjustments for:

- Pitch (semitones)
- Window size
- Delay time
- Volume

#### **SoundTouch**

Allows adjustments for:

- Pitch (factor)
- Pitch (semitones)
- Rate
- Tempo

### 🎛️ Additional Controls

- Optional “Instructions” field for customizing voice style, personality, or tone.
- Buttons to play, stop, record, and download audio.
- MP3 generation powered by **lame.js**.

---

## 🛠️ Requirements

- A modern browser supporting:
  - Web Audio API
  - AudioContext
  - AudioWorklet
- A valid **OpenAI API Key**.

---

## 🧪 How to Use

1. Open the application in your browser.
2. Paste your **OpenAI API Key** into the input field.
3. Enter the text you want to convert to speech.
4. Select a voice and click **Convert TTS**.
   - ⚠️ If you change the voice, you must generate the TTS again before playing.
5. Adjust the parameters of the selected sound engine (Tone.js or SoundTouch).
6. Click **Play** to listen.
7. To save the result, use **Record & Download MP3**.

---

## 🤝 Contributing

Contributions are welcome!  
Feel free to open an issue or submit a PR if you want to add features, improvements, or new sound engines.

---

## 📜 License

This project is released under the **MIT License**.  
You are free to use, modify, and distribute it.
