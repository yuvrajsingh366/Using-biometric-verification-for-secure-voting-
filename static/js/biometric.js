/**
 * EVM — biometric.js
 * Advanced Biometric System
 *   - Real face matching via face-api.js (128-D embeddings)
 *   - Liveness detection: blink + head-turn challenge
 *   - Advanced fingerprint scanner simulation
 *
 * Depends on: main.js (showToast, apiPost) loaded first.
 * All classes are guarded with typeof checks so this file is safe
 * to load even if main.js already declared WebcamManager.
 */

// ═══════════════════════════════════════════════════════
//  FACE VERIFICATION ENGINE
// ═══════════════════════════════════════════════════════

// Guard prevents "redeclaration" if page reloads or double-loads
if (typeof FaceVerificationEngine === 'undefined') {

class FaceVerificationEngine {
  constructor() {
    this.modelsLoaded = false;
    this.modelBasePath = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/';
    this.registeredDescriptor = null;
    this.MATCH_THRESHOLD = 0.45;
    this.livenessPassed  = false;
  }

  async loadModels() {
    if (this.modelsLoaded) return true;
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(this.modelBasePath),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(this.modelBasePath),
        faceapi.nets.faceRecognitionNet.loadFromUri(this.modelBasePath),
      ]);
      this.modelsLoaded = true;
      return true;
    } catch (err) {
      console.error('[FaceEngine] Model load failed:', err);
      return false;
    }
  }

  async getDescriptor(sourceEl) {
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
    const result = await faceapi
      .detectSingleFace(sourceEl, opts)
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    return result ? result.descriptor : null;
  }

  distance(d1, d2) { return faceapi.euclideanDistance(d1, d2); }

  async registerFromBase64(base64Img) {
    const img = await this._base64ToImg(base64Img);
    const descriptor = await this.getDescriptor(img);
    if (descriptor) {
      this.registeredDescriptor = descriptor;
      return Array.from(descriptor);
    }
    return null;
  }

  async verifyLive(videoEl, storedDescriptorArray) {
    if (!this.modelsLoaded) await this.loadModels();
    const stored = new Float32Array(storedDescriptorArray);
    const live   = await this.getDescriptor(videoEl);
    if (!live) return { verified: false, reason: 'No face detected', distance: null };
    const dist = this.distance(stored, live);
    return {
      verified:   dist < this.MATCH_THRESHOLD,
      distance:   dist,
      confidence: Math.max(0, Math.round((1 - dist / this.MATCH_THRESHOLD) * 100)),
      reason:     dist < this.MATCH_THRESHOLD
        ? 'Face matched'
        : `Face mismatch (distance: ${dist.toFixed(3)})`,
    };
  }

  _base64ToImg(b64) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload  = () => res(img);
      img.onerror = rej;
      img.src = b64;
    });
  }
}
window.FaceVerificationEngine = FaceVerificationEngine;
} // end guard

// ═══════════════════════════════════════════════════════
//  LIVENESS DETECTOR
// ═══════════════════════════════════════════════════════

