(function (global) {
  'use strict';

  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
  const SIGNAL_POLL_MS = 1200;

  function createSession(opts) {
    const {
      selfId,
      peerId,
      api,
      onEnvelope,
      onTyping,
      onStatus,
      onAck,
    } = opts;

    let pc = null;
    let dc = null;
    let signalPollTimer = null;
    let lastSignalId = 0;
    let destroyed = false;
    let makingOffer = false;
    let ignoreOffer = false;

    function setStatus(status) {
      onStatus?.(status);
    }

    async function sendSignal(kind, payload) {
      await api(`api/dm/signal/${peerId}/`, 'POST', { kind, payload });
    }

    function setupDataChannel(channel) {
      dc = channel;
      channel.onopen = () => setStatus('p2p');
      channel.onclose = () => {
        if (!destroyed) setStatus('relay');
      };
      channel.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.t === 'msg') onEnvelope?.(msg);
          else if (msg.t === 'typing') onTyping?.();
          else if (msg.t === 'ack') onAck?.(msg.cid);
        } catch (_) { /* ignore malformed */ }
      };
    }

    function ensurePeerConnection() {
      if (pc) return pc;

      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal('ice', event.candidate.toJSON()).catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc?.connectionState;
        if (state === 'connected') setStatus('p2p');
        else if (state === 'connecting') setStatus('connecting');
        else if (!destroyed && (state === 'failed' || state === 'disconnected')) setStatus('relay');
      };

      if (selfId < peerId) {
        setupDataChannel(pc.createDataChannel('dm', { ordered: true }));
      } else {
        pc.ondatachannel = (event) => setupDataChannel(event.channel);
      }

      return pc;
    }

    async function handleSignal(kind, payload) {
      const conn = ensurePeerConnection();

      if (kind === 'offer') {
        const offerCollision = makingOffer || conn.signalingState !== 'stable';
        ignoreOffer = !offerCollision && selfId > peerId;
        if (ignoreOffer) return;

        await conn.setRemoteDescription(payload);
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        await sendSignal('answer', conn.localDescription);
      } else if (kind === 'answer') {
        if (conn.signalingState === 'have-local-offer') {
          await conn.setRemoteDescription(payload);
        }
      } else if (kind === 'ice' && payload) {
        try {
          await conn.addIceCandidate(payload);
        } catch (_) { /* ignore stale candidates */ }
      }
    }

    async function pollSignals() {
      if (destroyed) return;
      try {
        const data = await api(`api/dm/signal/poll/?after=${lastSignalId}`);
        for (const sig of data.signals || []) {
          lastSignalId = Math.max(lastSignalId, sig.id);
          if (sig.sender_id !== peerId) continue;
          await handleSignal(sig.kind, sig.payload);
        }
      } catch (_) { /* relay fallback */ }
    }

    async function connect() {
      if (!global.RTCPeerConnection) {
        setStatus('relay');
        return;
      }

      setStatus('connecting');
      signalPollTimer = setInterval(() => { pollSignals(); }, SIGNAL_POLL_MS);
      await pollSignals();

      if (selfId < peerId) {
        try {
          makingOffer = true;
          const conn = ensurePeerConnection();
          const offer = await conn.createOffer();
          await conn.setLocalDescription(offer);
          await sendSignal('offer', conn.localDescription);
        } finally {
          makingOffer = false;
        }
      }
    }

    function disconnect() {
      destroyed = true;
      if (signalPollTimer) {
        clearInterval(signalPollTimer);
        signalPollTimer = null;
      }
      try { dc?.close(); } catch (_) { /* ignore */ }
      try { pc?.close(); } catch (_) { /* ignore */ }
      dc = null;
      pc = null;
      setStatus('off');
    }

    function sendEnvelope(envelope) {
      if (dc?.readyState !== 'open') return false;
      dc.send(JSON.stringify({ t: 'msg', ...envelope }));
      return true;
    }

    function sendTyping() {
      if (dc?.readyState === 'open') {
        dc.send(JSON.stringify({ t: 'typing' }));
      }
    }

    function sendAck(cid) {
      if (dc?.readyState === 'open') {
        dc.send(JSON.stringify({ t: 'ack', cid }));
      }
    }

    return {
      connect,
      disconnect,
      sendEnvelope,
      sendTyping,
      sendAck,
    };
  }

  global.DmP2p = { createSession };
})(window);
