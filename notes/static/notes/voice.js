/**
 * NotesPro ```voice``` / ```transcript``` block — record audio and transcribe
 * in the browser with open-source Whisper (Transformers.js / Xenova).
 */
(function (root, factory) {
  const api = factory();
  root.NotesProVoice = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const LANGS = [
    ['auto', 'Auto'],
    ['en', 'English'],
    ['de', 'German'],
    ['fr', 'French'],
    ['es', 'Spanish'],
    ['it', 'Italian'],
    ['nl', 'Dutch'],
    ['pt', 'Portuguese'],
    ['pl', 'Polish'],
    ['uk', 'Ukrainian'],
    ['ru', 'Russian'],
    ['zh', 'Chinese'],
    ['ja', 'Japanese'],
    ['ko', 'Korean'],
  ];
  const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
  const WHISPER_MODEL = 'Xenova/whisper-tiny';
  const MAX_RECORD_MS = 10 * 60 * 1000;

  let transformersMod = null;
  let transcriberPromise = null;

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseFenceAttrs(attrs) {
    const config = {};
    String(attrs || '').split(';').forEach((pair) => {
      const trimmed = pair.trim();
      if (!trimmed) return;
      const eq = trimmed.indexOf('=');
      if (eq < 0) {
        config[trimmed.toLowerCase()] = '';
        return;
      }
      config[trimmed.slice(0, eq).trim().toLowerCase()] = trimmed.slice(eq + 1).trim().replace(/,\s*$/, '');
    });
    return config;
  }

  function buildFenceAttrsString(cfg) {
    const parts = [];
    const title = String(cfg.title || '').trim();
    const lang = String(cfg.lang || cfg.language || 'auto').trim() || 'auto';
    const col = String(cfg.col || cfg.color || '').trim();
    const bkcol = String(cfg.bkcol || cfg.bgcol || cfg.bg || '').trim();
    if (title) parts.push(`title=${title}`);
    if (lang && lang !== 'auto') parts.push(`lang=${lang}`);
    else parts.push('lang=auto');
    if (col) parts.push(`col=${col}`);
    if (bkcol) parts.push(`bkcol=${bkcol}`);
    return parts.join(';');
  }

  function resolveStyle(cfg) {
    const colRaw = String(cfg.col || cfg.color || '').trim();
    const lower = colRaw.toLowerCase();
    let theme = '';
    let colorCss = '';
    if (THEMES.includes(lower)) theme = lower;
    else if (colRaw) colorCss = colRaw;
    const bgCss = String(cfg.bkcol || cfg.bgcol || cfg.bg || '').trim();
    return { theme, colorCss, bgCss };
  }

  function parseBody(source) {
    const raw = String(source || '').replace(/\r\n/g, '\n').trim();
    let audio = '';
    let transcript = raw;
    const audioLine = raw.match(/^(?:audio|file|src)\s*[:=]\s*(.+)$/im);
    const mdImage = raw.match(/!\[[^\]]*\]\(([^)]+)\)/);
    if (audioLine) {
      audio = audioLine[1].trim().replace(/^<|>$/g, '');
      transcript = raw.replace(audioLine[0], '').replace(/^\s*-{3,}\s*/m, '').trim();
    } else if (mdImage) {
      audio = mdImage[1].trim();
      transcript = raw.replace(mdImage[0], '').replace(/^\s*-{3,}\s*/m, '').trim();
    }
    return { audio, transcript };
  }

  function formatBody({ audio, transcript }) {
    const clip = String(audio || '').trim();
    const text = String(transcript || '').replace(/\s+$/, '');
    if (clip && text) return `audio: ${clip}\n---\n${text}`;
    if (clip) return `audio: ${clip}\n`;
    return text ? `${text}\n` : '';
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const parsed = parseBody(source);
    const title = String(cfg.title || 'Voice note').trim() || 'Voice note';
    const lang = String(cfg.lang || cfg.language || 'auto').trim() || 'auto';
    const voiceIndex = Number.isFinite(options.voiceIndex) ? options.voiceIndex : 0;
    const themeClass = style.theme ? ` voice-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' voice-block--custom' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--voice-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--voice-bg:${style.bgCss}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map((v) => escapeHtml(v)).join(';')}"`
      : '';
    const langOptions = LANGS.map(([code, label]) => (
      `<option value="${escapeHtml(code)}"${code === lang ? ' selected' : ''}>${escapeHtml(label)}</option>`
    )).join('');
    const audioHref = (typeof options.resolveAudioHref === 'function' && parsed.audio)
      ? options.resolveAudioHref(parsed.audio)
      : parsed.audio;
    const audioHtml = parsed.audio
      ? `<audio class="voice-player" controls preload="metadata" src="${escapeHtml(audioHref)}"></audio>`
      : '<p class="voice-empty">No recording yet. Press Record, then Stop — Whisper transcribes in this browser.</p>';
    return [
      `<div class="voice-block${themeClass}${customClass}"${styleAttr}`,
      ` data-voice-index="${voiceIndex}" data-voice-audio="${escapeHtml(parsed.audio)}" data-voice-lang="${escapeHtml(lang)}" tabindex="0">`,
      `<div class="voice-head">`,
      `<span class="voice-badge">Voice</span>`,
      `<strong class="voice-title">${escapeHtml(title)}</strong>`,
      `<span class="voice-meta">Whisper tiny · open source</span>`,
      `</div>`,
      `<div class="voice-toolbar">`,
      `<button type="button" class="voice-btn voice-btn--record" data-act="record">Record</button>`,
      `<button type="button" class="voice-btn voice-btn--stop" data-act="stop" disabled>Stop</button>`,
      `<button type="button" class="voice-btn" data-act="transcribe"${parsed.audio ? '' : ' disabled'}>Transcribe</button>`,
      `<label class="voice-lang"><span>Language</span>`,
      `<select class="voice-lang-select" data-act="lang">${langOptions}</select></label>`,
      `<span class="voice-timer" aria-live="polite">0:00</span>`,
      `</div>`,
      `<div class="voice-player-wrap">${audioHtml}</div>`,
      `<label class="voice-transcript-label" for="voice-transcript-${voiceIndex}">Transcript</label>`,
      `<textarea class="voice-transcript" id="voice-transcript-${voiceIndex}" rows="6" placeholder="Transcript appears here…">${escapeHtml(parsed.transcript)}</textarea>`,
      `<p class="voice-status" aria-live="polite"></p>`,
      `</div>`,
    ].join('');
  }

  function setStatus(el, text) {
    const status = el.querySelector('.voice-status');
    if (status) status.textContent = text || '';
  }

  function setTimer(el, ms) {
    const timer = el.querySelector('.voice-timer');
    if (!timer) return;
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = String(total % 60).padStart(2, '0');
    timer.textContent = `${m}:${s}`;
  }

  function pickRecorderMime() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    return types.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function extensionForMime(mime) {
    if (String(mime).includes('mp4')) return 'm4a';
    if (String(mime).includes('ogg')) return 'ogg';
    return 'webm';
  }

  async function loadTransformers() {
    if (transformersMod) return transformersMod;
    transformersMod = await import(/* webpackIgnore: true */ TRANSFORMERS_URL);
    const env = transformersMod.env;
    if (env) {
      env.allowLocalModels = false;
      env.useBrowserCache = true;
    }
    return transformersMod;
  }

  async function getTranscriber(onProgress) {
    if (transcriberPromise) return transcriberPromise;
    transcriberPromise = (async () => {
      const { pipeline } = await loadTransformers();
      return pipeline('automatic-speech-recognition', WHISPER_MODEL, {
        quantized: true,
        progress_callback: (data) => {
          if (typeof onProgress !== 'function') return;
          if (data?.status === 'progress' && data.file) {
            onProgress(`Downloading ${data.file} ${Math.round(Number(data.progress) || 0)}%`);
          } else if (data?.status === 'initiate' && data.file) {
            onProgress(`Loading ${data.file}…`);
          } else if (data?.status === 'ready') {
            onProgress('Whisper ready.');
          }
        },
      });
    })().catch((err) => {
      transcriberPromise = null;
      throw err;
    });
    return transcriberPromise;
  }

  async function transcribeBlob(blob, lang, onProgress) {
    const transcriber = await getTranscriber(onProgress);
    const url = URL.createObjectURL(blob);
    try {
      const opts = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
      const code = String(lang || 'auto').toLowerCase();
      if (code && code !== 'auto') opts.language = code;
      onProgress?.('Transcribing…');
      const result = await transcriber(url, opts);
      return String(result?.text || '').trim();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.voiceHydrated === '1') return;
    el.dataset.voiceHydrated = '1';
    const recordBtn = el.querySelector('[data-act="record"]');
    const stopBtn = el.querySelector('[data-act="stop"]');
    const transcribeBtn = el.querySelector('[data-act="transcribe"]');
    const langSelect = el.querySelector('[data-act="lang"]');
    const transcriptEl = el.querySelector('.voice-transcript');
    const playerWrap = el.querySelector('.voice-player-wrap');
    const editable = typeof options.onPersist === 'function';

    if (!editable) {
      recordBtn?.setAttribute('disabled', 'disabled');
      stopBtn?.setAttribute('disabled', 'disabled');
      transcribeBtn?.setAttribute('disabled', 'disabled');
      if (langSelect) langSelect.disabled = true;
      if (transcriptEl) transcriptEl.readOnly = true;
    }

    let mediaStream = null;
    let recorder = null;
    let chunks = [];
    let startedAt = 0;
    let tickTimer = null;
    let localBlob = null;
    let persistTimer = null;

    function currentAudio() {
      return el.dataset.voiceAudio || '';
    }

    function persist(partial) {
      if (!editable) return;
      options.onPersist({
        audio: partial.audio !== undefined ? partial.audio : currentAudio(),
        transcript: partial.transcript !== undefined ? partial.transcript : (transcriptEl?.value || ''),
        lang: partial.lang !== undefined ? partial.lang : (langSelect?.value || 'auto'),
      });
    }

    function scheduleTranscriptPersist() {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => persist({}), 400);
    }

    function setPlayer(src) {
      if (!playerWrap) return;
      if (!src) {
        playerWrap.innerHTML = '<p class="voice-empty">No recording yet. Press Record, then Stop — Whisper transcribes in this browser.</p>';
        transcribeBtn?.setAttribute('disabled', 'disabled');
        return;
      }
      playerWrap.innerHTML = `<audio class="voice-player" controls preload="metadata" src="${escapeHtml(src)}"></audio>`;
      transcribeBtn?.removeAttribute('disabled');
    }

    function stopTicker() {
      clearInterval(tickTimer);
      tickTimer = null;
    }

    async function stopTracks() {
      mediaStream?.getTracks?.().forEach((track) => track.stop());
      mediaStream = null;
    }

    async function startRecording() {
      if (!editable) return;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setStatus(el, 'This browser cannot record audio.');
        return;
      }
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        setStatus(el, err?.name === 'NotAllowedError'
          ? 'Microphone permission denied.'
          : 'Could not open the microphone.');
        return;
      }
      const mime = pickRecorderMime();
      chunks = [];
      recorder = mime ? new MediaRecorder(mediaStream, { mimeType: mime }) : new MediaRecorder(mediaStream);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        void finishRecording(recorder.mimeType || mime || 'audio/webm');
      };
      recorder.start(250);
      startedAt = Date.now();
      el.classList.add('voice-block--recording');
      recordBtn.disabled = true;
      stopBtn.disabled = false;
      transcribeBtn.disabled = true;
      setTimer(el, 0);
      setStatus(el, 'Recording…');
      stopTicker();
      tickTimer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        setTimer(el, elapsed);
        if (elapsed >= MAX_RECORD_MS) stopRecording();
      }, 200);
    }

    function stopRecording() {
      stopTicker();
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else void stopTracks();
      el.classList.remove('voice-block--recording');
      recordBtn.disabled = false;
      stopBtn.disabled = true;
    }

    async function finishRecording(mime) {
      await stopTracks();
      const blob = new Blob(chunks, { type: mime || 'audio/webm' });
      chunks = [];
      if (!blob.size) {
        setStatus(el, 'Recording was empty.');
        return;
      }
      localBlob = blob;
      const localUrl = URL.createObjectURL(blob);
      setPlayer(localUrl);
      setStatus(el, 'Uploading recording…');
      try {
        const ext = extensionForMime(mime);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const file = new File([blob], `voice-${stamp}.${ext}`, { type: blob.type || mime });
        const mediaPath = await options.onUploadAudio?.(file);
        if (mediaPath) {
          el.dataset.voiceAudio = mediaPath;
          const href = (typeof options.resolveAudioHref === 'function')
            ? options.resolveAudioHref(mediaPath)
            : mediaPath;
          setPlayer(href);
          URL.revokeObjectURL(localUrl);
          persist({ audio: mediaPath });
        }
        setStatus(el, 'Transcribing with Whisper (first run downloads the model)…');
        const text = await transcribeBlob(blob, langSelect?.value || 'auto', (msg) => setStatus(el, msg));
        if (transcriptEl && text) transcriptEl.value = text;
        persist({ transcript: text || transcriptEl?.value || '' });
        setStatus(el, text ? 'Transcript ready.' : 'No speech detected.');
      } catch (err) {
        console.warn('voice record/transcript failed:', err);
        setStatus(el, err?.message || 'Upload or transcription failed. The clip may still be in the player.');
      }
    }

    async function rerunTranscript() {
      const src = currentAudio();
      if (!src && !localBlob) {
        setStatus(el, 'Record audio first.');
        return;
      }
      transcribeBtn.disabled = true;
      try {
        setStatus(el, 'Transcribing with Whisper…');
        let blob = localBlob;
        if (!blob && src) {
          const href = (typeof options.resolveAudioHref === 'function')
            ? options.resolveAudioHref(src)
            : src;
          const res = await fetch(href);
          blob = await res.blob();
        }
        const text = await transcribeBlob(blob, langSelect?.value || 'auto', (msg) => setStatus(el, msg));
        if (transcriptEl) transcriptEl.value = text;
        persist({ transcript: text });
        setStatus(el, text ? 'Transcript ready.' : 'No speech detected.');
      } catch (err) {
        console.warn('voice transcribe failed:', err);
        setStatus(el, err?.message || 'Transcription failed.');
      } finally {
        transcribeBtn.disabled = !currentAudio() && !localBlob;
      }
    }

    recordBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      void startRecording();
    });
    stopBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      stopRecording();
    });
    transcribeBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      void rerunTranscript();
    });
    langSelect?.addEventListener('change', () => {
      el.dataset.voiceLang = langSelect.value;
      persist({ lang: langSelect.value });
    });
    transcriptEl?.addEventListener('input', scheduleTranscriptPersist);

    return {
      destroy() {
        stopTicker();
        clearTimeout(persistTimer);
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        void stopTracks();
      },
    };
  }

  function hydrate(root, options = {}) {
    (root || document).querySelectorAll('.voice-block').forEach((el) => {
      hydrateBlock(el, options);
    });
  }

  return {
    parseFenceAttrs,
    buildFenceAttrsString,
    parseBody,
    formatBody,
    renderBlock,
    hydrateBlock,
    hydrate,
  };
}));