if (typeof LivenessDetector === 'undefined') {

class LivenessDetector {
  constructor(videoEl, statusEl, onComplete) {
    this.video      = videoEl;
    this.statusEl   = statusEl;
    this.onComplete = onComplete;
    this.challenges = [];
    this.passed     = false;
    this._running   = false;
    this._animFrame = null;
    this.eyeHistory  = [];
    this.noseHistory = [];
    this.BLINK_EAR_THRESHOLD = 0.22;
    this.blinked = false;
    this.turned  = false;
  }

  _setStatus(msg, cls = '') {
    if (this.statusEl) {
      this.statusEl.innerHTML  = msg;
      this.statusEl.className  = 'liveness-status ' + cls;
    }
  }

  async start() {
    await faceapi.nets.tinyFaceDetector.loadFromUri(
      'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/'
    );
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(
      'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/'
    );
    this.challenges = this._generateChallenges();
    this._running   = true;
    this._runChallenge(0);
  }

  _generateChallenges() {
    const all = ['blink', 'turn-left', 'turn-right'];
    return all.sort(() => Math.random() - 0.5).slice(0, 2);
  }

  async _runChallenge(idx) {
    if (idx >= this.challenges.length) {
      this._running = false;
      this.passed   = true;
      this._setStatus('✅ Liveness verified!', 'success');
      if (this.onComplete) this.onComplete(true);
      return;
    }
    const ch = this.challenges[idx];
    const labels = {
      'blink':      '👁 Please <strong>BLINK</strong> your eyes',
      'turn-left':  '↩ Please turn your <strong>HEAD LEFT</strong>',
      'turn-right': '↪ Please turn your <strong>HEAD RIGHT</strong>',
    };
    this._setStatus(`<span class="liveness-prompt">${labels[ch]}</span>`, 'challenge');
    this.blinked = false; this.turned = false;
    this.eyeHistory = []; this.noseHistory = [];

    let timeout = setTimeout(() => {
      this._setStatus('⚠️ Challenge timed out — retrying', 'error');
      setTimeout(() => this._runChallenge(idx), 1500);
    }, 8000);

    const detect = async () => {
      if (!this._running) return;
      const opts   = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 });
      const result = await faceapi.detectSingleFace(this.video, opts).withFaceLandmarks(true);
      if (result) {
        const success = ch === 'blink'
          ? this._checkBlink(result.landmarks)
          : this._checkTurn(result.landmarks, ch);
        if (success) {
          clearTimeout(timeout);
          this._setStatus(`✅ Challenge ${idx + 1} passed!`, 'success');
          await this._delay(700);
          this._runChallenge(idx + 1);
          return;
        }
      }
      if (this._running) this._animFrame = requestAnimationFrame(detect);
    };
    this._animFrame = requestAnimationFrame(detect);
  }

  _checkBlink(landmarks) {
    const leftEAR  = this._eyeAspectRatio(landmarks.getLeftEye());
    const rightEAR = this._eyeAspectRatio(landmarks.getRightEye());
    const avgEAR   = (leftEAR + rightEAR) / 2;
    this.eyeHistory.push(avgEAR);
    if (this.eyeHistory.length > 20) this.eyeHistory.shift();
    const wasOpen  = this.eyeHistory.some(e => e > 0.28);
    const isClosed = avgEAR < this.BLINK_EAR_THRESHOLD;
    if (wasOpen && isClosed) this.blinked = true;
    return this.blinked;
  }

  _eyeAspectRatio(eye) {
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    return (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / (2 * dist(eye[0], eye[3]));
  }

  _checkTurn(landmarks, direction) {
    const nose      = landmarks.getNose();
    const jaw       = landmarks.getJawOutline();
    const faceWidth = jaw[16].x - jaw[0].x;
    const center    = jaw[0].x + faceWidth / 2;
    const ratio     = (nose[3].x - center) / faceWidth;
    this.noseHistory.push(ratio);
    if (this.noseHistory.length > 15) this.noseHistory.shift();
    if (direction === 'turn-left')  return this.noseHistory.some(r => r < -0.12);
    if (direction === 'turn-right') return this.noseHistory.some(r => r > 0.12);
    return false;
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
  stop() { this._running = false; if (this._animFrame) cancelAnimationFrame(this._animFrame); }
}
window.LivenessDetector = LivenessDetector;
} // end guard

// ═══════════════════════════════════════════════════════
//  ADVANCED WEBCAM MANAGER (face mesh overlay)
// ═══════════════════════════════════════════════════════

