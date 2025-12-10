import React, { useState, useEffect, useRef, useMemo } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";
import {
  Disc,
  Music,
  User as UserIcon,
  LogOut,
  Clock,
  Footprints,
  Play,
  Users,
  Zap,
  Speaker,
  Radio,
} from "lucide-react";

// 書き換え例
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "...",
  // ... その他の設定
};
const appId = "my-dj-app"; // 適当な名前でOK

// --- Firebase Configuration & Initialization ---
////const firebaseConfig = JSON.parse(__firebase_config);
////const app = initializeApp(firebaseConfig);
////const auth = getAuth(app);
////const db = getFirestore(app);
////const appId = typeof __app_id !== "undefined" ? __app_id : "default-app-id";

// --- Audio Engine (Web Audio API) ---
class DJAudioEngine {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.mode = "party"; // 'party' or 'sad'
    this.nextNoteTime = 0;
    this.timerID = null;
    this.beatCount = 0;
    this.measureCount = 0;

    // Style management
    this.styles = ["hiphop", "rock", "techno"];
    this.currentStyleIndex = 0;
    // Changed from 8 to 128 measures to loop each style for approx 5 minutes
    // BPM 90 (HipHop) -> ~5.6 mins
    // BPM 140 (Rock) -> ~3.6 mins
    // BPM 128 (Techno) -> ~4.0 mins
    this.styleDurationMeasures = 128;

    // Frequencies for Key of F (Hotaru no Hikari)
    this.notes = {
      C3: 130.81,
      D3: 146.83,
      E3: 164.81,
      F3: 174.61,
      G3: 196.0,
      A3: 220.0,
      Bb3: 233.08,
      C4: 261.63,
      D4: 293.66,
      E4: 329.63,
      F4: 349.23,
      G4: 392.0,
      A4: 440.0,
      Bb4: 466.16,
      C5: 523.25,
      D5: 587.33,
      E5: 659.25,
      F5: 698.46,
    };

    // Melody Sequence (Note, Duration in beats)
    this.melody = [
      { n: "C4", d: 1 }, // Pickup
      { n: "F4", d: 1.5 },
      { n: "E4", d: 0.5 },
      { n: "F4", d: 1 },
      { n: "A4", d: 1 },
      { n: "G4", d: 1.5 },
      { n: "F4", d: 0.5 },
      { n: "G4", d: 1 },
      { n: "A4", d: 1 },
      { n: "F4", d: 1.5 },
      { n: "E4", d: 0.5 },
      { n: "F4", d: 1 },
      { n: "A4", d: 1 },
      { n: "D5", d: 3 },
      { n: "rest", d: 1 },
      // Part 2
      { n: "D5", d: 1 },
      { n: "C5", d: 1.5 },
      { n: "A4", d: 0.5 },
      { n: "A4", d: 1 },
      { n: "F4", d: 1 },
      { n: "G4", d: 1.5 },
      { n: "F4", d: 0.5 },
      { n: "G4", d: 1 },
      { n: "A4", d: 1 },
      { n: "F4", d: 1.5 },
      { n: "A4", d: 0.5 },
      { n: "G4", d: 1 },
      { n: "E4", d: 1 },
      { n: "F4", d: 3 },
      { n: "rest", d: 1 },
    ];
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  get currentStyle() {
    return this.styles[this.currentStyleIndex];
  }

