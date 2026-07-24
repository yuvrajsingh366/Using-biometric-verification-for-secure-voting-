/* ─────────────────────────────────────────
   EVM — main.js
   Webcam, Fingerprint sim, Toast, Utils
───────────────────────────────────────── */

// ── Toast Notifications ───────────────────────
const _toastEl = (() => {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = '<span class="toast-icon"></span><span class="toast-msg"></span>';
  document.body.appendChild(t);
  return t;
})();

function showToast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  _toastEl.querySelector('.toast-icon').textContent = icons[type] || 'ℹ️';
  _toastEl.querySelector('.toast-msg').textContent  = msg;
  _toastEl.className = `toast ${type} show`;
  setTimeout(() => _toastEl.classList.remove('show'), duration);
}

// ── Webcam Manager ────────────────────────────
class WebcamManager {
  constructor(videoId, statusId) {
    this.video  = document.getElementById(videoId);
    this.status = document.getElementById(statusId);
    this.stream = null;
    this.capturedImage = null;
  }
  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width:640, height:480, facingMode:'user' } });
      if (this.video) {
        this.video.srcObject = this.stream;
        await this.video.play();
        if (this.status) this.status.textContent = '📷 Camera active — Position face in frame';
      }
      return true;
    } catch (err) {
      if (this.status) this.status.textContent = '❌ Camera unavailable — using simulation mode';
      console.warn('Camera error:', err);
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
      // Simulation: create a placeholder
      canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0B1D35';
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#aaa';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Face Captured (Simulation)', 320, 230);
      ctx.font = '16px sans-serif';
      ctx.fillText(new Date().toISOString(), 320, 270);
    }
    this.capturedImage = canvas.toDataURL('image/jpeg', 0.8);
    return this.capturedImage;
  }
}