if (typeof AdvancedWebcam === 'undefined') {

class AdvancedWebcam {
  constructor(videoId, canvasId, statusId) {
    this.video    = document.getElementById(videoId);
    this.canvas   = document.getElementById(canvasId);
    this.statusEl = document.getElementById(statusId);
    this.stream   = null;
    this.capturedImage = null;
    this._overlayRunning = false;
    this._faceEngine     = new (window.FaceVerificationEngine)();
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this._setStatus('📷 Camera active — position face inside the oval', 'active');
      await this._faceEngine.loadModels();
      this._startFaceOverlay();
      return true;
    } catch (err) {
      this._setStatus('❌ Camera unavailable', 'error');
      return false;
    }
  }

  async _startFaceOverlay() {
    if (!this.canvas) return;
    this._overlayRunning = true;
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });

    const loop = async () => {
      if (!this._overlayRunning) return;
      if (this.video.readyState === 4) {
        const ctx = this.canvas.getContext('2d');
        this.canvas.width  = this.video.videoWidth  || 640;
        this.canvas.height = this.video.videoHeight || 480;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const results = await faceapi
          .detectAllFaces(this.video, opts)
          .withFaceLandmarks(true);

        if (results.length > 1) {
          this._setStatus('⚠️ Multiple faces detected! Only 1 allowed', 'error');
          results.forEach(r => {
            const b = r.detection.box;
            ctx.strokeStyle = '#FF3333'; ctx.lineWidth = 3;
            ctx.strokeRect(b.x, b.y, b.width, b.height);
          });
        } else if (results.length === 1) {
          this._setStatus('✅ Face detected — looking good!', 'success');
          const r   = results[0];
          const box = r.detection.box;
          ctx.strokeStyle = '#00E676'; ctx.lineWidth = 2;
          ctx.strokeRect(box.x, box.y, box.width, box.height);
          ctx.fillStyle = 'rgba(0, 230, 118, 0.7)';
          r.landmarks.positions.forEach(pt => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 1.5, 0, 2 * Math.PI);
            ctx.fill();
          });
          const score = Math.round(r.detection.score * 100);
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(box.x, box.y - 22, 90, 20);
          ctx.fillStyle = '#00E676'; ctx.font = '12px monospace';
          ctx.fillText(`Face ${score}%`, box.x + 4, box.y - 7);
        } else {
          this._setStatus('👤 No face detected — please look at camera', 'warning');
        }
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  capture() {
    const c = document.createElement('canvas');
    if (this.video && this.video.videoWidth) {
      c.width  = this.video.videoWidth;
      c.height = this.video.videoHeight;
      c.getContext('2d').drawImage(this.video, 0, 0);
    } else {
      // Simulation fallback
      c.width = 640; c.height = 480;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0B1D35'; ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#aaa'; ctx.font = '20px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Face Captured (Simulation)', 320, 230);
      ctx.font = '14px sans-serif';
      ctx.fillText(new Date().toLocaleString(), 320, 270);
    }
    this.capturedImage = c.toDataURL('image/jpeg', 0.85);
    return this.capturedImage;
  }

  stop() {
    this._overlayRunning = false;
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); }
  }

  _setStatus(msg, cls) {
    if (this.statusEl) {
      this.statusEl.textContent = msg;
      this.statusEl.className   = `webcam-status status-${cls}`;
    }
  }
}
window.AdvancedWebcam = AdvancedWebcam;
} // end guard

// ═══════════════════════════════════════════════════════
//  ADVANCED FINGERPRINT SCANNER (visual simulation)
// ═══════════════════════════════════════════════════════