  get currentBPM() {
    if (this.mode === "sad") return 60;
    switch (this.currentStyle) {
      case "hiphop":
        return 90;
      case "rock":
        return 140;
      case "techno":
        return 128;
      default:
        return 100;
    }
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === "sad") {
      this.beatCount = 0;
    }
  }

  start() {
    this.init();
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.beatCount = 0;
    this.measureCount = 0;
    this.currentStyleIndex = 0;
    this.scheduler();
  }

  stop() {
    this.isPlaying = false;
    if (this.timerID) clearTimeout(this.timerID);
    // Stop all nodes logic could go here, but rely on GC for simple synth
  }

  scheduler() {
    if (!this.isPlaying) return;

    while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
      this.scheduleNote(this.nextNoteTime);
      this.advanceNote();
    }

    this.timerID = setTimeout(() => this.scheduler(), 25);
  }

  advanceNote() {
    const secondsPerBeat = 60.0 / this.currentBPM;
    this.nextNoteTime += secondsPerBeat * 0.25; // 16th notes
    this.beatCount++;

    // Update measure count (assuming 4/4 time, 16 steps per measure)
    if (this.beatCount % 16 === 0) {
      this.measureCount++;
      // Switch style periodically in party mode
      if (
        this.mode === "party" &&
        this.measureCount % this.styleDurationMeasures === 0
      ) {
        this.currentStyleIndex =
          (this.currentStyleIndex + 1) % this.styles.length;
      }
    }
  }

  scheduleNote(time) {
    const beatIndex = this.beatCount;
    const step = beatIndex % 16; // 0-15

    if (this.mode === "party") {
      // --- PARTY MODES ---
      const style = this.currentStyle;

      if (style === "hiphop") {
        // --- Hip Hop: Swing feel, Boom Bap ---
        if (step === 0 || step === 10) this.playKick(time, "heavy");
        if (step === 4 || step === 12) this.playSnare(time, "snap");
        if (step % 2 === 0) this.playHiHat(time, "closed");

        // Melody: Square wave, Gameboy ish
        this.playMelodyStep(time, beatIndex, "square", 0.1, 0.1);

        // Bass
        if (step === 0) this.playBass(time, "F2", 0.5);
        if (step === 10) this.playBass(time, "C2", 0.5);
      } else if (style === "rock") {
        // --- Rock: Driving 8th notes, Distortion ---
        if (step === 0 || step === 8) this.playKick(time, "punchy");
        if (step === 4 || step === 12) this.playSnare(time, "acoustic");
        if (step % 2 === 0) this.playHiHat(time, "open");

        // Melody: Sawtooth (Distortion Guitar ish)
        this.playMelodyStep(time, beatIndex, "sawtooth", 0.08, 0.3);

        // Power Chord pulsing (Root + 5th) on 8th notes
        if (step % 2 === 0) {
          this.playPowerChord(time, "F3");
        }
      } else if (style === "techno") {
        // --- Techno: 4-on-the-floor, Trance ---
        if (step % 4 === 0) this.playKick(time, "techno"); // 4 on floor
        if (step === 4 || step === 12) this.playSnare(time, "clap");
        if (step % 2 !== 0) this.playHiHat(time, "open"); // Off-beat hat

        // Melody: Super Saw / Trance lead (Detuned saws)
        this.playMelodyStep(time, beatIndex, "sawtooth", 0.1, 0.1, true); // true for detune

        // Arp bass
        if (step % 2 === 0)
          this.playBass(time, step % 4 === 0 ? "F2" : "F3", 0.1, "sawtooth");
      }
    } else {
      // --- SAD MODE (Slow Hotaru) ---
      if (beatIndex % 16 === 0) this.playPad(time);
      this.playMelodyStep(time, beatIndex, "triangle", 0.2, 0.5);
    }
  }

  // --- Synth Methods ---

  playMelodyStep(
    time,
    sixteenthNoteCounter,
    type,
    gainVal,
    release,
    detune = false
  ) {
    let currentBeat = sixteenthNoteCounter / 4;
    const totalDuration = this.melody.reduce((acc, n) => acc + n.d, 0);
    const loopTime = currentBeat % totalDuration;

    let accumulated = 0;
    const note = this.melody.find((n) => {
      if (Math.abs(accumulated - loopTime) < 0.01) return true;
      accumulated += n.d;
      return false;
    });

    if (note && note.n !== "rest") {
      const freq = this.notes[note.n];
      if (freq) {
        this.spawnOsc(
          time,
          freq,
          type,
          gainVal,
          note.d * (60 / this.currentBPM) - 0.05,
          detune
        );
      }
    }
  }

  spawnOsc(time, freq, type, vol, duration, detune = false) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);

    if (detune) {
      // Create a second oscillator for chorus/detune effect
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = type;
      osc2.frequency.setValueAtTime(freq * 1.01, time); // Slightly sharp
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      gain2.gain.setValueAtTime(0, time);
      gain2.gain.linearRampToValueAtTime(vol * 0.5, time + 0.05);
      gain2.gain.exponentialRampToValueAtTime(0.001, time + duration);
      osc2.start(time);
      osc2.stop(time + duration + 0.1);
    }

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.start(time);
    osc.stop(time + duration + 0.1);
  }

  playKick(time, style) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    if (style === "techno") {
      osc.frequency.setValueAtTime(200, time);
      osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.3);
      gain.gain.setValueAtTime(1.0, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
    } else if (style === "punchy") {
      osc.frequency.setValueAtTime(180, time);
      osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.4);
      gain.gain.setValueAtTime(0.9, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);
    } else {
      // heavy
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
      gain.gain.setValueAtTime(0.8, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
    }

    osc.start(time);
    osc.stop(time + 0.5);
  }

  playSnare(time, style) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    if (style === "clap") {
      // Noise buffer for clap
      const bufferSize = this.ctx.sampleRate * 0.5;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1500;

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      gain.gain.setValueAtTime(0.5, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

      noise.start(time);
      noise.stop(time + 0.15);
    } else {
      osc.type = "triangle";
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.frequency.setValueAtTime(200, time);

      if (style === "acoustic") {
        // More noise mixed in ideally, but simple implementation
        gain.gain.setValueAtTime(0.6, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
      } else {
        gain.gain.setValueAtTime(0.4, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
      }

      osc.start(time);
      osc.stop(time + 0.2);
    }
  }

  playHiHat(time, style) {
    const gain = this.ctx.createGain();
    const ratio = style === "open" ? 0.3 : 0.05;

    // Create noise
    const bufferSize = this.ctx.sampleRate * 0.5;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 8000;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    gain.gain.setValueAtTime(0.2, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + ratio);

    noise.start(time);
    noise.stop(time + ratio);
  }

  playBass(time, note, duration, type = "sine") {
    const freq = this.notes[note] || 100;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.start(time);
    osc.stop(time + duration);
  }

  playPowerChord(time, rootNote) {
    // Play Root + 5th
    const rootFreq = this.notes[rootNote];
    const fifthFreq = rootFreq * 1.5;

    [rootFreq, fifthFreq].forEach((f) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(f, time);
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      // Chug sound
      gain.gain.setValueAtTime(0.1, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

      osc.start(time);
      osc.stop(time + 0.25);
    });
  }

  playPad(time) {
    const freqs = [174.61, 261.63, 349.23];
    freqs.forEach((f) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, time);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.1, time + 1);
      gain.gain.linearRampToValueAtTime(0, time + 4);
      osc.start(time);
      osc.stop(time + 4.5);
    });
  }
}

