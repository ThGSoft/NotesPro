/**
 * NotesPro ```jukebox``` block — Livia-style cabinet player with MP3 upload.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProJukebox = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];
  const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus)(\?|#|$)/i;
  const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;
  const MD_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
  const MD_LINK_RE = /^\[([^\]]*)\]\(([^)]+)\)\s*$/;
  const HEADING_RE = /^#{1,6}\s+(.+)$/;
  const DEFAULT_ALBUM = 'Uploads';
  const DEFAULT_TITLE = "Livia's Jukebox";
  const VOLUME_KEY = 'jukeboxVolume';
  const PREFETCH_AHEAD = 12;
  const PREFETCH_KEEP = 32;
  const DRIVE_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
  const DRIVE_FILE_PATH_RE = /\/file\/d\/([A-Za-z0-9_-]+)/i;
  const DRIVE_FOLDER_PATH_RE = /\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/i;
  const DRIVE_HOST_RE = /(?:drive|docs)\.google\.com/i;

  function cssBackgroundUrl(href) {
    return `url("${String(href || '').replace(/\\/g, '/').replace(/"/g, '\\"')}")`;
  }

  const PlayMode = {
    None: 0,
    ContinuousAlbum: 1,
    ContinuousAll: 2,
    RandomAlbum: 3,
    RandomAll: 4,
  };

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
    const col = String(cfg.col || cfg.color || '').trim();
    const bkcol = String(cfg.bkcol || cfg.bgcol || cfg.bg || '').trim();
    const cover = String(cfg.cover || '').trim();
    const drive = String(cfg.drive || '').trim();
    if (title) parts.push(`title=${title}`);
    if (col) parts.push(`col=${col}`);
    if (bkcol) parts.push(`bkcol=${bkcol}`);
    if (cover) parts.push(`cover=${cover}`);
    if (drive) parts.push(`drive=${drive}`);
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

  function driveFileId(src) {
    const text = String(src || '').trim();
    if (!text) return '';
    if (DRIVE_FOLDER_PATH_RE.test(text) || /embeddedfolderview/i.test(text)) return '';
    const file = text.match(DRIVE_FILE_PATH_RE);
    if (file) return file[1];
    try {
      const url = new URL(text);
      const id = url.searchParams.get('id') || '';
      if (DRIVE_HOST_RE.test(url.hostname) && DRIVE_ID_RE.test(id)) return id;
    } catch (_) { /* not a URL */ }
    if (DRIVE_ID_RE.test(text) && !text.includes('/')) return text;
    return '';
  }

  function driveFolderId(src) {
    const text = String(src || '').trim();
    const folder = text.match(DRIVE_FOLDER_PATH_RE);
    if (folder) return folder[1];
    if (/embeddedfolderview/i.test(text)) {
      try {
        return new URL(text).searchParams.get('id') || '';
      } catch (_) {
        const query = text.match(/[?&]id=([A-Za-z0-9_-]{16,128})/i);
        return query ? query[1] : '';
      }
    }
    return '';
  }

  function isDriveSrc(src) {
    return !!(driveFileId(src) || driveFolderId(src));
  }

  function canonicalDriveFileUrl(fileId) {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }

  function canonicalDriveFolderUrl(folderId) {
    return `https://drive.google.com/drive/folders/${folderId}`;
  }

  function isAudioSrc(src) {
    if (AUDIO_EXT_RE.test(String(src || ''))) return true;
    return !!driveFileId(src);
  }

  function isImageSrc(src) {
    return IMAGE_EXT_RE.test(String(src || ''));
  }

  function isAudioFile(file) {
    if (!file) return false;
    const type = String(file.type || '').toLowerCase();
    if (type.startsWith('audio/')) return true;
    return AUDIO_EXT_RE.test(file.name || '');
  }

  function titleFromFilename(name) {
    const raw = String(name || '');
    if (driveFileId(raw) || driveFolderId(raw)) {
      const fileId = driveFileId(raw);
      if (fileId) return 'Drive track';
    }
    const base = raw.replace(/^.*[\\/]/, '').replace(AUDIO_EXT_RE, '');
    const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned || 'Track';
  }

  function unwrapSrc(raw) {
    return String(raw || '').trim().replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '');
  }

  function albumOf(track) {
    return String(track?.album || '').trim() || DEFAULT_ALBUM;
  }

  function makeTrack(fields, album) {
    let src = String(fields.src || '').trim();
    const fileId = driveFileId(src);
    if (fileId) src = canonicalDriveFileUrl(fileId);
    const track = {
      title: fields.title || titleFromFilename(fields.title ? src : (fields.src || src)),
      artist: fields.artist || '',
      src,
    };
    const name = String(album || '').trim();
    if (name) track.album = name;
    if (fields.cover) track.cover = fields.cover;
    return track;
  }

  function parseBody(source) {
    const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
    const tracks = [];
    let cover = '';
    let currentAlbum = '';
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---') return;
      const heading = trimmed.match(HEADING_RE);
      if (heading) {
        currentAlbum = heading[1].trim();
        return;
      }
      const img = trimmed.match(MD_IMAGE_RE);
      if (img) {
        const src = unwrapSrc(img[2]);
        if (isAudioSrc(src)) {
          tracks.push(makeTrack({ title: img[1].trim() || titleFromFilename(src), artist: '', src }, currentAlbum));
        } else if (isImageSrc(src) || src) {
          if (tracks.length) tracks[tracks.length - 1].cover = src;
          else cover = src;
        }
        return;
      }
      const link = trimmed.match(MD_LINK_RE);
      if (link) {
        const src = unwrapSrc(link[2]);
        if (src) tracks.push(makeTrack({ title: link[1].trim() || titleFromFilename(src), artist: '', src }, currentAlbum));
        return;
      }
      const keyed = trimmed.match(/^(?:audio|file|src|track)\s*[:=]\s*(.+)$/i);
      if (keyed) {
        const src = unwrapSrc(keyed[1]);
        if (src) tracks.push(makeTrack({ title: titleFromFilename(src), artist: '', src }, currentAlbum));
        return;
      }
      if (trimmed.includes('|')) {
        const parts = trimmed.split('|').map((part) => part.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const src = unwrapSrc(parts[parts.length - 1]);
          const title = parts[0] || titleFromFilename(src);
          const artist = parts.length > 2 ? parts.slice(1, -1).join(' | ') : '';
          if (src) tracks.push(makeTrack({ title, artist, src }, currentAlbum));
        }
        return;
      }
      if (isAudioSrc(trimmed) || isDriveSrc(trimmed) || /^(https?:|media\/|uploads\/|\/media\/)/i.test(trimmed)) {
        tracks.push(makeTrack({ title: titleFromFilename(trimmed), artist: '', src: unwrapSrc(trimmed) }, currentAlbum));
      }
    });
    return { cover, tracks };
  }

  function formatTrackLine(track) {
    const src = String(track.src || '').trim();
    const title = String(track.title || titleFromFilename(src)).trim() || titleFromFilename(src);
    const artist = String(track.artist || '').trim();
    if (artist) return `${title} | ${artist} | ${src}`;
    return `[${title}](${src})`;
  }

  function formatBody({ cover, tracks }) {
    const lines = [];
    const art = String(cover || '').trim();
    if (art) lines.push(`![Cover](${art})`);
    const groups = [];
    const indexByAlbum = new Map();
    (tracks || []).forEach((track) => {
      const src = String(track.src || '').trim();
      if (!src) return;
      const album = String(track.album || '').trim();
      if (!indexByAlbum.has(album)) {
        indexByAlbum.set(album, groups.length);
        groups.push({ album, tracks: [] });
      }
      groups[indexByAlbum.get(album)].tracks.push(track);
    });
    groups.forEach((group) => {
      if (group.album) lines.push(`# ${group.album}`);
      group.tracks.forEach((track) => lines.push(formatTrackLine(track)));
    });
    return lines.length ? `${lines.join('\n')}\n` : '';
  }

  function shuffleArray(array) {
    const copy = array.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const randomIndex = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[randomIndex]] = [copy[randomIndex], copy[i]];
    }
    return copy;
  }

  function uniqueAlbums(tracks) {
    const names = [];
    const seen = new Set();
    (tracks || []).forEach((track) => {
      const name = albumOf(track);
      if (seen.has(name)) return;
      seen.add(name);
      names.push(name);
    });
    names.sort((a, b) => a.localeCompare(b));
    return names;
  }

  function albumFromRelativePath(relativePath) {
    const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 1) return '';
    const dirs = parts.slice(0, -1);
    if (dirs.length === 1) return dirs[0];
    return dirs.slice(1).join(' / ');
  }

  function fileRelativePath(file) {
    return String(file?.relativePath || file?.webkitRelativePath || file?.name || '').replace(/\\/g, '/');
  }

  function filesFromDirectoryEntry(entry, prefix = '') {
    return new Promise((resolve) => {
      if (!entry) {
        resolve([]);
        return;
      }
      if (entry.isFile) {
        entry.file((file) => {
          const rel = prefix ? `${prefix}/${file.name}` : file.name;
          try {
            Object.defineProperty(file, 'relativePath', { value: rel, configurable: true });
          } catch (_) {
            file.relativePath = rel;
          }
          resolve([file]);
        }, () => resolve([]));
        return;
      }
      if (!entry.isDirectory) {
        resolve([]);
        return;
      }
      const dirPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      const reader = entry.createReader();
      const collected = [];
      const readBatch = () => {
        reader.readEntries(async (batch) => {
          if (!batch.length) {
            resolve(collected);
            return;
          }
          for (const child of batch) {
            const nested = await filesFromDirectoryEntry(child, dirPrefix);
            collected.push(...nested);
          }
          readBatch();
        }, () => resolve(collected));
      };
      readBatch();
    });
  }

  function renderBlock(source, fenceAttrs, options = {}) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const style = resolveStyle(cfg);
    const parsed = parseBody(source);
    const cover = String(cfg.cover || parsed.cover || '').trim();
    const drive = String(cfg.drive || '').trim();
    const title = String(cfg.title || DEFAULT_TITLE).trim() || DEFAULT_TITLE;
    const jukeboxIndex = Number.isFinite(options.jukeboxIndex) ? options.jukeboxIndex : 0;
    const editable = !!options.editable;
    const resolve = typeof options.resolveAudioHref === 'function'
      ? options.resolveAudioHref
      : (src) => src;
    const themeClass = style.theme ? ` jukebox-block--${style.theme}` : '';
    const customClass = (style.colorCss || style.bgCss) ? ' jukebox-block--custom' : '';
    const editClass = editable ? ' jukebox-block--editable' : '';
    const styleVars = [];
    if (style.colorCss) styleVars.push(`--jukebox-accent:${style.colorCss}`);
    if (style.bgCss) styleVars.push(`--jukebox-bg:${style.bgCss}`);
    if (cover) styleVars.push(`--jukebox-photo:${cssBackgroundUrl(resolve(cover))}`);
    const styleAttr = styleVars.length
      ? ` style="${styleVars.map((item) => escapeHtml(item)).join(';')}"`
      : '';
    const uploadHtml = editable
      ? [
        '<div class="jukebox-drop" data-act="drop">',
        '<input class="jukebox-file" type="file" accept="audio/mpeg,audio/mp3,audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus" multiple hidden>',
        '<input class="jukebox-folder" type="file" multiple webkitdirectory directory hidden>',
        '<button type="button" class="jukebox-add" data-act="add">Add tracks or folders</button>',
        '<span class="jukebox-drop-hint">Drop MP3 files or folders here, or <button type="button" class="jukebox-folder-link" data-act="add-folder">choose a folder</button></span>',
        '<input class="jukebox-drive-url" type="url" placeholder="Paste Google Drive file or folder link" autocomplete="off">',
        '<button type="button" class="jukebox-add jukebox-drive-add" data-act="drive-add">Add Drive</button>',
        '</div>',
      ].join('')
      : '';
    return [
      `<div class="jukebox-block${themeClass}${customClass}${editClass}"${styleAttr}`,
      ` data-jukebox-index="${jukeboxIndex}" data-jukebox-spec="${escapeHtml(JSON.stringify({ cover, tracks: parsed.tracks, title, drive }))}" tabindex="0">`,
      `<div class="jukebox-chrome">`,
      `<div class="jukebox-controls">`,
      `<div class="jukebox-control-row jukebox-control-row--player">`,
      `<div class="jukebox-player-wrap">`,
      `<div class="jukebox-song-label">No song playing</div>`,
      `<div class="jukebox-player">`,
      `<audio class="jukebox-audio" controls preload="auto"></audio>`,
      `</div></div></div>`,
      `<div class="jukebox-control-row jukebox-control-row--album">`,
      `<label class="jukebox-album-label">Select Album:`,
      `<select class="jukebox-album-select" aria-label="Select album"></select>`,
      `</label>`,
      `</div>`,
      `<div class="jukebox-control-row jukebox-control-row--modes">`,
      `<button type="button" class="jukebox-mode-btn" data-act="continuous-album">Play Continuous Album</button>`,
      `<button type="button" class="jukebox-mode-btn" data-act="random-album">Play Random Album</button>`,
      `<button type="button" class="jukebox-mode-btn" data-act="continuous-all">Play Continuous All</button>`,
      `<button type="button" class="jukebox-mode-btn" data-act="random-all">Play Random All</button>`,
      `</div>`,
      `<div class="jukebox-control-row jukebox-control-row--nav">`,
      `<button type="button" class="jukebox-mode-btn" data-act="prev">Previous</button>`,
      `<button type="button" class="jukebox-mode-btn" data-act="next">Next</button>`,
      `<button type="button" class="jukebox-mode-btn" data-act="play-random">Play Random</button>`,
      `</div></div>`,
      `<div class="jukebox-cabinet">`,
      `<h1 class="jukebox-title">${escapeHtml(title)}</h1>`,
      `<div class="jukebox-playlist"></div>`,
      `</div>`,
      uploadHtml,
      `<p class="jukebox-status" aria-live="polite"></p>`,
      `</div></div>`,
    ].join('');
  }

  function setStatus(el, text) {
    const status = el.querySelector('.jukebox-status');
    if (status) status.textContent = text || '';
  }

  function hydrateBlock(el, options = {}) {
    if (!el || el.dataset.jukeboxHydrated === '1') return;
    el.dataset.jukeboxHydrated = '1';
    let spec;
    try {
      spec = JSON.parse(el.dataset.jukeboxSpec || '{}');
    } catch (_) {
      spec = { tracks: [] };
    }
    const tracks = Array.isArray(spec.tracks) ? spec.tracks.slice() : [];
    let cover = String(spec.cover || '').trim();
    let driveFolder = String(spec.drive || '').trim();
    let driveTracks = [];
    const audio = el.querySelector('.jukebox-audio');
    const playlist = el.querySelector('.jukebox-playlist');
    const albumSelect = el.querySelector('.jukebox-album-select');
    const songLabel = el.querySelector('.jukebox-song-label');
    const fileInput = el.querySelector('.jukebox-file');
    const folderInput = el.querySelector('.jukebox-folder');
    const randomBtn = el.querySelector('[data-act="play-random"]');
    const driveInput = el.querySelector('.jukebox-drive-url');
    const resolve = typeof options.resolveAudioHref === 'function'
      ? options.resolveAudioHref
      : (src) => src;

    let playQueue = [];
    let buttonList = [];
    let currentIndex = 0;
    let autoPlay = false;
    let playingMode = PlayMode.None;
    const editable = typeof options.onUploadAudio === 'function';
    const prefetchBlobs = new Map();
    const prefetchInflight = new Map();
    const prefetchOrder = [];

    function resolvedSrc(song) {
      const src = String(song?.src || '').trim();
      return src ? String(resolve(src) || '') : '';
    }

    function rememberPrefetch(href) {
      if (!href) return;
      const existing = prefetchOrder.indexOf(href);
      if (existing >= 0) prefetchOrder.splice(existing, 1);
      prefetchOrder.push(href);
      const playingHref = resolvedSrc(playQueue[Math.max(0, currentIndex - 1)]);
      while (prefetchOrder.length > PREFETCH_KEEP) {
        const old = prefetchOrder.find((item) => item !== href && item !== playingHref);
        if (!old) break;
        prefetchOrder.splice(prefetchOrder.indexOf(old), 1);
        const blobUrl = prefetchBlobs.get(old);
        if (blobUrl && audio?.src !== blobUrl) {
          URL.revokeObjectURL(blobUrl);
          prefetchBlobs.delete(old);
        }
      }
    }

    function prefetchTrack(song) {
      const href = resolvedSrc(song);
      if (!href || prefetchBlobs.has(href) || prefetchInflight.has(href)) return;
      const request = fetch(href, { credentials: 'same-origin', cache: 'default' })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.blob();
        })
        .then((blob) => {
          if (!blob || !blob.size) return;
          const prev = prefetchBlobs.get(href);
          if (prev && audio?.src !== prev) URL.revokeObjectURL(prev);
          prefetchBlobs.set(href, URL.createObjectURL(blob));
          rememberPrefetch(href);
        })
        .catch(() => {})
        .finally(() => {
          prefetchInflight.delete(href);
        });
      prefetchInflight.set(href, request);
    }

    function prefetchUpcoming() {
      for (let i = 0; i < PREFETCH_AHEAD; i += 1) {
        prefetchTrack(playQueue[currentIndex + i]);
      }
    }

    function playAt(index) {
      if (!audio || index < 0 || index >= playQueue.length) return false;
      const song = playQueue[index];
      if (!song?.src) return false;
      currentIndex = index + 1;
      updateSongLabel(song);
      clearPressed();
      const button = buttonList[index];
      if (button) button.classList.add('pressed');
      const href = resolvedSrc(song);
      const pending = prefetchInflight.get(href);
      prefetchUpcoming();
      const start = (url) => {
        if (!url || playQueue[Math.max(0, currentIndex - 1)] !== song) return;
        audio.src = url;
        audio.load();
        audio.play().catch(() => setStatus(el, 'Could not play this track.'));
      };
      if (prefetchBlobs.has(href)) {
        start(prefetchBlobs.get(href));
      } else if (pending) {
        pending.then(() => start(prefetchBlobs.get(href) || href));
      } else {
        start(href);
      }
      return true;
    }

    function allTracks() {
      return tracks.concat(driveTracks);
    }

    function persist() {
      options.onPersist?.({ tracks: tracks.slice(), cover, drive: driveFolder });
    }

    function albumSongs(albumName) {
      const name = String(albumName || '').trim() || DEFAULT_ALBUM;
      return allTracks().filter((track) => albumOf(track) === name);
    }

    function selectedAlbumName() {
      return String(albumSelect?.value || uniqueAlbums(allTracks())[0] || DEFAULT_ALBUM);
    }

    function refreshAlbumSelect() {
      if (!albumSelect) return;
      const previous = albumSelect.value;
      const names = uniqueAlbums(allTracks());
      if (!names.length) names.push(DEFAULT_ALBUM);
      albumSelect.innerHTML = names.map((name) => {
        const label = name.length > 30 ? `${name.slice(0, 30)}` : name;
        return `<option value="${escapeHtml(name)}">${escapeHtml(label)}</option>`;
      }).join('');
      if (previous && names.includes(previous)) albumSelect.value = previous;
    }

    function updateSongLabel(song) {
      if (!songLabel) return;
      if (!song) {
        songLabel.textContent = 'No song playing';
        return;
      }
      const artist = String(song.artist || '').trim();
      songLabel.textContent = artist ? `${song.title} — ${artist}` : String(song.title || 'Track');
    }

    function clearPressed() {
      buttonList.forEach((button) => button.classList.remove('pressed'));
    }

    function setModePressed(act) {
      el.querySelectorAll('.jukebox-mode-btn').forEach((button) => {
        const isMode = ['continuous-album', 'random-album', 'continuous-all', 'random-all', 'play-random'].includes(button.dataset.act);
        if (!isMode) return;
        button.classList.toggle('pressed', button.dataset.act === act);
      });
      if (randomBtn) {
        randomBtn.textContent = act === 'play-random' && autoPlay ? 'Stop Auto-Play Random' : 'Play Random';
      }
    }

    function playNextSong() {
      if (currentIndex >= playQueue.length) {
        autoPlay = false;
        if (randomBtn && playingMode === PlayMode.None) randomBtn.textContent = 'Play Random';
        return;
      }
      playAt(currentIndex);
    }

    function playPreviousSong() {
      const playing = currentIndex - 1;
      if (playQueue.length === 0) return;
      if (playing <= 0) playAt(0);
      else playAt(playing - 1);
    }

    function playRandomSong() {
      if (!playQueue.length) return;
      playAt(Math.floor(Math.random() * playQueue.length));
    }

    function buildButtons(songs) {
      playQueue = songs.slice();
      buttonList = [];
      if (!playlist) return;
      playlist.innerHTML = '';
      if (!playQueue.length) {
        playlist.innerHTML = '<div class="jukebox-empty-row">No tracks yet.</div>';
        return;
      }
      playQueue.forEach((song, index) => {
        const cell = document.createElement('div');
        cell.className = 'jukebox-song-cell';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'song-button';
        button.textContent = song.title || `Track ${index + 1}`;
        button.title = song.artist ? `${song.title} — ${song.artist}` : button.textContent;
        button.addEventListener('click', () => {
          playAt(index);
        });
        cell.appendChild(button);
        buttonList.push(button);
        if (editable && !song.live) {
          const storedIndex = tracks.indexOf(song);
          if (storedIndex >= 0) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'jukebox-remove';
          remove.dataset.act = 'remove';
          remove.dataset.index = String(storedIndex);
          remove.setAttribute('aria-label', `Remove ${song.title || 'track'}`);
          remove.textContent = '×';
          cell.appendChild(remove);
          }
        }
        playlist.appendChild(cell);
      });
    }

    function loadPlaylist(albumName) {
      buildButtons(albumSongs(albumName || selectedAlbumName()));
      currentIndex = 0;
    }

    function requireAlbum() {
      const album = selectedAlbumName();
      const songs = albumSongs(album);
      if (!songs.length) {
        setStatus(el, 'Please select an album first.');
        return null;
      }
      return { album, songs };
    }

    async function importDriveTracks(incoming, fallbackAlbum) {
      const seen = new Set(tracks.map((track) => String(track.src || '')));
      (incoming || []).forEach((item) => {
        const src = item.src || '';
        if (!src || seen.has(src)) return;
        seen.add(src);
        tracks.push({
          title: item.title || titleFromFilename(src),
          artist: item.artist || '',
          src,
          album: item.album || fallbackAlbum || DEFAULT_ALBUM,
        });
      });
      persist();
      refreshAlbumSelect();
      const firstAlbum = (incoming && incoming[0] && incoming[0].album) || fallbackAlbum;
      if (albumSelect && firstAlbum) albumSelect.value = firstAlbum;
      loadPlaylist(selectedAlbumName());
    }

    async function loadDriveFolder(url) {
      if (!url || typeof options.onDriveList !== 'function') return;
      setStatus(el, 'Loading Google Drive…');
      try {
        const data = await options.onDriveList(url);
        if (data.url) driveFolder = data.url;
        const incoming = Array.isArray(data.tracks) ? data.tracks : [];
        await importDriveTracks(incoming, data.name || 'Drive');
        const albums = uniqueAlbums(incoming);
        const count = incoming.length;
        if (!count) setStatus(el, 'No audio files in that Drive folder.');
        else setStatus(el, `${count} Drive track${count === 1 ? '' : 's'} in ${albums.length} album${albums.length === 1 ? '' : 's'}.`);
      } catch (err) {
        setStatus(el, err?.message || 'Google Drive listing failed.');
      }
    }

    async function addDriveLink(raw) {
      const text = String(raw || '').trim();
      if (!text) {
        setStatus(el, 'Paste a Google Drive file or folder link.');
        return;
      }
      if (typeof options.onDriveList !== 'function') {
        setStatus(el, 'Sign in to load Google Drive.');
        return;
      }
      setStatus(el, 'Loading Google Drive…');
      try {
        const data = await options.onDriveList(text);
        const incoming = Array.isArray(data.tracks) ? data.tracks : [];
        if (data.type === 'folder' || driveFolderId(text) || incoming.length > 1) {
          driveFolder = data.url || canonicalDriveFolderUrl(data.id || driveFolderId(text));
          await importDriveTracks(incoming, data.name || 'Drive');
          const albums = uniqueAlbums(incoming);
          const count = incoming.length;
          if (!count) setStatus(el, 'No audio files in that Drive folder.');
          else setStatus(el, `${count} Drive track${count === 1 ? '' : 's'} in ${albums.length} album${albums.length === 1 ? '' : 's'}.`);
          return;
        }
        await importDriveTracks(incoming.map((item) => ({
          ...item,
          album: item.album || selectedAlbumName(),
        })), selectedAlbumName());
        setStatus(el, incoming.length === 1 ? 'Drive track added.' : `${incoming.length} Drive tracks added.`);
      } catch (err) {
        setStatus(el, err?.message || 'Google Drive failed.');
      }
    }

    function startQueue(songs, mode, act) {
      if (!songs.length) {
        setStatus(el, 'Add an MP3 or Google Drive link first.');
        return;
      }
      autoPlay = true;
      playingMode = mode;
      currentIndex = 0;
      buildButtons(songs);
      setModePressed(act);
      setStatus(el, '');
      playNextSong();
    }

    el.addEventListener('click', (event) => {
      const actEl = event.target.closest('[data-act]');
      const act = actEl?.dataset.act;
      if (!act) return;
      if (act === 'add') {
        fileInput?.click();
        return;
      }
      if (act === 'add-folder') {
        folderInput?.click();
        return;
      }
      if (act === 'drive-add') {
        addDriveLink(driveInput?.value || '');
        if (driveInput) driveInput.value = '';
        return;
      }
      if (act === 'remove') {
        const index = parseInt(actEl.dataset.index, 10);
        if (!Number.isFinite(index) || index < 0 || index >= tracks.length) return;
        tracks.splice(index, 1);
        persist();
        refreshAlbumSelect();
        loadPlaylist(selectedAlbumName());
        setStatus(el, tracks.length ? '' : 'Playlist empty.');
        return;
      }
      if (act === 'continuous-album') {
        const picked = requireAlbum();
        if (!picked) return;
        startQueue(picked.songs.slice(), PlayMode.ContinuousAlbum, act);
      } else if (act === 'random-album') {
        const picked = requireAlbum();
        if (!picked) return;
        startQueue(shuffleArray(picked.songs), PlayMode.RandomAlbum, act);
      } else if (act === 'continuous-all') {
        startQueue(allTracks().slice(), PlayMode.ContinuousAll, act);
      } else if (act === 'random-all') {
        startQueue(shuffleArray(allTracks().slice()), PlayMode.RandomAll, act);
      } else if (act === 'prev') {
        playPreviousSong();
      } else if (act === 'next') {
        playNextSong();
      } else if (act === 'play-random') {
        if (!playQueue.length) loadPlaylist(selectedAlbumName());
        if (!playQueue.length) {
          setStatus(el, 'Add an MP3 or Google Drive link first.');
          return;
        }
        autoPlay = !autoPlay;
        playingMode = PlayMode.None;
        setModePressed(autoPlay ? 'play-random' : '');
        if (autoPlay) playRandomSong();
      }
    });

    albumSelect?.addEventListener('change', () => {
      loadPlaylist(albumSelect.value);
    });

    el.addEventListener('keydown', (event) => {
      if (event.target.closest('input, textarea, button, select, audio')) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        playNextSong();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        playPreviousSong();
      }
    });

    audio?.addEventListener('ended', () => {
      if (autoPlay) playNextSong();
    });
    audio?.addEventListener('play', () => {
      el.classList.add('jukebox-block--playing');
      setStatus(el, '');
    });
    audio?.addEventListener('pause', () => {
      el.classList.remove('jukebox-block--playing');
    });
    audio?.addEventListener('volumechange', () => {
      try {
        localStorage.setItem(VOLUME_KEY, String(audio.volume));
      } catch (_) { /* ignore quota */ }
    });
    try {
      const savedVolume = localStorage.getItem(VOLUME_KEY);
      if (savedVolume !== null && audio) audio.volume = parseFloat(savedVolume);
    } catch (_) { /* ignore */ }

    async function addFiles(fileList) {
      const files = Array.from(fileList || []).filter(isAudioFile);
      if (!files.length) {
        setStatus(el, 'Drop MP3 files or a music folder.');
        return;
      }
      if (typeof options.onUploadAudio !== 'function') {
        setStatus(el, 'Uploads need Edit mode.');
        return;
      }
      setStatus(el, files.length === 1 ? 'Uploading…' : `Uploading ${files.length} tracks…`);
      const fallbackAlbum = selectedAlbumName();
      try {
        let lastAlbum = fallbackAlbum;
        for (const file of files) {
          const src = await options.onUploadAudio(file);
          if (!src) continue;
          const album = albumFromRelativePath(fileRelativePath(file)) || fallbackAlbum;
          lastAlbum = album;
          tracks.push({ title: titleFromFilename(file.name), artist: '', src, album });
        }
        persist();
        refreshAlbumSelect();
        if (albumSelect) albumSelect.value = lastAlbum;
        loadPlaylist(selectedAlbumName());
        const albums = uniqueAlbums(files.map((file) => ({
          album: albumFromRelativePath(fileRelativePath(file)) || fallbackAlbum,
        })));
        if (files.length === 1) setStatus(el, 'Track added.');
        else setStatus(el, `${files.length} tracks in ${albums.length} album${albums.length === 1 ? '' : 's'}.`);
      } catch (err) {
        setStatus(el, err?.message || 'Upload failed.');
      }
    }

    async function addDroppedItems(dataTransfer) {
      if (!dataTransfer) return;
      const uri = String(
        dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain') || '',
      ).trim().split(/\s+/)[0];
      if (uri && (isDriveSrc(uri) || DRIVE_HOST_RE.test(uri))) {
        addDriveLink(uri);
        return;
      }
      const items = dataTransfer.items;
      if (items && items.length) {
        const entries = [];
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          const entry = item.webkitGetAsEntry?.() || item.getAsEntry?.();
          if (entry) entries.push(entry);
        }
        if (entries.length) {
          const files = [];
          for (const entry of entries) {
            files.push(...await filesFromDirectoryEntry(entry));
          }
          await addFiles(files);
          return;
        }
      }
      await addFiles(dataTransfer.files);
    }

    fileInput?.addEventListener('change', (event) => {
      addFiles(event.target.files);
      event.target.value = '';
    });
    folderInput?.addEventListener('change', (event) => {
      addFiles(event.target.files);
      event.target.value = '';
    });

    if (typeof options.onUploadAudio === 'function') {
      const drop = el.querySelector('[data-act="drop"]') || el;
      ['dragenter', 'dragover'].forEach((name) => {
        drop.addEventListener(name, (event) => {
          const types = [...event.dataTransfer?.types || []];
          if (!types.includes('Files') && !types.includes('text/uri-list') && !types.includes('text/plain')) return;
          event.preventDefault();
          el.classList.add('jukebox-block--drop');
        });
      });
      ['dragleave', 'drop'].forEach((name) => {
        drop.addEventListener(name, (event) => {
          event.preventDefault();
          if (name === 'drop') {
            const uri = String(
              event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain') || '',
            ).trim().split(/\s+/)[0];
            if (uri && (isDriveSrc(uri) || DRIVE_HOST_RE.test(uri))) addDriveLink(uri);
            else addDroppedItems(event.dataTransfer);
          }
          el.classList.remove('jukebox-block--drop');
        });
      });
    }

    driveInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      addDriveLink(driveInput.value);
      driveInput.value = '';
    });

    if (cover) {
      el.style.setProperty('--jukebox-photo', cssBackgroundUrl(resolve(cover)));
    }

    refreshAlbumSelect();
    loadPlaylist(selectedAlbumName());
    const hasImportedDrive = tracks.some((track) => driveFileId(track.src));
    if (driveFolder && !hasImportedDrive) loadDriveFolder(driveFolder);
  }

  return {
    parseFenceAttrs,
    buildFenceAttrsString,
    parseBody,
    formatBody,
    renderBlock,
    hydrateBlock,
    isAudioFile,
    titleFromFilename,
    driveFileId,
    driveFolderId,
    isDriveSrc,
    albumFromRelativePath,
  };
}));
