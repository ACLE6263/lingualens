const { hasMeaningfulFrameChange } = require('./frame-signature');

const DEFAULT_SCHEDULER = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle),
};

class LiveTranslationSession {
  constructor({
    captureFrame,
    processFrame,
    onResult = () => {},
    onStatus = () => {},
    onError = () => {},
    intervalMs = 1500,
    changeThreshold = 0.025,
    scheduler = DEFAULT_SCHEDULER,
  }) {
    this.captureFrame = captureFrame;
    this.processFrame = processFrame;
    this.onResult = onResult;
    this.onStatus = onStatus;
    this.onError = onError;
    this.intervalMs = intervalMs;
    this.changeThreshold = changeThreshold;
    this.scheduler = scheduler;
    this.running = false;
    this.inFlight = false;
    this.bounds = null;
    this.previousSignature = null;
    this.intervalHandle = null;
    this.generation = 0;
  }

  start(bounds, { initialSignature = null } = {}) {
    if (this.running) this.stop();
    this.generation += 1;
    this.running = true;
    this.bounds = { ...bounds };
    this.previousSignature = initialSignature;
    this.intervalHandle = this.scheduler.setInterval(() => {
      this.refreshOnce().catch((error) => this.onError(error));
    }, this.intervalMs);
    this.onStatus({ running: true, status: 'started' });
  }

  stop() {
    const wasRunning = this.running;
    this.generation += 1;
    if (this.intervalHandle !== null) {
      this.scheduler.clearInterval(this.intervalHandle);
    }
    this.intervalHandle = null;
    this.running = false;
    this.bounds = null;
    this.previousSignature = null;
    if (wasRunning) this.onStatus({ running: false, status: 'stopped' });
  }

  setIntervalMs(intervalMs) {
    this.intervalMs = intervalMs;
    if (this.running && this.bounds) {
      const bounds = this.bounds;
      const initialSignature = this.previousSignature;
      this.stop();
      this.start(bounds, { initialSignature });
    }
  }

  isRunning() {
    return this.running;
  }

  async refreshOnce() {
    if (!this.running) return { status: 'idle' };
    if (this.inFlight) return { status: 'busy' };

    const generation = this.generation;
    this.inFlight = true;
    try {
      const frame = await this.captureFrame(this.bounds);
      if (!this.running || generation !== this.generation) return { status: 'cancelled' };
      if (!frame?.signature) throw new Error('Captured frame has no signature.');
      if (!hasMeaningfulFrameChange(this.previousSignature, frame.signature, this.changeThreshold)) {
        this.onStatus({ running: true, status: 'unchanged' });
        return { status: 'unchanged' };
      }

      this.onStatus({ running: true, status: 'processing' });
      const result = await this.processFrame(frame, this.bounds);
      if (!this.running || generation !== this.generation) return { status: 'cancelled' };
      this.previousSignature = frame.signature;
      this.onResult(result, frame);
      this.onStatus({ running: true, status: 'updated' });
      return { status: 'updated', result };
    } catch (error) {
      // 会话已被 stop()/重启后，在途帧的失败属于过期事件，不再上报，
      // 否则 UI 会被改回"实时翻译运行中"而实际没有监听。
      if (!this.running || generation !== this.generation) return { status: 'cancelled' };
      throw error;
    } finally {
      this.inFlight = false;
    }
  }
}

module.exports = { LiveTranslationSession };