if (typeof AdvancedFingerprintScanner === 'undefined') {

class AdvancedFingerprintScanner {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scanned   = false;
    this.data      = null;
    this._canvas   = null;
  }

  _getEl(sel) { return this.container ? this.container.querySelector(sel) : null; }

  _buildUI() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="fp-scanner-wrap">
        <div class="fp-sensor-frame">
          <canvas class="fp-canvas" width="200" height="240"></canvas>
          <div class="fp-sensor-corners">
            <span class="fp-corner tl"></span><span class="fp-corner tr"></span>
            <span class="fp-corner bl"></span><span class="fp-corner br"></span>
          </div>
        </div>
        <div class="fp-info">
          <div class="fp-icon-lg">👆</div>
          <div class="fp-label-main">Place Finger on Sensor</div>
          <div class="fp-label-sub">Press and hold for 2 seconds</div>
        </div>
        <div class="fp-bar-wrap">
          <div class="fp-bar-track"><div class="fp-bar-fill" style="width:0%"></div></div>
          <div class="fp-bar-label">0%</div>
        </div>
        <div class="fp-steps">
          <span class="fp-step" data-step="place">📍 Place</span>
          <span class="fp-step-arrow">→</span>
          <span class="fp-step" data-step="scan">🔍 Scan</span>
          <span class="fp-step-arrow">→</span>
          <span class="fp-step" data-step="analyze">🧠 Analyze</span>
          <span class="fp-step-arrow">→</span>
          <span class="fp-step" data-step="verify">✅ Verify</span>
        </div>
      </div>
    `;
    this._canvas = this.container.querySelector('.fp-canvas');
    this._drawIdleSensor();
  }

  _drawIdleSensor() {
    if (!this._canvas) return;
    const ctx = this._canvas.getContext('2d');
    const W = 200, H = 240;
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createRadialGradient(W/2, H/2, 10, W/2, H/2, 120);
    grad.addColorStop(0, '#0d2137');
    grad.addColorStop(1, '#060f1c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(0,150,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < W; x += 10) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += 10) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(100,180,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(W/2, H*0.55, 55, 70, 0, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = 'rgba(100,180,255,0.1)';
    ctx.font = '52px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('👆', W/2, H*0.6);
  }

  _generateRidges() {
    const ridges = [];
    const W = 200, H = 240, cx = W/2, cy = H*0.52;
    for (let i = 0; i < 22; i++) {
      const r = 18 + i * 7;
      const pts = [];
      const aStart = -Math.PI * 0.7, aEnd = Math.PI * 0.7;
      for (let s = 0; s <= 60; s++) {
        const angle  = aStart + (aEnd - aStart) * s / 60;
        const wobble = Math.sin(angle * 4 + i * 1.3) * 2.5 + Math.sin(angle * 9 + i * 0.7) * 1.2;
        pts.push([cx + (r + wobble) * Math.sin(angle), cy - (r + wobble) * Math.cos(angle) * 1.15]);
      }
      ridges.push(pts);
    }
    return ridges;
  }

  async _animateScan() {
    if (!this._canvas) return;
    const ctx = this._canvas.getContext('2d');
    const W = 200, H = 240;
    const ridges = this._generateRidges();
    const totalTime = 2400;
    const startTime = performance.now();

    return new Promise(resolve => {
      const frame = (now) => {
        const progress = Math.min(1, (now - startTime) / totalTime);
        const scanY    = H - H * progress;
        ctx.clearRect(0, 0, W, H);
        const bg = ctx.createRadialGradient(W/2, H/2, 10, W/2, H/2, 130);
        bg.addColorStop(0, '#0d2137'); bg.addColorStop(1, '#060f1c');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

        const revealUntil = H - scanY + 30;
        ridges.forEach(pts => {
          const alpha = Math.min(1, Math.max(0, (revealUntil - 20) / H));
          if (alpha < 0.01) return;
          ctx.strokeStyle = `rgba(0, 200, 255, ${0.35 * alpha})`;
          ctx.lineWidth = 1.2; ctx.shadowColor = 'rgba(0,180,255,0.4)'; ctx.shadowBlur = 2;
          ctx.beginPath();
          pts.forEach(([x, y], i) => {
            if (y > revealUntil) return;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          });
          ctx.stroke();
        });

        const sg = ctx.createLinearGradient(0, scanY - 20, 0, scanY + 6);
        sg.addColorStop(0, 'transparent');
        sg.addColorStop(0.5, 'rgba(0, 220, 255, 0.9)');
        sg.addColorStop(1, 'transparent');
        ctx.fillStyle = sg; ctx.fillRect(0, scanY - 20, W, 26);
        ctx.shadowBlur = 0;

        const bar      = this._getEl('.fp-bar-fill');
        const barLabel = this._getEl('.fp-bar-label');
        if (bar)      bar.style.width    = (progress * 85) + '%';
        if (barLabel) barLabel.textContent = Math.round(progress * 85) + '%';

        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async _animateAnalyze() {
    if (!this._canvas) return;
    const ctx = this._canvas.getContext('2d');
    const W = 200, H = 240;
    const ridges = this._generateRidges();

    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(W/2, H/2, 10, W/2, H/2, 130);
    bg.addColorStop(0, '#0d2137'); bg.addColorStop(1, '#060f1c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ridges.forEach(pts => {
      ctx.strokeStyle = 'rgba(0, 200, 255, 0.4)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.stroke();
    });

    const minutiae = Array.from({ length: 18 }, () => {
      const angle = Math.random() * Math.PI * 1.4 - Math.PI * 0.7;
      const r     = 20 + Math.random() * 55;
      return {
        x: W/2 + r * Math.sin(angle),
        y: H * 0.52 - r * Math.cos(angle) * 1.15,
        type: Math.random() > 0.5 ? 'bifurcation' : 'ending',
      };
    });

    return new Promise(resolve => {
      const start = performance.now();
      const blink = (now) => {
        const alpha = (Math.sin((now - start) / 150) + 1) / 2;
        minutiae.forEach(m => {
          ctx.beginPath();
          ctx.strokeStyle = m.type === 'bifurcation'
            ? `rgba(255, 200, 0, ${alpha})`
            : `rgba(0, 255, 150, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.arc(m.x, m.y, m.type === 'bifurcation' ? 5 : 4, 0, Math.PI * 2);
          ctx.stroke();
        });
        if (now - start < 1500) requestAnimationFrame(blink);
        else resolve();
      };
      requestAnimationFrame(blink);
    });
  }

  _setPhaseLabel(label, sub, stepKey) {
    const main = this._getEl('.fp-label-main');
    const sub_ = this._getEl('.fp-label-sub');
    if (main) main.textContent = label;
    if (sub_) sub_.textContent = sub;
    if (this.container) {
      this.container.querySelectorAll('.fp-step').forEach(s => {
        s.classList.toggle('active', s.dataset.step === stepKey);
      });
    }
  }

  async scan() {
    this._buildUI();
    this._setPhaseLabel('Place Finger on Sensor', 'Press and hold for scanning...', 'place');
    await this._delay(1200);
    const icon = this._getEl('.fp-icon-lg');
    if (icon) icon.textContent = '🔍';
    this._setPhaseLabel('Scanning Fingerprint...', 'Hold still — acquiring ridges', 'scan');
    await this._animateScan();
    this._setPhaseLabel('Analyzing Ridges...', 'Detecting minutiae points', 'analyze');
    const bar = this._getEl('.fp-bar-fill'), barLabel = this._getEl('.fp-bar-label');
    if (bar) bar.style.width = '92%';
    if (barLabel) barLabel.textContent = '92%';
    await this._animateAnalyze();
    if (icon) icon.textContent = '✅';
    this._setPhaseLabel('Fingerprint Registered!', 'Biometric data securely stored', 'verify');
    if (bar) bar.style.width = '100%';
    if (barLabel) barLabel.textContent = '100%';
    this.scanned = true;
    this.data    = 'FP_' + this._genHash();
    return this.data;
  }

  async verify() {
    this._buildUI();
    this._setPhaseLabel('Place Finger on Sensor', 'Authentication required', 'place');
    await this._delay(1200);
    const icon = this._getEl('.fp-icon-lg');
    if (icon) icon.textContent = '🔍';
    this._setPhaseLabel('Verifying Fingerprint...', 'Matching against stored template', 'scan');
    await this._animateScan();
    this._setPhaseLabel('Cross-checking Template...', 'Comparing minutiae patterns', 'analyze');
    await this._animateAnalyze();
    await this._delay(400);
    if (icon) icon.textContent = '✅';
    this._setPhaseLabel('Identity Confirmed!', 'Fingerprint matched successfully', 'verify');
    const bar = this._getEl('.fp-bar-fill'), barLabel = this._getEl('.fp-bar-label');
    if (bar) bar.style.width = '100%';
    if (barLabel) barLabel.textContent = '100%';
    this.scanned = true;
    this.data    = 'FP_VERIFY_' + this._genHash();
    return this.data;
  }

  // ── Deterministic per-voter fingerprint token ───────────────────
  // Strategy:
  //   REGISTRATION (scan):
  //     - Generate a cryptographically random token ONCE per voter.
  //     - Store it in localStorage under the voter's voter_id key.
  //     - Return and save it to DB.
  //   VERIFICATION (verify):
  //     - Look up the stored token from localStorage using the voter_id
  //       that was entered in the login/vote form.
  //     - Return that same token → server comparison succeeds.
  //
  // This means the token is unique per voter AND consistent across scans
  // on the same browser. In production, replace with real hardware SDK hash.
  //
  // Call scanner.setVoterId(id) before scan()/verify() to bind the voter.
  setVoterId(id) {
    this._voterId = id ? id.trim().toUpperCase() : null;
  }

  _genHash() {
    // Verification mode: retrieve the token saved at registration
    if (this._voterId) {
      const stored = localStorage.getItem('fp_token_' + this._voterId);
      if (stored) return stored;
    }
    // Registration mode (or first time): generate a fresh random token
    const arr    = new Uint8Array(12);
    crypto.getRandomValues(arr);
    const token  = Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
    // Persist it bound to this voter_id if we know it
    if (this._voterId) {
      localStorage.setItem('fp_token_' + this._voterId, token);
    }
    return token;
  }
  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}
window.AdvancedFingerprintScanner = AdvancedFingerprintScanner;
} // end guard