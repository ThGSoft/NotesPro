/**
 * NotesPro ```dance``` block — footstep charts for social dances.
 * Rhythm comes from original synthesizer one-shots in notes/dance/audio,
 * scheduled with the Web Audio API. Oscillators are only a fallback.
 */
(function (root, factory) {
  const api = factory();
  root.NotesProDance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const THEMES = ['info', 'success', 'warning', 'danger', 'note'];

  const DANCES = [
    {
      id: 'rumba',
      name: 'Rumba',
      meter: '4/4',
      bpm: 104,
      music: 'rumba',
      steps: [
        { n: '2', foot: 'L', x: 130, y: 70, rot: 0, beats: 1, label: 'Left forward' },
        { n: '3', foot: 'R', x: 200, y: 130, rot: 8, beats: 1, label: 'Right side' },
        { n: '4', foot: 'L', x: 152, y: 142, rot: 0, beats: 2, label: 'Left closes, slow' },
        { n: '2', foot: 'R', x: 168, y: 255, rot: 180, beats: 1, label: 'Right back' },
        { n: '3', foot: 'L', x: 80, y: 205, rot: 172, beats: 1, label: 'Left side' },
        { n: '4', foot: 'R', x: 128, y: 192, rot: 180, beats: 2, label: 'Right closes, slow' },
      ],
    },
    {
      id: 'chacha',
      name: 'Cha-Cha-Cha',
      meter: '4/4',
      bpm: 124,
      music: 'chacha',
      figures: [
        {
          id: 'basic',
          name: 'Basic',
          steps: [
            { n: '2', foot: 'L', x: 128, y: 68, rot: 0, beats: 1, label: 'Left forward' },
            { n: '3', foot: 'R', x: 162, y: 155, rot: 0, beats: 1, label: 'Right replace' },
            { n: '4', foot: 'L', x: 72, y: 158, rot: -10, beats: 0.5, label: 'Left side' },
            { n: '&', foot: 'R', x: 116, y: 166, rot: 6, beats: 0.5, label: 'Right closes' },
            { n: '1', foot: 'L', x: 58, y: 150, rot: -8, beats: 1, label: 'Left side' },
            { n: '2', foot: 'R', x: 172, y: 252, rot: 180, beats: 1, label: 'Right back' },
            { n: '3', foot: 'L', x: 118, y: 168, rot: 0, beats: 1, label: 'Left replace' },
            { n: '4', foot: 'R', x: 210, y: 158, rot: 12, beats: 0.5, label: 'Right side' },
            { n: '&', foot: 'L', x: 164, y: 166, rot: -6, beats: 0.5, label: 'Left closes' },
            { n: '1', foot: 'R', x: 222, y: 150, rot: 10, beats: 1, label: 'Right side' },
          ],
        },
        {
          id: 'newyork',
          name: 'New York',
          steps: [
            { n: '2', foot: 'L', x: 96, y: 86, rot: -28, beats: 1, label: 'Left check' },
            { n: '3', foot: 'R', x: 158, y: 162, rot: 0, beats: 1, label: 'Right replace' },
            { n: '4', foot: 'L', x: 78, y: 158, rot: -8, beats: 0.5, label: 'Left side' },
            { n: '&', foot: 'R', x: 122, y: 166, rot: 4, beats: 0.5, label: 'Right closes' },
            { n: '1', foot: 'L', x: 70, y: 150, rot: -6, beats: 1, label: 'Left side' },
            { n: '2', foot: 'R', x: 186, y: 84, rot: 28, beats: 1, label: 'Right check' },
            { n: '3', foot: 'L', x: 122, y: 164, rot: 0, beats: 1, label: 'Left replace' },
            { n: '4', foot: 'R', x: 204, y: 158, rot: 10, beats: 0.5, label: 'Right side' },
            { n: '&', foot: 'L', x: 160, y: 166, rot: -4, beats: 0.5, label: 'Left closes' },
            { n: '1', foot: 'R', x: 212, y: 150, rot: 8, beats: 1, label: 'Right side' },
          ],
          woman: [
            { n: '2', foot: 'R', x: 184, y: 86, rot: 28, beats: 1, label: 'Right check' },
            { n: '3', foot: 'L', x: 122, y: 162, rot: 0, beats: 1, label: 'Left replace' },
            { n: '4', foot: 'R', x: 202, y: 158, rot: 8, beats: 0.5, label: 'Right side' },
            { n: '&', foot: 'L', x: 158, y: 166, rot: -4, beats: 0.5, label: 'Left closes' },
            { n: '1', foot: 'R', x: 210, y: 150, rot: 6, beats: 1, label: 'Right side' },
            { n: '2', foot: 'L', x: 94, y: 84, rot: -28, beats: 1, label: 'Left check' },
            { n: '3', foot: 'R', x: 158, y: 164, rot: 0, beats: 1, label: 'Right replace' },
            { n: '4', foot: 'L', x: 76, y: 158, rot: -10, beats: 0.5, label: 'Left side' },
            { n: '&', foot: 'R', x: 120, y: 166, rot: 4, beats: 0.5, label: 'Right closes' },
            { n: '1', foot: 'L', x: 68, y: 150, rot: -8, beats: 1, label: 'Left side' },
          ],
        },
        {
          id: 'spot',
          name: 'Spot turn',
          steps: [
            { n: '2', foot: 'L', x: 118, y: 100, rot: -20, beats: 1, label: 'Left turn', turn: true },
            { n: '3', foot: 'R', x: 176, y: 148, rot: -120, beats: 1, label: 'Right around', turn: true },
            { n: '4', foot: 'L', x: 150, y: 210, rot: -200, beats: 0.5, label: 'Left side', turn: true },
            { n: '&', foot: 'R', x: 168, y: 176, rot: -250, beats: 0.5, label: 'Right closes', turn: true },
            { n: '1', foot: 'L', x: 128, y: 152, rot: 0, beats: 1, label: 'Left faces partner' },
          ],
          woman: [
            { n: '2', foot: 'R', x: 162, y: 100, rot: 20, beats: 1, label: 'Right turn', turn: true },
            { n: '3', foot: 'L', x: 104, y: 148, rot: 120, beats: 1, label: 'Left around', turn: true },
            { n: '4', foot: 'R', x: 130, y: 210, rot: 200, beats: 0.5, label: 'Right side', turn: true },
            { n: '&', foot: 'L', x: 112, y: 176, rot: 250, beats: 0.5, label: 'Left closes', turn: true },
            { n: '1', foot: 'R', x: 152, y: 152, rot: 0, beats: 1, label: 'Right faces partner' },
          ],
        },
      ],
    },
    {
      id: 'salsa',
      name: 'Salsa',
      meter: '4/4',
      bpm: 168,
      music: 'salsa',
      steps: [
        { n: '1', foot: 'L', x: 112, y: 72, rot: 0, beats: 1, label: 'Left forward' },
        { n: '2', foot: 'R', x: 168, y: 168, rot: 0, beats: 1, label: 'Right replaces' },
        { n: '3', foot: 'L', x: 122, y: 160, rot: 0, beats: 1, label: 'Left closes' },
        { n: '4', foot: 'both', x: 140, y: 164, rot: 0, beats: 1, label: 'Hold', hold: true },
        { n: '5', foot: 'R', x: 176, y: 262, rot: 180, beats: 1, label: 'Right back' },
        { n: '6', foot: 'L', x: 108, y: 176, rot: 0, beats: 1, label: 'Left replaces' },
        { n: '7', foot: 'R', x: 156, y: 170, rot: 0, beats: 1, label: 'Right closes' },
        { n: '8', foot: 'both', x: 140, y: 172, rot: 0, beats: 1, label: 'Hold', hold: true },
      ],
    },
    {
      id: 'waltz',
      name: 'Waltz',
      meter: '3/4',
      bpm: 87,
      music: 'waltz',
      steps: [
        { n: '1', foot: 'L', x: 118, y: 74, rot: 0, beats: 1, label: 'Left forward' },
        { n: '2', foot: 'R', x: 198, y: 128, rot: 12, beats: 1, label: 'Right side' },
        { n: '3', foot: 'L', x: 150, y: 140, rot: 0, beats: 1, label: 'Left closes' },
        { n: '4', foot: 'R', x: 168, y: 258, rot: 180, beats: 1, label: 'Right back' },
        { n: '5', foot: 'L', x: 78, y: 214, rot: 170, beats: 1, label: 'Left side' },
        { n: '6', foot: 'R', x: 132, y: 206, rot: 180, beats: 1, label: 'Right closes' },
      ],
    },
    {
      id: 'tango',
      name: 'Tango',
      meter: '2/4',
      bpm: 126,
      music: 'tango',
      steps: [
        { n: '1', foot: 'L', x: 124, y: 58, rot: 0, beats: 2, label: 'Left forward, slow' },
        { n: '2', foot: 'R', x: 158, y: 118, rot: 4, beats: 2, label: 'Right forward, slow' },
        { n: '3', foot: 'L', x: 72, y: 168, rot: -6, beats: 1, label: 'Left side, quick' },
        { n: '4', foot: 'R', x: 132, y: 176, rot: 4, beats: 1, label: 'Right closes, quick' },
      ],
    },
    {
      id: 'foxtrot',
      name: 'Foxtrot',
      meter: '4/4',
      bpm: 116,
      music: 'foxtrot',
      steps: [
        { n: '1', foot: 'L', x: 128, y: 52, rot: 0, beats: 2, label: 'Left forward, slow' },
        { n: '2', foot: 'R', x: 162, y: 118, rot: 6, beats: 2, label: 'Right forward, slow' },
        { n: '3', foot: 'L', x: 214, y: 162, rot: 16, beats: 1, label: 'Left side, quick' },
        { n: '4', foot: 'R', x: 168, y: 174, rot: 4, beats: 1, label: 'Right closes, quick' },
      ],
    },
    {
      id: 'discofox',
      name: 'Disco Fox',
      meter: '4/4',
      bpm: 118,
      music: 'disco',
      steps: [
        { n: '1', foot: 'L', x: 70, y: 156, rot: -10, beats: 2, label: 'Left side, slow' },
        { n: '2', foot: 'R', x: 128, y: 164, rot: 8, beats: 2, label: 'Right closes, slow' },
        { n: '3', foot: 'L', x: 46, y: 150, rot: -14, beats: 1, label: 'Left side, quick' },
        { n: '4', foot: 'R', x: 104, y: 158, rot: 6, beats: 1, label: 'Right closes, quick' },
      ],
    },
    {
      id: 'blues',
      name: 'Blues',
      meter: '4/4',
      bpm: 76,
      music: 'blues',
      figures: [
        {
          id: 'basic',
          name: 'Basic',
          steps: [
            { n: '1', foot: 'L', x: 112, y: 236, rot: 180, beats: 2, label: 'Left back, slow' },
            { n: '2', foot: 'R', x: 158, y: 168, rot: 0, beats: 2, label: 'Right replace, slow' },
            { n: '3', foot: 'L', x: 70, y: 156, rot: -12, beats: 2, label: 'Left side, slow' },
            { n: '4', foot: 'R', x: 128, y: 166, rot: 6, beats: 2, label: 'Right closes, slow' },
          ],
          woman: [
            { n: '1', foot: 'R', x: 168, y: 236, rot: 180, beats: 2, label: 'Right back, slow' },
            { n: '2', foot: 'L', x: 122, y: 168, rot: 0, beats: 2, label: 'Left replace, slow' },
            { n: '3', foot: 'R', x: 210, y: 156, rot: 12, beats: 2, label: 'Right side, slow' },
            { n: '4', foot: 'L', x: 152, y: 166, rot: -6, beats: 2, label: 'Left closes, slow' },
          ],
        },
        {
          id: 'drag',
          name: 'Slow drag',
          steps: [
            { n: '1', foot: 'L', x: 124, y: 72, rot: 0, beats: 2, label: 'Left forward, slow' },
            { n: '2', foot: 'R', x: 148, y: 128, rot: 0, beats: 2, label: 'Right drags in' },
            { n: '3', foot: 'R', x: 168, y: 64, rot: 4, beats: 2, label: 'Right forward, slow' },
            { n: '4', foot: 'L', x: 140, y: 122, rot: 0, beats: 2, label: 'Left drags in' },
          ],
          woman: [
            { n: '1', foot: 'R', x: 156, y: 258, rot: 180, beats: 2, label: 'Right back, slow' },
            { n: '2', foot: 'L', x: 132, y: 204, rot: 180, beats: 2, label: 'Left drags in' },
            { n: '3', foot: 'L', x: 112, y: 266, rot: 176, beats: 2, label: 'Left back, slow' },
            { n: '4', foot: 'R', x: 140, y: 210, rot: 180, beats: 2, label: 'Right drags in' },
          ],
        },
        {
          id: 'inside',
          name: 'Inside turn',
          steps: [
            { n: '1', foot: 'L', x: 118, y: 232, rot: 180, beats: 2, label: 'Left back, slow' },
            { n: '2', foot: 'R', x: 156, y: 170, rot: 0, beats: 2, label: 'Right replace, slow' },
            { n: '3', foot: 'L', x: 96, y: 158, rot: -8, beats: 2, label: 'Left leads' },
            { n: '4', foot: 'R', x: 142, y: 164, rot: 0, beats: 2, label: 'Right in place' },
            { n: '5', foot: 'L', x: 118, y: 152, rot: 0, beats: 2, label: 'Left in place' },
            { n: '6', foot: 'R', x: 154, y: 156, rot: 0, beats: 2, label: 'Right faces partner' },
          ],
          woman: [
            { n: '1', foot: 'R', x: 164, y: 236, rot: 180, beats: 2, label: 'Right back, slow' },
            { n: '2', foot: 'L', x: 128, y: 172, rot: 0, beats: 2, label: 'Left replace, slow' },
            { n: '3', foot: 'R', x: 148, y: 108, rot: 70, beats: 2, label: 'Right turn', turn: true },
            { n: '4', foot: 'L', x: 196, y: 156, rot: 170, beats: 2, label: 'Left around', turn: true },
            { n: '5', foot: 'R', x: 150, y: 214, rot: 260, beats: 2, label: 'Right completes', turn: true },
            { n: '6', foot: 'L', x: 122, y: 158, rot: 0, beats: 2, label: 'Left faces partner' },
          ],
        },
      ],
    },
    {
      id: 'rock',
      name: "Rock 'n' Roll",
      meter: '4/4',
      bpm: 168,
      music: 'rock',
      figures: [
        {
          id: 'basic',
          name: 'Basic',
          steps: [
            { n: '1', foot: 'L', x: 112, y: 248, rot: 180, beats: 1, label: 'Left back' },
            { n: '2', foot: 'R', x: 158, y: 176, rot: 0, beats: 1, label: 'Right replace' },
            { n: '3', foot: 'L', x: 72, y: 158, rot: -14, beats: 0.5, label: 'Left side' },
            { n: '&', foot: 'R', x: 116, y: 166, rot: 8, beats: 0.5, label: 'Right closes' },
            { n: '4', foot: 'L', x: 96, y: 148, rot: 0, beats: 1, label: 'Left in place' },
            { n: '5', foot: 'R', x: 206, y: 158, rot: 14, beats: 0.5, label: 'Right side' },
            { n: '&', foot: 'L', x: 160, y: 166, rot: -8, beats: 0.5, label: 'Left closes' },
            { n: '6', foot: 'R', x: 168, y: 150, rot: 0, beats: 1, label: 'Right in place' },
          ],
          woman: [
            { n: '1', foot: 'R', x: 168, y: 248, rot: 180, beats: 1, label: 'Right back' },
            { n: '2', foot: 'L', x: 122, y: 176, rot: 0, beats: 1, label: 'Left replace' },
            { n: '3', foot: 'R', x: 208, y: 158, rot: 14, beats: 0.5, label: 'Right side' },
            { n: '&', foot: 'L', x: 164, y: 166, rot: -8, beats: 0.5, label: 'Left closes' },
            { n: '4', foot: 'R', x: 184, y: 148, rot: 0, beats: 1, label: 'Right in place' },
            { n: '5', foot: 'L', x: 74, y: 158, rot: -14, beats: 0.5, label: 'Left side' },
            { n: '&', foot: 'R', x: 120, y: 166, rot: 8, beats: 0.5, label: 'Right closes' },
            { n: '6', foot: 'L', x: 112, y: 150, rot: 0, beats: 1, label: 'Left in place' },
          ],
        },
        {
          id: 'underarm',
          name: 'Underarm turn',
          steps: [
            { n: '1', foot: 'L', x: 118, y: 240, rot: 180, beats: 1, label: 'Left back' },
            { n: '2', foot: 'R', x: 156, y: 176, rot: 0, beats: 1, label: 'Right replace' },
            { n: '3', foot: 'L', x: 108, y: 160, rot: -8, beats: 0.5, label: 'Left leads' },
            { n: '&', foot: 'R', x: 140, y: 166, rot: 4, beats: 0.5, label: 'Right closes' },
            { n: '4', foot: 'L', x: 124, y: 152, rot: 0, beats: 1, label: 'Left in place' },
            { n: '5', foot: 'R', x: 176, y: 160, rot: 8, beats: 0.5, label: 'Right side' },
            { n: '&', foot: 'L', x: 142, y: 168, rot: -4, beats: 0.5, label: 'Left closes' },
            { n: '6', foot: 'R', x: 158, y: 154, rot: 0, beats: 1, label: 'Right faces partner' },
          ],
          woman: [
            { n: '1', foot: 'R', x: 164, y: 244, rot: 180, beats: 1, label: 'Right back' },
            { n: '2', foot: 'L', x: 128, y: 176, rot: 0, beats: 1, label: 'Left replace' },
            { n: '3', foot: 'R', x: 150, y: 108, rot: 50, beats: 0.5, label: 'Right turn', turn: true },
            { n: '&', foot: 'L', x: 196, y: 150, rot: 140, beats: 0.5, label: 'Left around', turn: true },
            { n: '4', foot: 'R', x: 154, y: 210, rot: 230, beats: 1, label: 'Right completes', turn: true },
            { n: '5', foot: 'L', x: 96, y: 168, rot: 10, beats: 0.5, label: 'Left side' },
            { n: '&', foot: 'R', x: 140, y: 174, rot: 0, beats: 0.5, label: 'Right closes' },
            { n: '6', foot: 'L', x: 122, y: 156, rot: 0, beats: 1, label: 'Left faces partner' },
          ],
        },
        {
          id: 'change',
          name: 'Change of places',
          steps: [
            { n: '1', foot: 'L', x: 124, y: 246, rot: 180, beats: 1, label: 'Left back' },
            { n: '2', foot: 'R', x: 156, y: 180, rot: 0, beats: 1, label: 'Right replace' },
            { n: '3', foot: 'L', x: 96, y: 96, rot: -18, beats: 0.5, label: 'Left passes' },
            { n: '&', foot: 'R', x: 52, y: 132, rot: -8, beats: 0.5, label: 'Right across' },
            { n: '4', foot: 'L', x: 44, y: 188, rot: 8, beats: 1, label: 'Left arrives' },
            { n: '5', foot: 'R', x: 96, y: 168, rot: 6, beats: 0.5, label: 'Right toward partner' },
            { n: '&', foot: 'L', x: 68, y: 176, rot: -4, beats: 0.5, label: 'Left closes' },
            { n: '6', foot: 'R', x: 108, y: 156, rot: 0, beats: 1, label: 'Right faces partner' },
          ],
          woman: [
            { n: '1', foot: 'R', x: 156, y: 246, rot: 180, beats: 1, label: 'Right back' },
            { n: '2', foot: 'L', x: 124, y: 180, rot: 0, beats: 1, label: 'Left replace' },
            { n: '3', foot: 'R', x: 184, y: 96, rot: 18, beats: 0.5, label: 'Right passes' },
            { n: '&', foot: 'L', x: 228, y: 132, rot: 8, beats: 0.5, label: 'Left across' },
            { n: '4', foot: 'R', x: 236, y: 188, rot: -8, beats: 1, label: 'Right arrives' },
            { n: '5', foot: 'L', x: 184, y: 168, rot: -6, beats: 0.5, label: 'Left toward partner' },
            { n: '&', foot: 'R', x: 212, y: 176, rot: 4, beats: 0.5, label: 'Right closes' },
            { n: '6', foot: 'L', x: 172, y: 156, rot: 0, beats: 1, label: 'Left faces partner' },
          ],
        },
        {
          id: 'spin',
          name: 'American spin',
          steps: [
            { n: '1', foot: 'L', x: 118, y: 240, rot: 180, beats: 1, label: 'Left back' },
            { n: '2', foot: 'R', x: 156, y: 176, rot: 0, beats: 1, label: 'Right replace' },
            { n: '3', foot: 'L', x: 100, y: 162, rot: -10, beats: 0.5, label: 'Left side' },
            { n: '&', foot: 'R', x: 136, y: 168, rot: 4, beats: 0.5, label: 'Right closes' },
            { n: '4', foot: 'L', x: 118, y: 152, rot: 0, beats: 1, label: 'Left in place' },
            { n: '5', foot: 'R', x: 168, y: 160, rot: 0, beats: 0.5, label: 'Right in place' },
            { n: '&', foot: 'L', x: 140, y: 166, rot: 0, beats: 0.5, label: 'Left closes' },
            { n: '6', foot: 'R', x: 156, y: 154, rot: 0, beats: 1, label: 'Right faces partner' },
          ],
          woman: [
            { n: '1', foot: 'R', x: 164, y: 244, rot: 180, beats: 1, label: 'Right back' },
            { n: '2', foot: 'L', x: 128, y: 176, rot: 0, beats: 1, label: 'Left replace' },
            { n: '3', foot: 'R', x: 196, y: 158, rot: 12, beats: 0.5, label: 'Right side' },
            { n: '&', foot: 'L', x: 158, y: 166, rot: -6, beats: 0.5, label: 'Left closes' },
            { n: '4', foot: 'R', x: 176, y: 150, rot: 0, beats: 1, label: 'Right in place' },
            { n: '5', foot: 'R', x: 156, y: 146, rot: 30, beats: 0.5, label: 'Right spin', turn: true },
            { n: '&', foot: 'L', x: 128, y: 182, rot: 150, beats: 0.5, label: 'Left around', turn: true },
            { n: '6', foot: 'R', x: 162, y: 160, rot: 250, beats: 1, label: 'Right faces partner', turn: true },
          ],
        },
      ],
    },
  ];

  function variationSteps(source, points, labels, turns) {
    return source.map((step, index) => {
      const point = points[index] || points[points.length - 1] || [step.x, step.y, step.rot || 0];
      return {
        ...step,
        x: point[0],
        y: point[1],
        rot: point[2] || 0,
        label: labels[index] || step.label,
        turn: Boolean(turns?.includes(index)),
      };
    });
  }

  function addDanceFigures(id, figures) {
    const dance = DANCES.find((item) => item.id === id);
    if (!dance || dance.figures?.length) return;
    dance.figures = [{ id: 'basic', name: 'Basic', steps: dance.steps }, ...figures];
    delete dance.steps;
  }

  addDanceFigures('rumba', [
    {
      id: 'newyork',
      name: 'New York',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'rumba').steps,
        [[94, 84, -28], [154, 162, 0], [76, 158, -8], [188, 84, 28], [126, 164, 0], [204, 158, 8]],
        ['Left check', 'Right replace', 'Left side, slow', 'Right check', 'Left replace', 'Right side, slow'],
      ),
    },
    {
      id: 'spot',
      name: 'Spot turn',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'rumba').steps,
        [[116, 92, -25], [180, 134, -115], [154, 204, -205], [164, 236, 205], [102, 190, 115], [128, 150, 0]],
        ['Left starts turn', 'Right around', 'Left completes, slow', 'Right starts turn', 'Left around', 'Right faces partner, slow'],
        [0, 1, 2, 3, 4],
      ),
    },
  ]);

  addDanceFigures('salsa', [
    {
      id: 'right-turn',
      name: 'Right turn',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'salsa').steps,
        [[116, 82, 0], [174, 142, 55], [198, 198, 130], [166, 222, 190], [116, 204, 245], [88, 150, 310], [126, 138, 360], [140, 160, 0]],
        ['Left forward', 'Right starts turn', 'Left around', 'Hold turn', 'Right continues', 'Left around', 'Right faces partner', 'Hold'],
        [1, 2, 3, 4, 5, 6],
      ),
    },
    {
      id: 'cross-body',
      name: 'Cross-body lead',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'salsa').steps,
        [[120, 82, 0], [160, 154, 0], [118, 162, 0], [140, 170, 0], [190, 226, 155], [218, 158, 90], [176, 98, 25], [148, 92, 0]],
        ['Left opens', 'Right replace', 'Left clears path', 'Hold', 'Right passes', 'Left crosses', 'Right arrives', 'Hold'],
        [4, 5, 6],
      ),
    },
  ]);

  addDanceFigures('waltz', [
    {
      id: 'left-turn',
      name: 'Left turn',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'waltz').steps,
        [[120, 78, -15], [190, 120, -55], [178, 182, -95], [154, 254, 165], [82, 210, 125], [98, 146, 80]],
        ['Left forward turning', 'Right side', 'Left closes', 'Right back turning', 'Left side', 'Right closes'],
        [0, 1, 2, 3, 4, 5],
      ),
    },
    {
      id: 'underarm',
      name: 'Underarm turn',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'waltz').steps,
        [[122, 82, 0], [172, 132, 10], [142, 150, 0], [166, 244, 180], [116, 198, 170], [140, 166, 180]],
        ['Left leads forward', 'Right side', 'Left closes', 'Right back', 'Left side', 'Right faces partner'],
      ),
      woman: variationSteps(
        DANCES.find((item) => item.id === 'waltz').steps.map((step) => ({
          ...step,
          foot: step.foot === 'L' ? 'R' : 'L',
        })),
        [[160, 238, 180], [112, 198, 130], [92, 142, 70], [132, 88, 10], [188, 126, -55], [154, 170, -180]],
        ['Right back', 'Left starts turn', 'Right around', 'Left continues', 'Right side', 'Left faces partner'],
        [1, 2, 3, 4, 5],
      ),
    },
  ]);

  addDanceFigures('tango', [
    {
      id: 'promenade',
      name: 'Promenade',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'tango').steps,
        [[96, 82, -25], [142, 126, -25], [188, 158, -18], [146, 172, 0]],
        ['Left promenade, slow', 'Right promenade, slow', 'Left side, quick', 'Right closes, quick'],
      ),
    },
    {
      id: 'rock-turn',
      name: 'Rock turn',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'tango').steps,
        [[116, 82, -15], [174, 142, 55], [194, 202, 135], [150, 174, 180]],
        ['Left rock forward, slow', 'Right recover turning, slow', 'Left side, quick', 'Right closes, quick'],
        [1, 2, 3],
      ),
    },
  ]);

  addDanceFigures('foxtrot', [
    {
      id: 'progressive',
      name: 'Progressive',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'foxtrot').steps,
        [[118, 62, -6], [154, 120, 2], [192, 162, 12], [152, 172, 2]],
        ['Left forward, slow', 'Right forward, slow', 'Left diagonal, quick', 'Right closes, quick'],
      ),
    },
    {
      id: 'promenade',
      name: 'Promenade',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'foxtrot').steps,
        [[92, 80, -28], [132, 128, -25], [184, 158, -18], [146, 170, 0]],
        ['Left promenade, slow', 'Right promenade, slow', 'Left side, quick', 'Right closes, quick'],
      ),
    },
  ]);

  addDanceFigures('discofox', [
    {
      id: 'underarm',
      name: 'Underarm turn',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'discofox').steps,
        [[92, 164, -8], [138, 166, 0], [174, 154, 8], [148, 166, 0]],
        ['Left leads, slow', 'Right closes, slow', 'Left side, quick', 'Right faces partner, quick'],
      ),
      woman: variationSteps(
        DANCES.find((item) => item.id === 'discofox').steps.map((step) => ({
          ...step,
          foot: step.foot === 'L' ? 'R' : 'L',
        })),
        [[188, 218, 180], [142, 174, 110], [104, 132, 35], [142, 158, 0]],
        ['Right back, slow', 'Left starts turn, slow', 'Right around, quick', 'Left faces partner, quick'],
        [1, 2, 3],
      ),
    },
    {
      id: 'change',
      name: 'Change of places',
      steps: variationSteps(
        DANCES.find((item) => item.id === 'discofox').steps,
        [[116, 230, 180], [158, 172, 0], [82, 108, -18], [48, 158, 0]],
        ['Left back, slow', 'Right replace, slow', 'Left passes, quick', 'Right arrives, quick'],
      ),
      woman: variationSteps(
        DANCES.find((item) => item.id === 'discofox').steps.map((step) => ({
          ...step,
          foot: step.foot === 'L' ? 'R' : 'L',
        })),
        [[164, 230, 180], [122, 172, 0], [198, 108, 18], [232, 158, 0]],
        ['Right back, slow', 'Left replace, slow', 'Right passes, quick', 'Left arrives, quick'],
      ),
    },
  ]);

  const BY_ID = Object.fromEntries(DANCES.map((dance) => [dance.id, dance]));

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseFenceAttrs(raw) {
    const cfg = {};
    String(raw || '').split(';').forEach((part) => {
      const piece = part.trim();
      if (!piece) return;
      const eq = piece.indexOf('=');
      if (eq === -1) {
        cfg[piece.toLowerCase()] = '1';
        return;
      }
      const key = piece.slice(0, eq).trim().toLowerCase();
      let value = piece.slice(eq + 1).trim();
      value = value.replace(/^(['"])(.*)\1$/, '$2');
      cfg[key] = value;
    });
    return cfg;
  }

  function resolveDanceId(cfg) {
    const raw = String(cfg?.dance || cfg?.style || 'rumba').trim().toLowerCase();
    if (raw === 'waltzer' || raw === 'walzer') return 'waltz';
    if (raw === 'foxtrott' || raw === 'fox-trot' || raw === 'foxtrott') return 'foxtrot';
    if (raw === 'discofox' || raw === 'disco-fox' || raw === 'disco fox') return 'discofox';
    const compact = raw.replace(/[\s'"’\-]+/g, '');
    if (compact === 'rocknroll' || compact === 'rockandroll' || raw === 'rock' || raw === 'jive') return 'rock';
    if (compact === 'blues' || compact === 'slowblues') return 'blues';
    if (compact === 'chacha' || compact === 'chachacha') return 'chacha';
    return BY_ID[raw] ? raw : 'rumba';
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function figuresOf(dance) {
    if (dance?.figures?.length) return dance.figures;
    return [{ id: 'basic', name: 'Basic', steps: dance?.steps || [] }];
  }

  function activeFigure(dance, figureId) {
    const figures = figuresOf(dance);
    return figures.find((figure) => figure.id === figureId) || figures[0];
  }

  function partnerSteps(figure, role) {
    const steps = figure?.steps || [];
    if (role === 'woman' && figure?.woman?.length === steps.length) return figure.woman;
    if (role === 'woman') return steps.map(womanStep);
    return steps;
  }

  function stepRange(session, count) {
    const last = Math.max(0, count - 1);
    const from = clamp(Number(session.loopFrom) || 0, 0, last);
    const to = session.loopTo == null ? last : clamp(Number(session.loopTo) || 0, 0, last);
    return to < from ? [to, from] : [from, to];
  }

  function nextStepIndex(session, count) {
    if (!count) return -1;
    const [from, to] = stepRange(session, count);
    const cur = clamp(session.step || 0, 0, count - 1);
    if (cur < from || cur > to) return session.loop ? from : -1;
    if (cur >= to) return session.loop ? from : -1;
    return cur + 1;
  }

  function themeClass(cfg) {
    const theme = String(cfg?.col || cfg?.theme || 'info').trim().toLowerCase();
    return THEMES.includes(theme) ? ` dance-block--${theme}` : ' dance-block--info';
  }

  function mirrorFoot(foot) {
    if (foot === 'L') return 'R';
    if (foot === 'R') return 'L';
    return foot;
  }

  function womanPhrase(label) {
    return String(label || '')
      .replace(/Left/g, '\u0000')
      .replace(/Right/g, 'Left')
      .replace(/\u0000/g, 'Right')
      .replace(/forward/g, '\u0001')
      .replace(/back/g, 'forward')
      .replace(/\u0001/g, 'back');
  }

  function womanStep(step) {
    return {
      ...step,
      foot: mirrorFoot(step.foot),
      x: 280 - step.x,
      y: 340 - step.y,
      rot: ((Number(step.rot) || 0) + 180) % 360,
      label: womanPhrase(step.label),
    };
  }

  function footprintShapes(side, fill) {
    const k = side === 'R' ? -1 : 1;
    const x = (value) => (value * k).toFixed(1);
    const toes = [
      [7.2, -22, 6.2],
      [1.4, -26, 4.2],
      [-3.4, -24.6, 3.6],
      [-7.4, -21.2, 3.1],
      [-10.6, -16.4, 2.7],
    ];
    return [
      `<ellipse cx="${x(-0.4)}" cy="16" rx="8.4" ry="11.2" fill="${fill}"/>`,
      `<path fill="${fill}" d="M${x(-11)} 7 C${x(-14)} -2 ${x(-12)} -12 ${x(-5)} -17 C${x(3)} -21 ${x(14)} -14 ${x(14)} -5 C${x(14)} 3 ${x(7)} 11 ${x(1)} 12 C${x(-5)} 13 ${x(-9)} 11 ${x(-11)} 7 Z"/>`,
      toes.map(([tx, ty, r]) => `<circle cx="${x(tx)}" cy="${ty}" r="${r}" fill="${fill}"/>`).join(''),
    ].join('');
  }

  function footMark(step, active) {
    const fill = active ? '#2bb8c4' : (step.foot === 'L' ? '#3d4758' : '#8b93a3');
    const ink = active ? '#08343a' : '#f7f3ea';
    return [
      `<g class="dance-foot${active ? ' is-current' : ''}" transform="translate(${step.x} ${step.y})" opacity="${active ? 1 : 0.72}">`,
      `<g transform="rotate(${step.rot || 0})">`,
      footprintShapes(step.foot === 'R' ? 'R' : 'L', fill),
      '</g>',
      `<text x="0" y="8" text-anchor="middle" fill="${ink}" font-size="13" font-family="Georgia, serif" font-weight="700">${escapeHtml(step.n)}</text>`,
      '</g>',
    ].join('');
  }

  let arrowSerial = 0;

  function angDelta(from, to) {
    return ((((Number(to) || 0) - (Number(from) || 0)) + 540) % 360) - 180;
  }

  function directionArrow(from, to, role) {
    if (!from || !to) return '';
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    let x1;
    let y1;
    let x2;
    let y2;
    let curved = false;
    if (len >= 18) {
      x1 = from.x + ux * 26;
      y1 = from.y + uy * 26;
      x2 = to.x - ux * 30;
      y2 = to.y - uy * 30;
      curved = Boolean(to.turn) || Math.abs(angDelta(from.rot, to.rot)) > 70;
    } else {
      const rad = ((Number(to.rot) || 0) * Math.PI) / 180;
      const fx = Math.sin(rad);
      const fy = -Math.cos(rad);
      x1 = to.x - fx * 6;
      y1 = to.y - fy * 6;
      x2 = to.x + fx * 36;
      y2 = to.y + fy * 36;
    }
    const mx = (x1 + x2) / 2 - uy * 28;
    const my = (y1 + y2) / 2 + ux * 28;
    const d = curved
      ? `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
      : `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    const id = `dance-arrow-${role}-${arrowSerial}`;
    arrowSerial += 1;
    return [
      `<defs><marker id="${id}" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">`,
      '<path d="M0 0 L7 3.5 L0 7 Z" fill="#e25b2a"/></marker></defs>',
      `<path class="dance-arrow" d="${d}" fill="none" stroke="#e25b2a" stroke-width="4" stroke-linecap="round" marker-end="url(#${id})"/>`,
    ].join('');
  }

  function floorSvg(steps, stepIndex, nextIndex, role, danceName) {
    const step = steps[stepIndex] || steps[0];
    const next = nextIndex >= 0 ? steps[nextIndex] : null;
    const who = role === 'woman' ? 'Woman' : 'Man';
    const marks = steps.map((item, index) => {
      if (item.hold) return '';
      return footMark(item, index === stepIndex);
    }).join('');
    const holdFeet = step?.hold
      ? [
        footMark({ ...step, foot: 'L', x: step.x - 36, y: step.y, n: step.n }, true),
        footMark({ ...step, foot: 'R', x: step.x + 36, y: step.y, n: step.n }, true),
      ].join('')
      : '';
    const nextLabel = next ? `, next ${next.label}` : ', end of sequence';
    return [
      '<svg class="dance-floor" viewBox="0 0 280 340" role="img"',
      ` aria-label="${escapeHtml(who)} ${escapeHtml(danceName)} footprint ${escapeHtml(step?.n || '')}, ${escapeHtml(step?.label || '')}${escapeHtml(nextLabel)}">`,
      '<rect x="6" y="6" width="268" height="328" rx="28" fill="#f6f1e7"/>',
      '<ellipse cx="140" cy="170" rx="112" ry="142" fill="#efe8da"/>',
      marks,
      holdFeet,
      next ? directionArrow(step, next, role) : '',
      '</svg>',
    ].join('');
  }

  function boardsHtml(dance, figure, stepIndex, nextIndex) {
    const man = partnerSteps(figure, 'man');
    const woman = partnerSteps(figure, 'woman');
    return [
      '<div class="dance-boards">',
      '<figure class="dance-board">',
      '<figcaption>Man</figcaption>',
      floorSvg(man, stepIndex, nextIndex, 'man', dance.name),
      '</figure>',
      '<figure class="dance-board">',
      '<figcaption>Woman</figcaption>',
      floorSvg(woman, stepIndex, nextIndex, 'woman', dance.name),
      '</figure>',
      '</div>',
    ].join('');
  }

  function renderBlock(_source, fenceAttrs) {
    const cfg = parseFenceAttrs(fenceAttrs);
    const danceId = resolveDanceId(cfg);
    const title = String(cfg.title || 'Dance').trim() || 'Dance';
    const fullscreen = window.NotesProGameFullscreen?.renderButton?.() || '';
    const tabs = DANCES.map((dance) => (
      `<button type="button" class="dance-tab${dance.id === danceId ? ' is-on' : ''}" data-dance="${dance.id}">${escapeHtml(dance.name)}</button>`
    )).join('');
    return [
      `<div class="dance-block${themeClass(cfg)}" data-dance="${danceId}" tabindex="0">`,
      '<div class="dance-head">',
      `<div class="dance-title">${escapeHtml(title)}</div>`,
      fullscreen,
      '</div>',
      `<div class="dance-tabs" role="tablist">${tabs}</div>`,
      '<div class="dance-figures" hidden></div>',
      '<div class="dance-stage"></div>',
      '<p class="dance-swipe-hint">Swipe the floor for the next step</p>',
      '<div class="dance-caption"></div>',
      '<div class="dance-tools">',
      '<div class="dance-bpm">',
      '<button type="button" data-action="bpm-down" aria-label="Slower">−</button>',
      '<input type="range" data-action="bpm" min="40" max="200" step="1" value="104" aria-label="Tempo in beats per minute">',
      '<button type="button" data-action="bpm-up" aria-label="Faster">+</button>',
      '<span class="dance-bpm-value">104</span>',
      '</div>',
      '<button type="button" class="dance-loop is-on" data-action="loop" aria-pressed="true">Loop</button>',
      '<label class="dance-loop-range">From <select data-action="loop-from" aria-label="Loop from step"></select></label>',
      '<label class="dance-loop-range">To <select data-action="loop-to" aria-label="Loop to step"></select></label>',
      '</div>',
      '<div class="dance-controls">',
      '<button type="button" data-action="prev">Prev</button>',
      '<button type="button" data-action="toggle">Play</button>',
      '<button type="button" data-action="next">Next</button>',
      '</div>',
      '</div>',
    ].join('');
  }

  function midi(note) {
    return 440 * (2 ** ((note - 69) / 12));
  }

  function ensureNoise(ctx, state) {
    if (state.noise) return state.noise;
    const length = Math.floor(ctx.sampleRate * 0.2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    state.noise = buffer;
    return buffer;
  }

  function tone(ctx, master, time, freq, dur, gain, type, filterFreq) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq || 1600, time);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    osc.start(time);
    osc.stop(time + dur + 0.03);
  }

  function noiseHit(ctx, master, state, time, dur, gain, highpass) {
    const src = ctx.createBufferSource();
    src.buffer = ensureNoise(ctx, state);
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(highpass || 5000, time);
    amp.gain.setValueAtTime(gain, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    src.start(time);
    src.stop(time + dur + 0.02);
  }

  function kick(ctx, master, time, gain) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(48, time + 0.08);
    amp.gain.setValueAtTime(gain, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    osc.connect(amp);
    amp.connect(master);
    osc.start(time);
    osc.stop(time + 0.18);
  }

  function chord(ctx, master, time, notes, dur, gain, type) {
    notes.forEach((note) => tone(ctx, master, time, midi(note), dur, gain, type || 'triangle', 1400));
  }

  function playBeat(ctx, master, state, dance, beatIndex, time) {
    const beatDur = 60 / dance.bpm;
    const beat = beatIndex % 4;
    const bar = Math.floor(beatIndex / (dance.music === 'waltz' ? 3 : 4));
    if (dance.music === 'waltz') {
      const slot = beatIndex % 3;
      const roots = [48, 43, 45, 41];
      const chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]];
      const melody = [64, 67, 72, 74, 71, 67, 69, 72, 76, 74, 71, 67];
      if (slot === 0) {
        tone(ctx, master, time, midi(roots[bar % 4] - 12), beatDur * 0.9, 0.22, 'sine', 400);
        kick(ctx, master, time, 0.2);
      } else {
        chord(ctx, master, time, chords[bar % 4], beatDur * 0.7, 0.06, 'triangle');
      }
      tone(ctx, master, time, midi(melody[beatIndex % melody.length]), beatDur * 0.85, 0.07, 'sine', 2200);
      return;
    }
    if (dance.music === 'rumba') {
      if (beat === 0 || beat === 2) tone(ctx, master, time, midi(beat === 0 ? 45 : 40), beatDur * 0.7, 0.16, 'sine', 360);
      noiseHit(ctx, master, state, time, 0.04, 0.04, 7000);
      noiseHit(ctx, master, state, time + beatDur * 0.5, 0.03, 0.03, 6500);
      if (beat === 1 || beat === 3) chord(ctx, master, time, beat === 1 ? [57, 60, 64] : [52, 55, 59], beatDur * 0.45, 0.045, 'triangle');
      if (beatIndex % 8 === 0) tone(ctx, master, time, midi(69), beatDur * 1.4, 0.05, 'sine', 1800);
      if (beatIndex % 8 === 3) tone(ctx, master, time, midi(72), beatDur, 0.045, 'sine', 1800);
      return;
    }
    if (dance.music === 'chacha') {
      const notes = [48, 51, 55, 53];
      tone(ctx, master, time, midi(notes[beatIndex % notes.length]), beatDur * 0.7, beat === 0 ? 0.16 : 0.1, 'triangle', 500);
      noiseHit(ctx, master, state, time, 0.04, 0.04, 5000);
      noiseHit(ctx, master, state, time + beatDur * 0.5, 0.035, 0.045, 2800);
      if (beat === 0) kick(ctx, master, time, 0.16);
      if (beat === 3) tone(ctx, master, time, midi(76), 0.08, 0.06, 'square', 2200);
      return;
    }
    if (dance.music === 'salsa') {
      const pos = beatIndex % 8;
      if (pos === 0 || pos === 3 || pos === 5 || pos === 6) {
        tone(ctx, master, time, midi(84), 0.06, 0.08, 'square', 2400);
      }
      if (pos === 1) tone(ctx, master, time + beatDur * 0.5, midi(84), 0.05, 0.07, 'square', 2400);
      if (pos === 0 || pos === 3 || pos === 4 || pos === 7) {
        tone(ctx, master, time, midi(pos === 0 || pos === 4 ? 36 : 43), 0.18, 0.14, 'sine', 300);
      }
      noiseHit(ctx, master, state, time, 0.03, 0.035, 6200);
      if (pos % 2 === 1) chord(ctx, master, time, [60, 64, 67, 72], 0.12, 0.035, 'triangle');
      return;
    }
    if (dance.music === 'tango') {
      const bass = [38, 38, 36, 33, 41, 40, 38, 33];
      kick(ctx, master, time, beat === 0 ? 0.28 : 0.12);
      tone(ctx, master, time, midi(bass[beatIndex % bass.length]), 0.12, 0.16, 'sawtooth', 500);
      chord(ctx, master, time, [50, 53, 57], 0.1, beat === 0 ? 0.06 : 0.035, 'sawtooth');
      if (beat === 1 || beat === 3) {
        tone(ctx, master, time + beatDur * 0.5, midi(74), 0.08, 0.04, 'square', 1800);
      }
      return;
    }
    if (dance.music === 'foxtrot') {
      const walk = [46, 48, 50, 51, 53, 55, 57, 58];
      tone(ctx, master, time, midi(walk[beatIndex % walk.length]), beatDur * 0.85, 0.12, 'triangle', 700);
      noiseHit(ctx, master, state, time, 0.05, 0.03, 4000);
      noiseHit(ctx, master, state, time + beatDur * 0.66, 0.04, 0.02, 4500);
      if (beat === 0 || beat === 2) chord(ctx, master, time, beat === 0 ? [58, 62, 65] : [53, 58, 62], beatDur, 0.04, 'triangle');
      const melody = [65, 67, 69, 70, 72, 69, 67, 65];
      tone(ctx, master, time, midi(melody[beatIndex % melody.length]), beatDur * 0.7, 0.05, 'sine', 2000);
      return;
    }
    if (dance.music === 'blues') {
      const walk = [45, 48, 50, 51, 52, 51, 50, 48];
      tone(ctx, master, time, midi(walk[beatIndex % walk.length]), beatDur * 0.9, 0.14, 'triangle', 500);
      if (beat === 0) kick(ctx, master, time, 0.16);
      if (beat === 1 || beat === 3) noiseHit(ctx, master, state, time, 0.05, 0.05, 1600);
      if (beatIndex % 8 === 0) chord(ctx, master, time, [52, 55, 59], beatDur * 1.4, 0.04, 'triangle');
      return;
    }
    if (dance.music === 'rock') {
      kick(ctx, master, time, beat === 0 || beat === 2 ? 0.3 : 0.08);
      if (beat === 1 || beat === 3) noiseHit(ctx, master, state, time, 0.08, 0.08, 1800);
      tone(ctx, master, time, midi(beat % 2 === 0 ? 40 : 45), 0.12, 0.14, 'sawtooth', 480);
      noiseHit(ctx, master, state, time + beatDur * 0.5, 0.04, 0.04, 6000);
      return;
    }
    kick(ctx, master, time, 0.32);
    noiseHit(ctx, master, state, time + beatDur * 0.5, 0.08, 0.05, 5000);
    if (beat === 1 || beat === 3) noiseHit(ctx, master, state, time, 0.06, 0.06, 1800);
    const bassNote = beat === 0 || beat === 1 ? 41 : 36;
    tone(ctx, master, time, midi(bassNote), 0.16, 0.16, 'sawtooth', 420);
    tone(ctx, master, time + beatDur * 0.5, midi(bassNote + 12), 0.1, 0.08, 'square', 600);
    if (beat === 1) chord(ctx, master, time + beatDur * 0.5, [65, 69, 72], 0.16, 0.05, 'sawtooth');
  }

  const SAMPLE_NAMES = ['kick', 'snare', 'hat', 'shaker', 'clave', 'wood', 'bass', 'stab'];
  const sampleCaches = new WeakMap();

  function sampleUrl(name) {
    const base = (typeof window !== 'undefined' && window.APP_BASE)
      ? String(window.APP_BASE).replace(/\/$/, '')
      : '';
    return `${base}/static/notes/dance/audio/${name}.wav`;
  }

  function loadSamples(ctx) {
    const existing = sampleCaches.get(ctx);
    if (existing) return existing;
    const pending = Promise.all(SAMPLE_NAMES.map(async (name) => {
      const response = await fetch(sampleUrl(name));
      if (!response.ok) throw new Error(name);
      const audio = await response.arrayBuffer();
      const decoded = await ctx.decodeAudioData(audio.slice(0));
      return [name, decoded];
    })).then((pairs) => Object.fromEntries(pairs)).catch((error) => {
      sampleCaches.delete(ctx);
      throw error;
    });
    sampleCaches.set(ctx, pending);
    return pending;
  }

  function hit(ctx, master, buffer, time, gainValue, rate) {
    if (!buffer || !ctx) return;
    const src = ctx.createBufferSource();
    const amp = ctx.createGain();
    src.buffer = buffer;
    src.playbackRate.setValueAtTime(rate || 1, time);
    amp.gain.setValueAtTime(gainValue, time);
    src.connect(amp);
    amp.connect(master);
    src.start(time);
  }

  function bassRate(note) {
    return midi(note) / 55;
  }

  function sampleBeat(ctx, master, samples, dance, beatIndex, time, offbeat) {
    const beat = beatIndex % 4;
    const music = dance.music;
    if (offbeat) {
      if (music === 'salsa' && beat === 1) hit(ctx, master, samples.clave, time, 0.22, 1);
      else if (music === 'tango' && (beat === 1 || beat === 3)) hit(ctx, master, samples.wood, time, 0.16, 1.15);
      else if (music === 'waltz') hit(ctx, master, samples.hat, time, 0.04, 1.2);
      else if (music === 'rumba' || music === 'foxtrot') hit(ctx, master, samples.shaker, time, 0.12, 1);
      else if (music === 'chacha') hit(ctx, master, samples.wood, time, 0.16, 1.25);
      else if (music === 'blues') hit(ctx, master, samples.hat, time, 0.04, 0.85);
      else hit(ctx, master, samples.hat, time, music === 'rock' || music === 'disco' ? 0.14 : 0.08, 1);
      return;
    }
    if (music === 'waltz') {
      const slot = beatIndex % 3;
      const roots = [48, 43, 45, 41];
      if (slot === 0) {
        hit(ctx, master, samples.kick, time, 0.55, 1);
        hit(ctx, master, samples.bass, time, 0.7, bassRate(roots[Math.floor(beatIndex / 3) % 4]));
      } else {
        hit(ctx, master, samples.stab, time, 0.28, 1);
      }
      hit(ctx, master, samples.wood, time, slot === 0 ? 0.12 : 0.08, 1);
      return;
    }
    if (music === 'rumba') {
      if (beat === 0 || beat === 2) hit(ctx, master, samples.bass, time, 0.55, bassRate(beat === 0 ? 45 : 40));
      hit(ctx, master, samples.shaker, time, 0.16, 1);
      if (beat === 1 || beat === 3) hit(ctx, master, samples.stab, time, 0.22, 1);
      if (beatIndex % 8 === 0 || beatIndex % 8 === 3) hit(ctx, master, samples.wood, time, 0.1, 1.4);
      return;
    }
    if (music === 'chacha') {
      const notes = [48, 51, 55, 53, 48, 51, 58, 55];
      hit(ctx, master, samples.bass, time, beat === 0 ? 0.55 : 0.36, bassRate(notes[beatIndex % notes.length]));
      hit(ctx, master, samples.shaker, time, 0.14, 1);
      if (beat === 0) hit(ctx, master, samples.kick, time, 0.28, 1);
      if (beat === 3) hit(ctx, master, samples.wood, time, 0.22, 1.1);
      if (beat === 0 || beat === 2) hit(ctx, master, samples.stab, time, 0.1, 1);
      return;
    }
    if (music === 'salsa') {
      const pos = beatIndex % 8;
      if (pos === 0 || pos === 3 || pos === 5 || pos === 6) hit(ctx, master, samples.clave, time, 0.24, 1);
      if (pos === 0 || pos === 3 || pos === 4 || pos === 7) {
        hit(ctx, master, samples.bass, time, 0.5, bassRate(pos === 0 || pos === 4 ? 36 : 43));
      }
      hit(ctx, master, samples.hat, time, 0.08, 1);
      if (pos % 2 === 1) hit(ctx, master, samples.stab, time, 0.16, 1);
      return;
    }
    if (music === 'tango') {
      const notes = [38, 38, 36, 33, 41, 40, 38, 33];
      hit(ctx, master, samples.kick, time, beat === 0 ? 0.7 : 0.35, 1);
      hit(ctx, master, samples.bass, time, 0.55, bassRate(notes[beatIndex % notes.length]));
      hit(ctx, master, samples.stab, time, beat === 0 ? 0.3 : 0.16, 0.9);
      return;
    }
    if (music === 'foxtrot') {
      const walk = [46, 48, 50, 51, 53, 55, 57, 58];
      hit(ctx, master, samples.bass, time, 0.45, bassRate(walk[beatIndex % walk.length]));
      hit(ctx, master, samples.shaker, time, 0.12, 1);
      if (beat === 0 || beat === 2) hit(ctx, master, samples.stab, time, 0.2, 1);
      hit(ctx, master, samples.wood, time, 0.08, 1.3);
      return;
    }
    if (music === 'blues') {
      const walk = [45, 48, 50, 51, 52, 51, 50, 48];
      hit(ctx, master, samples.bass, time, 0.5, bassRate(walk[beatIndex % walk.length]));
      if (beat === 0) hit(ctx, master, samples.kick, time, 0.32, 0.9);
      if (beat === 1 || beat === 3) hit(ctx, master, samples.snare, time, 0.22, 0.92);
      if (beatIndex % 8 === 0) hit(ctx, master, samples.stab, time, 0.12, 0.8);
      return;
    }
    if (music === 'rock') {
      if (beat === 0 || beat === 2) hit(ctx, master, samples.kick, time, 0.7, 1);
      if (beat === 1 || beat === 3) hit(ctx, master, samples.snare, time, 0.45, 1);
      hit(ctx, master, samples.bass, time, 0.4, bassRate(beat % 2 === 0 ? 40 : 45));
      if (beat === 0) hit(ctx, master, samples.stab, time, 0.18, 1);
      return;
    }
    hit(ctx, master, samples.kick, time, 0.72, 1);
    if (beat === 1 || beat === 3) hit(ctx, master, samples.snare, time, 0.28, 1);
    hit(ctx, master, samples.bass, time, 0.42, bassRate(beat === 0 || beat === 1 ? 41 : 36));
    if (beat === 1) hit(ctx, master, samples.stab, time, 0.2, 1);
  }

  function currentBpm(session, dance) {
    const value = Number(session.bpm);
    if (Number.isFinite(value) && value > 0) return clamp(value, 40, 200);
    return dance.bpm;
  }

  function paint(el, session) {
    const dance = BY_ID[session.danceId] || DANCES[0];
    const figure = activeFigure(dance, session.figureId);
    const manSteps = partnerSteps(figure, 'man');
    const womanSteps = partnerSteps(figure, 'woman');
    const count = manSteps.length;
    session.step = count ? clamp(session.step || 0, 0, count - 1) : 0;
    const nextIndex = nextStepIndex(session, count);
    const step = manSteps[session.step] || manSteps[0];
    const woman = womanSteps[session.step] || womanSteps[0];
    const nextMan = nextIndex >= 0 ? manSteps[nextIndex] : null;
    const nextWoman = nextIndex >= 0 ? womanSteps[nextIndex] : null;
    const stage = el.querySelector('.dance-stage');
    const caption = el.querySelector('.dance-caption');
    if (stage) stage.innerHTML = boardsHtml(dance, figure, session.step, nextIndex);
    if (caption && step) {
      const nextLine = nextMan
        ? `<div class="dance-next">Next · Man ${escapeHtml(nextMan.label)} · Woman ${escapeHtml(nextWoman?.label || '')}</div>`
        : '<div class="dance-next">End of the sequence</div>';
      caption.innerHTML = [
        `<div><b>Man</b> ${escapeHtml(step.n)} · ${escapeHtml(step.label)}</div>`,
        `<div><b>Woman</b> ${escapeHtml(woman?.n || step.n)} · ${escapeHtml(woman?.label || '')}</div>`,
        nextLine,
      ].join('');
    }
    el.querySelectorAll('.dance-tab').forEach((tab) => {
      tab.classList.toggle('is-on', tab.dataset.dance === dance.id);
    });
    const figures = dance.figures || [];
    const figureBox = el.querySelector('.dance-figures');
    if (figureBox) {
      if (figures.length < 2) {
        figureBox.hidden = true;
      } else {
        figureBox.hidden = false;
        const key = figures.map((item) => item.id).join(',');
        if (figureBox.dataset.key !== key) {
          figureBox.dataset.key = key;
          figureBox.innerHTML = figures.map((item) => (
            `<button type="button" class="dance-figure" data-figure="${item.id}">${escapeHtml(item.name)}</button>`
          )).join('');
        }
        const currentId = figure.id;
        figureBox.querySelectorAll('.dance-figure').forEach((button) => {
          button.classList.toggle('is-on', button.dataset.figure === currentId);
        });
      }
    }
    const loopKey = `${dance.id}:${figure.id}:${count}`;
    const fromSel = el.querySelector('[data-action="loop-from"]');
    const toSel = el.querySelector('[data-action="loop-to"]');
    if (fromSel && toSel && el.dataset.loopKey !== loopKey) {
      el.dataset.loopKey = loopKey;
      const options = manSteps.map((item, index) => (
        `<option value="${index}">${index + 1}. ${escapeHtml(item.label)}</option>`
      )).join('');
      fromSel.innerHTML = options;
      toSel.innerHTML = options;
      session.loopFrom = 0;
      session.loopTo = Math.max(0, count - 1);
    }
    const [from, to] = stepRange(session, count);
    if (fromSel && document.activeElement !== fromSel) fromSel.value = String(from);
    if (toSel && document.activeElement !== toSel) toSel.value = String(to);
    const bpm = Math.round(currentBpm(session, dance));
    const bpmInput = el.querySelector('[data-action="bpm"]');
    const bpmValue = el.querySelector('.dance-bpm-value');
    if (bpmInput && document.activeElement !== bpmInput) bpmInput.value = String(bpm);
    if (bpmValue) bpmValue.textContent = `${bpm} · ${dance.meter}`;
    const loopBtn = el.querySelector('[data-action="loop"]');
    if (loopBtn) {
      loopBtn.classList.toggle('is-on', session.loop !== false);
      loopBtn.setAttribute('aria-pressed', session.loop !== false ? 'true' : 'false');
    }
    const toggle = el.querySelector('[data-action="toggle"]');
    if (toggle) toggle.textContent = session.playing ? 'Pause' : 'Play';
  }

  function stopSession(session) {
    session.playing = false;
    if (session.timer) {
      clearInterval(session.timer);
      session.timer = 0;
    }
    session.token += 1;
    if (session.master && session.ctx) {
      const now = session.ctx.currentTime;
      session.master.gain.cancelScheduledValues(now);
      session.master.gain.setValueAtTime(0, now);
    }
  }

  function startSession(el, session, options = {}) {
    const dance = BY_ID[session.danceId] || DANCES[0];
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!session.ctx || session.ctx.state === 'closed') session.ctx = new AudioCtx();
    if (session.ctx.state === 'suspended') session.ctx.resume();
    const keepStep = Boolean(options.keepStep);
    stopSession(session);
    session.playing = true;
    session.draining = false;
    session.danceId = dance.id;
    const master = session.ctx.createGain();
    master.gain.setValueAtTime(0.8, session.ctx.currentTime);
    master.connect(session.ctx.destination);
    session.master = master;
    const token = session.token;
    const figure = activeFigure(dance, session.figureId);
    const steps = partnerSteps(figure, 'man');
    const [from, to] = stepRange(session, steps.length);
    let playStep = keepStep ? clamp(session.step || 0, from, to) : from;
    session.step = playStep;
    paint(el, session);
    const begin = async () => {
      let samples = null;
      try {
        if (session.ctx.state === 'suspended') await session.ctx.resume();
        samples = await loadSamples(session.ctx);
      } catch (_) {
        samples = null;
      }
      if (!session.playing || session.token !== token) return;
      let nextTime = session.ctx.currentTime + 0.06;
      let beatIndex = 0;
      let eighthIndex = 0;
      let intoEighth = 0;
      const tick = () => {
        if (!session.playing || session.token !== token || session.draining) return;
        const eighth = (60 / currentBpm(session, dance)) / 2;
        const horizon = session.ctx.currentTime + 0.14;
        let guard = 0;
        while (nextTime < horizon && guard < 8) {
          guard += 1;
          const onBeat = eighthIndex % 2 === 0;
          if (intoEighth === 0) {
            const show = playStep;
            const when = nextTime;
            window.setTimeout(() => {
              if (!session.playing || session.token !== token) return;
              session.step = show;
              paint(el, session);
            }, Math.max(0, (when - session.ctx.currentTime) * 1000));
          }
          try {
            if (samples) sampleBeat(session.ctx, master, samples, dance, beatIndex, nextTime, !onBeat);
            else if (onBeat) playBeat(session.ctx, master, session, dance, beatIndex, nextTime);
          } catch (error) {
            if (!el.dataset.audioError) el.dataset.audioError = String(error && error.message || error);
          }
          intoEighth += 1;
          const need = Math.max(1, Math.round(((steps[playStep]?.beats || 1) * 2)));
          if (intoEighth >= need) {
            intoEighth = 0;
            const range = stepRange(session, steps.length);
            if (playStep >= range[1]) {
              if (session.loop !== false) playStep = range[0];
              else {
                session.draining = true;
                const when = nextTime + eighth;
                window.setTimeout(() => {
                  if (session.token !== token) return;
                  stopSession(session);
                  paint(el, session);
                }, Math.max(0, (when - session.ctx.currentTime) * 1000));
                return;
              }
            } else {
              playStep += 1;
            }
          }
          if (!onBeat) beatIndex += 1;
          eighthIndex += 1;
          nextTime += eighth;
        }
      };
      session.timer = window.setInterval(tick, 25);
      tick();
    };
    void begin();
  }

  function hydrate(root) {
    (root || document).querySelectorAll('.dance-block').forEach((el) => {
      if (el.dataset.danceHydrated === '1') return;
      el.dataset.danceHydrated = '1';
      window.NotesProGameFullscreen?.bind?.(el);
      const dance0 = BY_ID[el.dataset.dance] ? BY_ID[el.dataset.dance] : DANCES[0];
      const session = {
        danceId: dance0.id,
        figureId: 'basic',
        step: 0,
        playing: false,
        draining: false,
        timer: 0,
        token: 0,
        ctx: null,
        master: null,
        noise: null,
        bpm: dance0.bpm,
        loop: true,
        loopFrom: 0,
        loopTo: null,
      };
      const shift = (dir) => {
        const dance = BY_ID[session.danceId] || DANCES[0];
        const steps = partnerSteps(activeFigure(dance, session.figureId), 'man');
        const [from, to] = stepRange(session, steps.length);
        const span = to - from + 1;
        const cur = clamp(session.step || 0, from, to);
        session.step = from + ((cur - from + dir + span) % span);
        if (session.playing) startSession(el, session, { keepStep: true });
        else paint(el, session);
      };
      const restartIfPlaying = () => {
        const wasPlaying = session.playing;
        stopSession(session);
        session.step = 0;
        session.loopFrom = 0;
        session.loopTo = null;
        el.dataset.loopKey = '';
        paint(el, session);
        if (wasPlaying) startSession(el, session);
      };
      el.addEventListener('click', (event) => {
        const tab = event.target.closest?.('.dance-tab');
        if (tab && el.contains(tab)) {
          const nextId = tab.dataset.dance;
          if (!BY_ID[nextId] || nextId === session.danceId) return;
          session.danceId = nextId;
          session.figureId = 'basic';
          session.bpm = BY_ID[nextId].bpm;
          el.dataset.dance = nextId;
          restartIfPlaying();
          return;
        }
        const figureBtn = event.target.closest?.('.dance-figure');
        if (figureBtn && el.contains(figureBtn)) {
          const nextFigure = figureBtn.dataset.figure;
          if (!nextFigure || nextFigure === session.figureId) return;
          session.figureId = nextFigure;
          restartIfPlaying();
          return;
        }
        const action = event.target.closest?.('[data-action]')?.dataset?.action;
        if (!action || !el.contains(event.target)) return;
        if (action === 'bpm' || action === 'loop-from' || action === 'loop-to') return;
        if (action === 'toggle') {
          if (session.playing) {
            stopSession(session);
            paint(el, session);
          } else {
            window.dispatchEvent(new CustomEvent('notespro-dance-play', { detail: el }));
            startSession(el, session);
          }
          return;
        }
        if (action === 'prev') shift(-1);
        if (action === 'next') shift(1);
        if (action === 'loop') {
          session.loop = session.loop === false;
          paint(el, session);
          return;
        }
        if (action === 'bpm-down' || action === 'bpm-up') {
          const dance = BY_ID[session.danceId] || DANCES[0];
          const delta = action === 'bpm-up' ? 4 : -4;
          session.bpm = clamp(currentBpm(session, dance) + delta, 40, 200);
          paint(el, session);
        }
      });
      el.addEventListener('input', (event) => {
        if (event.target?.dataset?.action !== 'bpm') return;
        const value = Number(event.target.value);
        if (!Number.isFinite(value)) return;
        session.bpm = clamp(value, 40, 200);
        const out = el.querySelector('.dance-bpm-value');
        const dance = BY_ID[session.danceId] || DANCES[0];
        if (out) out.textContent = `${Math.round(session.bpm)} · ${dance.meter}`;
      });
      el.addEventListener('change', (event) => {
        const action = event.target?.dataset?.action;
        if (action !== 'loop-from' && action !== 'loop-to') return;
        const value = parseInt(event.target.value, 10);
        if (!Number.isFinite(value)) return;
        if (action === 'loop-from') session.loopFrom = value;
        else session.loopTo = value;
        const dance = BY_ID[session.danceId] || DANCES[0];
        const count = partnerSteps(activeFigure(dance, session.figureId), 'man').length;
        const [from, to] = stepRange(session, count);
        session.loopFrom = from;
        session.loopTo = to;
        if (session.step < from || session.step > to) session.step = from;
        paint(el, session);
      });
      const stage = el.querySelector('.dance-stage');
      let swipe = null;
      stage?.addEventListener('pointerdown', (event) => {
        if (event.button != null && event.button !== 0) return;
        if (event.target.closest?.('button, a, input, select, label')) return;
        swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
        try { stage.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
      });
      stage?.addEventListener('pointerup', (event) => {
        if (!swipe || swipe.id !== event.pointerId) return;
        const dx = event.clientX - swipe.x;
        const dy = event.clientY - swipe.y;
        swipe = null;
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
        shift(dx < 0 ? 1 : -1);
      });
      stage?.addEventListener('pointercancel', () => { swipe = null; });
      window.addEventListener('notespro-dance-play', (event) => {
        if (event.detail !== el && session.playing) {
          stopSession(session);
          paint(el, session);
        }
      });
      const disconnectObs = new MutationObserver(() => {
        if (!el.isConnected) {
          stopSession(session);
          session.ctx?.close?.();
          disconnectObs.disconnect();
        }
      });
      disconnectObs.observe(document.body, { childList: true, subtree: true });
      paint(el, session);
    });
  }

  return {
    parseFenceAttrs,
    renderBlock,
    hydrate,
    dances: DANCES.map((dance) => ({ id: dance.id, name: dance.name })),
  };
}));