const audioEngine = new DJAudioEngine();

// --- Components ---

export default function LastTrainDJ() {
  const [user, setUser] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [inRoom, setInRoom] = useState(false);
  const [members, setMembers] = useState([]);
  const [myProfile, setMyProfile] = useState({
    name: "",
    trainTime: "23:30",
    walkSpeed: "normal",
  });
  const [isDjPlaying, setIsDjPlaying] = useState(false);
  const [leavingUser, setLeavingUser] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentStyle, setCurrentStyle] = useState("hiphop");

  // --- Auth & Init ---
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- Time Loop & Style Checker ---
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      // Sync UI style display with Audio Engine
      if (audioEngine.isPlaying && audioEngine.mode === "party") {
        if (currentStyle !== audioEngine.currentStyle) {
          setCurrentStyle(audioEngine.currentStyle);
        }
      }
    }, 500); // Check every 500ms
    return () => clearInterval(timer);
  }, [currentStyle]);

  // --- Room Listener ---
  useEffect(() => {
    if (!user || !roomId || !inRoom) return;

    const usersRef = collection(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      `dj_room_${roomId}_users`
    );
    const unsubscribeUsers = onSnapshot(
      usersRef,
      (snapshot) => {
        const usersData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setMembers(usersData);
      },
      (err) => console.error("Error fetching users:", err)
    );

    const roomRef = doc(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      `dj_room_${roomId}_control`,
      "status"
    );
    const unsubscribeRoom = onSnapshot(
      roomRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          // Here we could sync Play state if we wanted stricter control
        }
      },
      (err) => console.error("Error fetching room:", err)
    );

    return () => {
      unsubscribeUsers();
      unsubscribeRoom();
    };
  }, [user, roomId, inRoom]);

  // --- Logic: Check for Leave Time ---
  useEffect(() => {
    if (!isDjPlaying) {
      if (leavingUser) setLeavingUser(null);
      audioEngine.stop();
      return;
    }

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const dangerUser = members.find((m) => {
      if (m.hasLeft) return false;
      const [h, min] = m.trainTime.split(":").map(Number);
      const trainMinutes = h * 60 + min;
      let buffer = 15;
      if (m.walkSpeed === "slow") buffer = 25;
      if (m.walkSpeed === "fast") buffer = 10;
      const leaveTimeMinutes = trainMinutes - buffer;

      let adjustedTrain = trainMinutes;
      let adjustedNow = currentMinutes;
      if (adjustedTrain < 4 * 60 && adjustedNow > 18 * 60) {
        adjustedTrain += 24 * 60;
      }
      return adjustedNow >= adjustedTrain - buffer;
    });

    if (dangerUser) {
      setLeavingUser(dangerUser);
      audioEngine.setMode("sad");
    } else {
      setLeavingUser(null);
      audioEngine.setMode("party");
    }

    if (!audioEngine.isPlaying) {
      audioEngine.start();
    }
  }, [members, currentTime, isDjPlaying]);

  // --- Actions ---

  const joinRoom = async () => {
    if (!roomId) return;
    setInRoom(true);
    const userRef = doc(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      `dj_room_${roomId}_users`,
      user.uid
    );
    await setDoc(userRef, {
      ...myProfile,
      hasLeft: false,
      joinedAt: serverTimestamp(),
    });
  };

  const toggleDj = async () => {
    const newStatus = !isDjPlaying;
    setIsDjPlaying(newStatus);
    const roomRef = doc(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      `dj_room_${roomId}_control`,
      "status"
    );
    await setDoc(roomRef, { isPlaying: newStatus }, { merge: true });

    if (newStatus) {
      audioEngine.start();
    } else {
      audioEngine.stop();
    }
  };

  const handleUserExit = async () => {
    if (!leavingUser) return;
    const userRef = doc(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      `dj_room_${roomId}_users`,
      leavingUser.id
    );
    await updateDoc(userRef, { hasLeft: true });
  };

  const getLeaveTime = (timeStr, speed) => {
    let buffer = 15;
    if (speed === "slow") buffer = 25;
    if (speed === "fast") buffer = 10;
    const [h, m] = timeStr.split(":").map(Number);
    const date = new Date();
    date.setHours(h);
    date.setMinutes(m - buffer);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // --- Views ---

  if (!inRoom) {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-6 flex flex-col items-center justify-center font-sans">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="bg-gradient-to-r from-purple-500 to-pink-500 w-20 h-20 rounded-full mx-auto flex items-center justify-center mb-4 animate-pulse">
              <Disc size={40} className="text-white animate-spin-slow" />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight">終電 DJ</h1>
            <p className="mt-2 text-slate-400">
              音楽が終電を教えてくれる。
              <br />
              もう「帰ります」と言わなくていい。
            </p>
          </div>

          <div className="bg-slate-800 p-6 rounded-2xl shadow-xl space-y-4 border border-slate-700">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                ルームID (Room ID)
              </label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="例: nomikai123"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-purple-500 outline-none"
              />
            </div>

            <div className="border-t border-slate-700 pt-4">
              <h3 className="text-lg font-bold mb-3 flex items-center">
                <UserIcon size={18} className="mr-2" /> プロフィール設定
              </h3>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="名前 (Name)"
                  value={myProfile.name}
                  onChange={(e) =>
                    setMyProfile({ ...myProfile, name: e.target.value })
                  }
                  className="w-full bg-slate-700 border-slate-600 rounded-lg p-3 text-white"
                />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-slate-400">終電時間</label>
                    <input
                      type="time"
                      value={myProfile.trainTime}
                      onChange={(e) =>
                        setMyProfile({
                          ...myProfile,
                          trainTime: e.target.value,
                        })
                      }
                      className="w-full bg-slate-700 border-slate-600 rounded-lg p-3 text-white"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-slate-400">歩く速さ</label>
                    <select
                      value={myProfile.walkSpeed}
                      onChange={(e) =>
                        setMyProfile({
                          ...myProfile,
                          walkSpeed: e.target.value,
                        })
                      }
                      className="w-full bg-slate-700 border-slate-600 rounded-lg p-3 text-white h-[50px]"
                    >
                      <option value="slow">ゆっくり (25分前)</option>
                      <option value="normal">普通 (15分前)</option>
                      <option value="fast">早歩き (10分前)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={joinRoom}
              disabled={!roomId || !myProfile.name}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold py-4 rounded-xl transition-all shadow-lg transform active:scale-95"
            >
              DJブースに入る
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isCritical = !!leavingUser;

  // Style config for visual
  const styleConfig = {
    hiphop: {
      label: "HIP-HOP",
      color: "from-purple-500 to-pink-500",
      icon: Speaker,
    },
    rock: { label: "ROCK", color: "from-red-500 to-orange-500", icon: Zap },
    techno: {
      label: "TECHNO",
      color: "from-blue-500 to-cyan-500",
      icon: Radio,
    },
  };

  const currentVisual = isCritical
    ? { label: "WARNING", color: "from-red-700 to-red-900" }
    : styleConfig[currentStyle] || styleConfig["hiphop"];

  return (
    <div
      className={`min-h-screen transition-colors duration-1000 ease-in-out flex flex-col ${
        isCritical ? "bg-red-950" : "bg-slate-900"
      }`}
    >
      {/* Header */}
      <header className="p-4 flex justify-between items-center bg-black/20 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center text-white">
          <Disc className={`mr-2 ${isDjPlaying ? "animate-spin" : ""}`} />
          <span className="font-bold">Room: {roomId}</span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono text-white font-bold leading-none">
            {currentTime.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </header>

      {/* Main Stage */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Background Visuals */}
        <div className="absolute inset-0 pointer-events-none opacity-20">
          <div
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full filter blur-3xl transition-colors duration-700 bg-gradient-to-r ${currentVisual.color} animate-pulse`}
          ></div>
        </div>

        {/* Turntable UI */}
        <div className="relative z-0 mb-8">
          <div
            className={`w-64 h-64 rounded-full border-8 shadow-[0_0_50px_rgba(0,0,0,0.5)] flex items-center justify-center transition-all duration-500 
            ${
              isCritical
                ? "border-red-500 shadow-red-900/50"
                : "border-slate-600 shadow-purple-900/50"
            }
            ${isDjPlaying ? "animate-[spin_4s_linear_infinite]" : ""}
          `}
          >
            <div className="w-56 h-56 rounded-full bg-slate-800 flex items-center justify-center relative overflow-hidden">
              {/* Vinyl grooves */}
              <div className="absolute inset-0 border-4 border-slate-700 rounded-full opacity-50"></div>
              <div className="absolute inset-4 border-4 border-slate-700 rounded-full opacity-50"></div>
              <div className="absolute inset-8 border-4 border-slate-700 rounded-full opacity-50"></div>

              {/* Label */}
              <div
                className={`w-20 h-20 rounded-full flex items-center justify-center text-center text-xs font-bold text-white transition-all duration-500 bg-gradient-to-tr ${currentVisual.color}`}
              >
                <span className="whitespace-pre-line">
                  {isCritical
                    ? "HOTARU\n(SAD)"
                    : `HOTARU\n(${currentVisual.label})`}
                </span>
              </div>
            </div>
          </div>

          {/* Tone Arm */}
          <div
            className={`absolute top-0 right-0 w-4 h-32 bg-slate-400 origin-top transition-transform duration-700 ease-out -z-10 rounded-full shadow-lg
             ${isDjPlaying ? "rotate-[30deg]" : "rotate-[-10deg]"}
          `}
          ></div>
        </div>

        {/* Status Text */}
        <div className="text-center z-10 mb-8 h-24">
          {!isDjPlaying ? (
            <button
              onClick={toggleDj}
              className="bg-green-500 hover:bg-green-600 text-white text-xl font-bold px-8 py-3 rounded-full shadow-lg flex items-center mx-auto transition-transform active:scale-95"
            >
              <Play className="mr-2" fill="currentColor" />{" "}
              終電ターンテーブル開始
            </button>
          ) : isCritical ? (
            <div className="animate-bounce">
              <h2 className="text-4xl md:text-6xl font-black text-red-500 tracking-tighter drop-shadow-lg">
                LAST TRAIN
              </h2>
              <p className="text-white text-xl mt-2 font-bold">
                誰かが帰る時間です！
              </p>
            </div>
          ) : (
            <div className="animate-pulse">
              <h2
                className={`text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r ${currentVisual.color} tracking-tighter`}
              >
                {currentVisual.label} MODE
              </h2>
              <p className="text-slate-300 mt-2">
                Remixing Hotaru no Hikari...
              </p>
            </div>
          )}
        </div>

        {/* Leaving User Alert Overlay */}
        {isCritical && leavingUser && (
          <div className="w-full max-w-md bg-red-900/90 border-2 border-red-500 rounded-xl p-6 text-center text-white shadow-2xl animate-in fade-in zoom-in duration-300">
            <Zap className="w-12 h-12 mx-auto mb-2 text-yellow-400 animate-pulse" />
            <p className="text-lg opacity-80">Final call for</p>
            <h3 className="text-3xl font-bold mb-2">{leavingUser.name}</h3>
            <p className="text-sm mb-6">
              終電: {leavingUser.trainTime} (出発:{" "}
              {getLeaveTime(leavingUser.trainTime, leavingUser.walkSpeed)})
            </p>

            <button
              onClick={handleUserExit}
              className="w-full bg-white text-red-900 font-bold text-xl py-4 rounded-lg shadow-lg hover:bg-gray-100 flex items-center justify-center transition-transform active:scale-95"
            >
              <LogOut className="mr-2" /> 途中退場する (Exit)
            </button>
            <p className="text-xs mt-2 opacity-60">
              ※ボタンを押すと悲しい音楽が止まります
            </p>
          </div>
        )}
      </main>

      {/* Footer / Member List */}
      <footer className="bg-slate-800/80 backdrop-blur-md p-4 border-t border-slate-700 max-h-60 overflow-y-auto">
        <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3 flex items-center">
          <Users size={12} className="mr-1" /> メンバー (
          {members.filter((m) => !m.hasLeft).length} 人)
        </h3>
        <div className="space-y-2">
          {members
            .sort((a, b) => a.trainTime.localeCompare(b.trainTime))
            .map((member) => (
              <div
                key={member.id}
                className={`flex items-center justify-between p-3 rounded-lg border transition-all
                ${
                  member.hasLeft
                    ? "bg-slate-900/50 border-slate-800 opacity-40 grayscale"
                    : member.id === leavingUser?.id
                    ? "bg-red-900/30 border-red-500"
                    : "bg-slate-700/50 border-slate-600"
                }
              `}
              >
                <div className="flex items-center">
                  <div
                    className={`w-2 h-2 rounded-full mr-3 ${
                      member.hasLeft ? "bg-slate-600" : "bg-green-400"
                    }`}
                  ></div>
                  <div>
                    <p className="font-bold text-white text-sm">
                      {member.name}
                    </p>
                    <div className="flex items-center text-xs text-slate-400">
                      <Clock size={10} className="mr-1" /> 終電:{" "}
                      {member.trainTime}
                      <span className="mx-2">•</span>
                      <Footprints size={10} className="mr-1" />{" "}
                      {member.walkSpeed === "slow"
                        ? "ゆっくり"
                        : member.walkSpeed === "fast"
                        ? "早歩き"
                        : "普通"}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  {member.hasLeft ? (
                    <span className="text-xs font-bold text-slate-500">
                      退場済
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-purple-300 bg-purple-900/30 px-2 py-1 rounded">
                      Dep: {getLeaveTime(member.trainTime, member.walkSpeed)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          {members.length === 0 && (
            <p className="text-slate-500 text-center text-sm py-4">
              参加者待ち...
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
