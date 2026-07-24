/* ─────────────────────────────────────────────────────────────────
   EVM — main.js
   Core utilities: Toast, apiPost
   WebcamManager kept here as a lightweight fallback ONLY.
   Full biometric classes (AdvancedWebcam, AdvancedFingerprintScanner,
   FaceVerificationEngine, LivenessDetector) live in biometric.js.
───────────────────────────────────────────────────────────────── */

// ── Toast Notifications ──────────────────────────────────────────
// Guard: only create the toast element once even if main.js is
// somehow parsed twice (e.g. base.html + block scripts both load it)
if (!window._toastEl) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = '<span class="toast-icon"></span><span class="toast-msg"></span>';
  document.body.appendChild(t);
  window._toastEl = t;
}

function showToast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  window._toastEl.querySelector('.toast-icon').textContent = icons[type] || 'ℹ️';
  window._toastEl.querySelector('.toast-msg').textContent  = msg;
  window._toastEl.className = `toast ${type} show`;
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => window._toastEl.classList.remove('show'), duration);
}

// ── API Helper ───────────────────────────────────────────────────
async function apiPost(url, data) {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  return res.json();
}

// ── Lightweight WebcamManager ────────────────────────────────────
// Used by pages that DON'T load biometric.js.
// biometric.js defines AdvancedWebcam which EXTENDS this behaviour;
// to avoid redeclaration we use a guard so both files can coexist.
if (typeof WebcamManager === 'undefined') {
  class WebcamManager {
    constructor(videoId, statusId) {
      this.video    = document.getElementById(videoId);
      this.statusEl = document.getElementById(statusId);
      this.stream   = null;
      this.capturedImage = null;
    }
    async start() {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        });
        if (this.video) { this.video.srcObject = this.stream; await this.video.play(); }
        if (this.statusEl) this.statusEl.textContent = '📷 Camera active — Position face in frame';
        return true;
      } catch (err) {
        if (this.statusEl) this.statusEl.textContent = '❌ Camera unavailable — simulation mode';
        return false;
      }
    }
    stop() {
      if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    }
    capture() {
      const canvas = document.createElement('canvas');
      if (this.video && this.video.videoWidth) {
        canvas.width  = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        canvas.getContext('2d').drawImage(this.video, 0, 0);
      } else {
        // Simulation placeholder
        canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0B1D35'; ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = '#aaa';    ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Face Captured (Simulation)', 320, 230);
        ctx.font = '16px sans-serif';
        ctx.fillText(new Date().toISOString(), 320, 270);
      }
      this.capturedImage = canvas.toDataURL('image/jpeg', 0.8);
      return this.capturedImage;
    }
  }
  // Expose on window so other scripts can reference it
  window.WebcamManager = WebcamManager;
}