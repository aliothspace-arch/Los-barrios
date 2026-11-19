import type { WeatherType } from './types';

export class ProceduralAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;

  private skidGain: GainNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;

  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;

  private muted = false;
  private initialized = false;
  private sirenPhase = 0;

  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.42;
      master.connect(ctx.destination);
      this.masterGain = master;

      // V8 Engine dual-oscillator rumble synth
      const engFilter = ctx.createBiquadFilter();
      engFilter.type = 'lowpass';
      engFilter.frequency.value = 180;
      engFilter.Q.value = 3.2;

      const engGain = ctx.createGain();
      engGain.gain.value = 0.0;

      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 48;

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 24;

      osc1.connect(engFilter);
      osc2.connect(engFilter);
      engFilter.connect(engGain);
      engGain.connect(master);
      osc1.start();
      osc2.start();

      this.engineOsc1 = osc1;
      this.engineOsc2 = osc2;
      this.engineFilter = engFilter;
      this.engineGain = engGain;

      // Shared white/pink noise buffer for rain + tire skid
      const bufSize = ctx.sampleRate * 2;
      const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < bufSize; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.029;
        b1 = 0.985 * b1 + w * 0.032;
        b2 = 0.95 * b2 + w * 0.048;
        data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + w * 0.18) * 0.7));
      }

      // Rain / wind ambient bed
      const rainSrc = ctx.createBufferSource();
      rainSrc.buffer = noiseBuf;
      rainSrc.loop = true;
      const rainFilter = ctx.createBiquadFilter();
      rainFilter.type = 'bandpass';
      rainFilter.frequency.value = 1100;
      rainFilter.Q.value = 0.6;
      const rainGain = ctx.createGain();
      rainGain.gain.value = 0.0;
      rainSrc.connect(rainFilter);
      rainFilter.connect(rainGain);
      rainGain.connect(master);
      rainSrc.start();
      this.rainFilter = rainFilter;
      this.rainGain = rainGain;

      // Tire screech / drift noise
      const skidSrc = ctx.createBufferSource();
      skidSrc.buffer = noiseBuf;
      skidSrc.loop = true;
      const skidFilter = ctx.createBiquadFilter();
      skidFilter.type = 'bandpass';
      skidFilter.frequency.value = 1850;
      skidFilter.Q.value = 5.5;
      const skidGain = ctx.createGain();
      skidGain.gain.value = 0.0;
      skidSrc.connect(skidFilter);
      skidFilter.connect(skidGain);
      skidGain.connect(master);
      skidSrc.start();
      this.skidFilter = skidFilter;
      this.skidGain = skidGain;

      // LSPD Siren wail
      const sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'sawtooth';
      sirenOsc.frequency.value = 680;
      const sirenFilter = ctx.createBiquadFilter();
      sirenFilter.type = 'bandpass';
      sirenFilter.frequency.value = 1100;
      sirenFilter.Q.value = 2.0;
      const sirenGain = ctx.createGain();
      sirenGain.gain.value = 0.0;
      sirenOsc.connect(sirenFilter);
      sirenFilter.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      this.sirenOsc = sirenOsc;
      this.sirenGain = sirenGain;

      this.initialized = true;
    } catch {
      // Ignore audio init errors in restricted environments
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.cancelSpeech();
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        muted ? 0 : 0.42,
        this.ctx.currentTime,
        0.04,
      );
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public silenceLoops(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain?.gain.setTargetAtTime(0, t, 0.05);
    this.rainGain?.gain.setTargetAtTime(0, t, 0.05);
    this.skidGain?.gain.setTargetAtTime(0, t, 0.05);
    this.sirenGain?.gain.setTargetAtTime(0, t, 0.05);
  }

  public updateContinuous(params: {
    inVehicle: boolean;
    rpm: number;
    throttle: number;
    nitroActive: boolean;
    skidIntensity: number;
    weather: WeatherType;
    sirenIntensity: number; // 0..1
    dt: number;
  }): void {
    if (!this.initialized || !this.ctx || this.muted) return;
    const t = this.ctx.currentTime;

    // Engine synth
    if (this.engineOsc1 && this.engineOsc2 && this.engineFilter && this.engineGain) {
      if (params.inVehicle) {
        const baseFreq = 34 + (params.rpm / 7500) * 145 + (params.nitroActive ? 28 : 0);
        this.engineOsc1.frequency.setTargetAtTime(baseFreq, t, 0.04);
        this.engineOsc2.frequency.setTargetAtTime(baseFreq * 0.502, t, 0.04);
        this.engineFilter.frequency.setTargetAtTime(
          160 + (params.rpm / 7500) * 850 + params.throttle * 260,
          t,
          0.05,
        );
        this.engineGain.gain.setTargetAtTime(
          0.11 + params.throttle * 0.1 + (params.nitroActive ? 0.08 : 0),
          t,
          0.06,
        );
      } else {
        this.engineGain.gain.setTargetAtTime(0, t, 0.08);
      }
    }

    // Tire screech
    if (this.skidGain && this.skidFilter) {
      const targetSkid = params.inVehicle ? params.skidIntensity * 0.14 : 0;
      this.skidGain.gain.setTargetAtTime(targetSkid, t, 0.04);
      this.skidFilter.frequency.setTargetAtTime(
        params.weather === 'rain' || params.weather === 'storm' ? 1250 : 1950,
        t,
        0.08,
      );
    }

    // Rain / ambient wind
    if (this.rainGain && this.rainFilter) {
      let targetRain = 0.015;
      let freq = 600;
      if (params.weather === 'rain') {
        targetRain = 0.14;
        freq = 1300;
      } else if (params.weather === 'storm') {
        targetRain = 0.24;
        freq = 1650;
      } else if (params.weather === 'fog') {
        targetRain = 0.04;
        freq = 480;
      }
      this.rainGain.gain.setTargetAtTime(targetRain, t, 0.2);
      this.rainFilter.frequency.setTargetAtTime(freq, t, 0.2);
    }

    // Police siren wail
    if (this.sirenOsc && this.sirenGain) {
      if (params.sirenIntensity > 0.03) {
        this.sirenPhase += params.dt * 4.4;
        const wail = 690 + Math.sin(this.sirenPhase) * 280;
        this.sirenOsc.frequency.setTargetAtTime(wail, t, 0.03);
        this.sirenGain.gain.setTargetAtTime(params.sirenIntensity * 0.09, t, 0.08);
      } else {
        this.sirenGain.gain.setTargetAtTime(0, t, 0.1);
      }
    }
  }

  public playImpact(strength: number): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    const clamped = Math.min(1, Math.max(0.15, strength));

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(115 + Math.random() * 25, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.22);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35 * clamped, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  public playThunder(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(64, t);
    osc.frequency.exponentialRampToValueAtTime(24, t + 1.6);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, t);
    filter.frequency.exponentialRampToValueAtTime(55, t + 1.5);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.01, t);
    g.gain.linearRampToValueAtTime(0.38, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.75);

    osc.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 1.8);
  }

  public playDoorThud(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.24, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  public playCheckpoint(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t + idx * 0.065);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.18, t + idx * 0.065);
      g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.065 + 0.3);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t + idx * 0.065);
      osc.stop(t + idx * 0.065 + 0.32);
    });
  }

  public playCashRegister(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    const notes = [880, 1318.5];
    notes.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + idx * 0.08);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.22, t + idx * 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.08 + 0.34);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t + idx * 0.08);
      osc.stop(t + idx * 0.08 + 0.36);
    });
  }

  public playRobberyAlarm(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const start = t + i * 0.24;
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(i % 2 === 0 ? 920 : 680, start);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.14, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.connect(filter);
      filter.connect(g);
      g.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.22);
    }
  }

  public playWastedSting(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(98, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 1.1);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);

    osc.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 1.25);
  }

  public playDoorChime(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    [1046.5, 783.99].forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.14);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.18, t + idx * 0.14);
      g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.14 + 0.35);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t + idx * 0.14);
      osc.stop(t + idx * 0.14 + 0.38);
    });
  }

  public playRegisterKeys(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const start = t + i * 0.09;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1400 + (i % 3) * 240, start);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.12, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.05);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.06);
    }
  }

  public playDrawerPop(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    // Classic brass cash register bell + mechanical slide click
    const bell = this.ctx.createOscillator();
    bell.type = 'sine';
    bell.frequency.setValueAtTime(1760, t);
    const bellG = this.ctx.createGain();
    bellG.gain.setValueAtTime(0.24, t);
    bellG.gain.exponentialRampToValueAtTime(0.001, t + 0.52);
    bell.connect(bellG);
    bellG.connect(this.masterGain);
    bell.start(t);
    bell.stop(t + 0.55);

    const clunk = this.ctx.createOscillator();
    clunk.type = 'square';
    clunk.frequency.setValueAtTime(190, t + 0.02);
    clunk.frequency.exponentialRampToValueAtTime(75, t + 0.14);
    const clunkG = this.ctx.createGain();
    clunkG.gain.setValueAtTime(0.18, t + 0.02);
    clunkG.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    clunk.connect(clunkG);
    clunkG.connect(this.masterGain);
    clunk.start(t + 0.02);
    clunk.stop(t + 0.16);
  }

  private playFilteredNoiseBurst(
    freq: number,
    q: number,
    duration: number,
    gainLevel: number,
    freqEnd?: number,
  ): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    const sampleCount = Math.max(256, Math.floor(this.ctx.sampleRate * duration));
    const buf = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      ch[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(80, freqEnd), t + duration);
    }
    filter.Q.value = q;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainLevel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  public playCashRustle(): void {
    this.playFilteredNoiseBurst(2600, 1.4, 0.14, 0.24, 1600);
  }

  public playBagZip(): void {
    this.playFilteredNoiseBurst(1600, 3.2, 0.28, 0.2, 4200);
  }

  public playBatWhoosh(): void {
    this.playFilteredNoiseBurst(520, 1.6, 0.24, 0.34, 190);
  }

  public playDodgeWhoosh(): void {
    this.playFilteredNoiseBurst(980, 1.2, 0.18, 0.25, 360);
  }

  public playBatCrack(): void {
    this.playImpact(1.0);
    this.playFilteredNoiseBurst(1150, 2.0, 0.12, 0.38, 280);
  }

  public playPunchImpact(): void {
    this.playImpact(0.85);
    this.playFilteredNoiseBurst(740, 1.5, 0.09, 0.28, 210);
  }

  public playQteSuccess(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    [587.33, 880].forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.055);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.18, t + idx * 0.055);
      g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.055 + 0.2);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t + idx * 0.055);
      osc.stop(t + idx * 0.055 + 0.22);
    });
  }

  public playQteFail(): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.22);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  public speakDialogue(text: string, pitch = 1.0, rate = 1.04): void {
    if (this.muted) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'es-ES';
      utter.pitch = Math.max(0.5, Math.min(1.6, pitch));
      utter.rate = Math.max(0.75, Math.min(1.35, rate));
      utter.volume = 0.85;
      const voices = synth.getVoices?.() ?? [];
      const esVoice =
        voices.find((v) => /^es(-ES|-MX|-US|-419)?/i.test(v.lang)) ??
        voices.find((v) => v.lang.toLowerCase().startsWith('es'));
      if (esVoice) utter.voice = esVoice;
      synth.speak(utter);
    } catch {
      // Gracefully ignore in restricted / headless browsers
    }
  }

  public cancelSpeech(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore
    }
  }

  public dispose(): void {
    this.cancelSpeech();
    this.silenceLoops();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}
