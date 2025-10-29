const state = {
  file: null,
  metadata: null,
  frames: [],
  frameIndex: 0,
  playbackRate: 1,
  isPlaying: true,
  playbackTimer: null,
  resultUrl: null,
  settings: {
    fps: 24,
    quality: 80
  }
};

const dom = {};

function initDom() {
  dom.body = document.body;
  dom.dropzone = document.getElementById("dropzone");
  dom.fileInput = document.getElementById("fileInput");
  dom.filePicker = document.getElementById("filePicker");
  dom.content = document.getElementById("content");
  dom.clearButton = document.getElementById("clearButton");
  dom.previewCanvas = document.getElementById("previewCanvas");
  dom.frameBadge = document.getElementById("frameBadge");
  dom.metricsList = document.getElementById("metricsList");
  dom.togglePlay = document.getElementById("togglePlay");
  dom.prevFrame = document.getElementById("prevFrame");
  dom.nextFrame = document.getElementById("nextFrame");
  dom.frameSlider = document.getElementById("frameSlider");
  dom.playbackSpeedButtons = document.querySelectorAll(
    ".playback__speeds button"
  );
  dom.fpsSlider = document.getElementById("fpsSlider");
  dom.fpsLabel = document.getElementById("fpsLabel");
  dom.qualitySlider = document.getElementById("qualitySlider");
  dom.qualityLabel = document.getElementById("qualityLabel");
  dom.estimateSize = document.getElementById("estimateSize");
  dom.estimateBox = document.getElementById("estimateBox");
  dom.compressButton = document.getElementById("compressButton");
  dom.progressBox = document.getElementById("progressBox");
  dom.progressFill = document.getElementById("progressFill");
  dom.progressValue = document.getElementById("progressValue");
  dom.resultBox = document.getElementById("resultBox");
  dom.logOutput = document.getElementById("logOutput");
  dom.themeToggle = document.getElementById("themeToggle");
}

function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  if (dom.logOutput) {
    dom.logOutput.textContent = `[${timestamp}] ${message}\n${dom.logOutput.textContent}`;
  } else if (typeof console !== "undefined") {
    // DOM 未就绪时退回控制台，避免初始化期间抛错
    console.log(`[${timestamp}] ${message}`);
  }
}

function getBitmapWidth(source) {
  if (!source) return 0;
  if (typeof source.width === "number" && source.width > 0) return source.width;
  if ("videoWidth" in source && source.videoWidth > 0) return source.videoWidth;
  if ("naturalWidth" in source && source.naturalWidth > 0) {
    return source.naturalWidth;
  }
  return 0;
}

function getBitmapHeight(source) {
  if (!source) return 0;
  if (typeof source.height === "number" && source.height > 0) return source.height;
  if ("videoHeight" in source && source.videoHeight > 0) {
    return source.videoHeight;
  }
  if ("naturalHeight" in source && source.naturalHeight > 0) {
    return source.naturalHeight;
  }
  return 0;
}

let supportsWebpEncodingCache = null;
function supportsWebpEncoding() {
  if (supportsWebpEncodingCache !== null) return supportsWebpEncodingCache;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  let result = false;
  try {
    result = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch (error) {
    log(`toDataURL 检测 WebP 支持失败：${error.message}`);
    result = false;
  }
  supportsWebpEncodingCache = result;
  return result;
}

async function supportsAnimatedWebpEncoding() {
  if (typeof ImageEncoder !== "function") {
    return false;
  }
  try {
    let encoder;
    if (typeof ImageEncoder.isTypeSupported === "function") {
      const supported = await ImageEncoder.isTypeSupported("image/webp");
      if (!supported) return false;
      encoder = new ImageEncoder({
        type: "image/webp",
        quality: 0.9,
        output() {},
        error() {}
      });
    } else {
      encoder = new ImageEncoder({
        type: "image/webp",
        quality: 0.9,
        output() {},
        error() {}
      });
    }
    encoder.close();
    return true;
  } catch (error) {
    log(`ImageEncoder 可用性检查失败：${error.message}`);
    return false;
  }
}

function resetPlaybackTimer() {
  if (state.playbackTimer) {
    clearTimeout(state.playbackTimer);
    state.playbackTimer = null;
  }
}

function resetState(options) {
  const normalized =
    options && typeof options === "object" && "silent" in options
      ? options
      : { silent: false };
  resetPlaybackTimer();
  state.frames.forEach((frame) => frame.bitmap.close?.());
  state.file = null;
  state.metadata = null;
  state.frames = [];
  state.frameIndex = 0;
  state.playbackRate = 1;
  state.isPlaying = true;
  dom.frameSlider.value = "0";
  dom.togglePlay.textContent = "暂停";
  dom.playbackSpeedButtons.forEach((btn) =>
    btn.classList.toggle("chip--active", btn.dataset.speed === "1")
  );
  if (state.resultUrl) {
    URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = null;
  }
  dom.resultBox.textContent = "";
  dom.progressBox.classList.add("hidden");
  dom.progressFill.style.width = "0%";
  dom.progressValue.textContent = "0%";
  dom.frameBadge.textContent = "";
  const ctx = dom.previewCanvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, dom.previewCanvas.width, dom.previewCanvas.height);
  }
  dom.metricsList.innerHTML = "";
  dom.estimateSize.textContent = "0 KB";
  dom.content.classList.add("hidden");
  dom.dropzone.classList.remove("hidden");
  if (!normalized.silent) {
    log("已清空当前会话。");
  }
}

function formatBytes(bytes) {
  if (!bytes || Number.isNaN(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function formatFps(fps) {
  if (!fps || Number.isNaN(fps)) return "—";
  return `${fps.toFixed(1)} fps`;
}

function formatDuration(ms) {
  if (!ms || Number.isNaN(ms)) return "—";
  return `${(ms / 1000).toFixed(2)} s`;
}

function computeScaleFactor(hasAnimation, qualityNormalized) {
  if (hasAnimation) return 1;
  if (qualityNormalized >= 0.98) return 1;
  return Math.max(0.35, qualityNormalized + 0.05);
}

function resolveAssetUrl(relativePath) {
  if (typeof import.meta !== "undefined" && import.meta.url) {
    return new URL(relativePath, import.meta.url).href;
  }
  if (typeof document !== "undefined") {
    const currentScript = document.currentScript;
    if (currentScript?.src) {
      return new URL(relativePath, currentScript.src).href;
    }
    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; i -= 1) {
      const script = scripts[i];
      if (script && script.src && script.src.includes("app.js")) {
        return new URL(relativePath, script.src).href;
      }
    }
  }
  if (typeof window !== "undefined" && window.location?.href) {
    return new URL(relativePath, window.location.href).href;
  }
  return relativePath;
}

const LOCAL_WEBP_MODULE_URL = resolveAssetUrl("./libs/webp/webp_enc.mjs");
const LOCAL_WEBP_WASM_URL = resolveAssetUrl("./libs/webp/webp_enc.wasm");
const REMOTE_WEBP_MODULE_URL =
  "https://unpkg.com/@squoosh/lib@latest/build/webp_enc.mjs";
const REMOTE_WEBP_WASM_URL =
  "https://unpkg.com/@squoosh/lib@latest/build/webp_enc.wasm";
let wasmWebpCodecPromise = null;

async function loadWasmCodec(moduleUrl, wasmUrl) {
  const mod = await import(moduleUrl);
  const factory =
    mod?.createWebp ||
    mod?.default?.createWebp ||
    (typeof mod?.default === "function" ? mod.default : null) ||
    mod?.default;
  if (typeof factory !== "function") {
    throw new Error("未找到 createWebp 工厂函数");
  }
  return factory({
    locateFile(path) {
      if (path.endsWith(".wasm")) {
        return wasmUrl;
      }
      return new URL(path, moduleUrl).href;
    }
  });
}

async function ensureWasmWebpCodec() {
  if (wasmWebpCodecPromise) return wasmWebpCodecPromise;
  wasmWebpCodecPromise = loadWasmCodec(
    LOCAL_WEBP_MODULE_URL,
    LOCAL_WEBP_WASM_URL
  ).catch(async (error) => {
    console.warn("本地 WebP WASM 加载失败，尝试使用在线 CDN。", error);
    log(
      "未在本地找到 WebP WASM 资源，尝试从 CDN 加载（需网络连接）。"
    );
    return loadWasmCodec(REMOTE_WEBP_MODULE_URL, REMOTE_WEBP_WASM_URL);
  });
  wasmWebpCodecPromise.catch((error) => {
    console.error("Failed to load WebP WASM codec", error);
    log(
      "WASM WebP 模块加载失败，请确认 libs/webp 下存在 webp_enc.mjs / webp_enc.wasm，或确保可以访问 CDN。"
    );
    wasmWebpCodecPromise = null;
  });
  return wasmWebpCodecPromise;
}

async function bitmapToImageData(bitmap, width, height) {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : (() => {
          const c = document.createElement("canvas");
          c.width = width;
          c.height = height;
          return c;
        })();
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("无法创建位图转换上下文。");
  }
  context.clearRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const match = header.match(/data:(.*?);/);
  const mime = match ? match[1] : "application/octet-stream";
  const binary = atob(data);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

async function canvasToWebp(canvas, quality) {
  if (!supportsWebpEncoding()) {
    throw new Error("浏览器未开启 WebP 编码能力，建议升级到最新版 Chrome 或 Edge。");
  }
  if (canvas.convertToBlob) {
    try {
      const blob = await canvas.convertToBlob({
        type: "image/webp",
        quality
      });
      if (blob?.type === "image/webp") {
        return blob;
      }
      log("convertToBlob 返回的不是 WebP，降级到备用编码方案。");
    } catch (error) {
      log(`convertToBlob 无法生成 WebP，尝试退回 toBlob。原因：${error.message}`);
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob?.type === "image/webp") {
          resolve(blob);
          return;
        }
        try {
          const dataUrl = canvas.toDataURL("image/webp", quality);
          if (!dataUrl.startsWith("data:image/webp")) {
            throw new Error("toDataURL 返回的不是 WebP 数据。");
          }
          resolve(dataUrlToBlob(dataUrl));
        } catch (error) {
          reject(
            new Error(
              `浏览器不支持 WebP 编码功能，无法导出。请使用支持 WebP 编码的浏览器（推荐最新版 Chrome/Edge/Opera）。\n原因：${error.message}`
            )
          );
        }
      },
      "image/webp",
      quality
    );
  });
}

async function getScaledBitmap(bitmap, width, height) {
  if (!bitmap) {
    throw new Error("缺少可缩放的位图。");
  }
  const currentWidth = getBitmapWidth(bitmap);
  const currentHeight = getBitmapHeight(bitmap);
  if (currentWidth === width && currentHeight === height) {
    return { bitmap, release: false };
  }
  if (typeof createImageBitmap === "function") {
    try {
      const scaled = await createImageBitmap(bitmap, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "high"
      });
      return { bitmap: scaled, release: true };
    } catch (error) {
      log(`createImageBitmap 缩放失败，使用 Canvas 兜底：${error.message}`);
    }
  }
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : (() => {
          const c = document.createElement("canvas");
          c.width = width;
          c.height = height;
          return c;
        })();
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建缩放绘图上下文。");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  const scaled = await createImageBitmap(canvas);
  return { bitmap: scaled, release: true };
}

function resampleFramesForFps(frames, metadata, targetFps) {
  if (!frames.length) return [];
  const originalFps = metadata?.fps && metadata.fps > 0 ? metadata.fps : targetFps || 24;
  if (frames.length <= 1 || targetFps >= originalFps) {
    return frames.map((frame) => ({
      bitmap: frame.bitmap,
      duration: Math.max(1, Math.round(frame.duration || 1000 / originalFps))
    }));
  }
  const groupSize = Math.max(1, Math.round(originalFps / targetFps));
  const resampled = [];
  let bucketDuration = 0;
  let bucketCount = 0;
  let bucketBitmap = frames[0].bitmap;
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    const frameDuration = Math.max(1, Math.round(frame.duration || 1000 / originalFps));
    if (bucketCount === 0) {
      bucketBitmap = frame.bitmap;
    }
    bucketDuration += frameDuration;
    bucketCount += 1;
    if (bucketCount >= groupSize || i === frames.length - 1) {
      resampled.push({
        bitmap: bucketBitmap,
        duration: bucketDuration
      });
      bucketDuration = 0;
      bucketCount = 0;
    }
  }
  return resampled;
}

function estimateSize(meta, settings) {
  const qualityNormalized = Math.min(
    Math.max(settings.quality / 100, 0.05),
    1
  );
  const scaleFactor = computeScaleFactor(meta?.hasAnimation ?? false, qualityNormalized);
  if (!meta) return null;
  if (!meta.hasAnimation) {
    const qualityFactor = 0.35 + qualityNormalized * 0.6;
    const scalePenalty = scaleFactor * scaleFactor;
    return Math.max(meta.sizeBytes * 0.12, meta.sizeBytes * qualityFactor * scalePenalty);
  }
  const fpsRatio =
    meta.fps > 0 ? Math.min(1, settings.fps / meta.fps) : settings.fps / 24;
  const qualityRatio = settings.quality / 100;
  const heuristic = Math.max(0.12, fpsRatio * (0.35 + qualityRatio * 0.65));
  return Math.max(meta.sizeBytes * 0.08, meta.sizeBytes * heuristic);
}

function updateEstimate() {
  const value = estimateSize(state.metadata, state.settings);
  if (value !== null) {
    dom.estimateSize.textContent = formatBytes(value);
  }
}

function updateMetrics() {
  if (!state.metadata) return;
  const items = [
    {
      label: "文件名",
      value: state.metadata.fileName
    },
    {
      label: "分辨率",
      value:
        state.metadata.width && state.metadata.height
          ? `${state.metadata.width} × ${state.metadata.height}`
          : "—"
    },
    {
      label: "帧信息",
      value: `${state.metadata.frameCount} 帧 / ${formatFps(state.metadata.fps)}`
    },
    {
      label: "时长",
      value: formatDuration(state.metadata.totalDurationMs)
    },
    {
      label: "体积",
      value: formatBytes(state.metadata.sizeBytes)
    }
  ];
  dom.metricsList.innerHTML = items
    .map(
      (item) =>
        `<li><span>${item.label}</span><strong>${item.value}</strong></li>`
    )
    .join("");
}

function drawFrame(frameIndex) {
  const frame = state.frames[frameIndex];
  if (!frame) return;
  const { bitmap } = frame;
  const canvas = dom.previewCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const metadataWidth = state.metadata?.width || 0;
  const metadataHeight = state.metadata?.height || 0;
  const width = getBitmapWidth(bitmap) || metadataWidth || canvas.width || 320;
  const height =
    getBitmapHeight(bitmap) || metadataHeight || canvas.height || 240;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  dom.frameBadge.textContent = `${frameIndex + 1} / ${state.frames.length} 帧`;
  dom.frameSlider.value = String(frameIndex);
}

function scheduleNextFrame() {
  resetPlaybackTimer();
  if (!state.isPlaying || state.frames.length <= 1) return;
  const frame = state.frames[state.frameIndex];
  const delay = Math.max(frame.duration, 16) / state.playbackRate;
  state.playbackTimer = setTimeout(() => {
    state.frameIndex = (state.frameIndex + 1) % state.frames.length;
    drawFrame(state.frameIndex);
    scheduleNextFrame();
  }, delay);
}

function setPlaybackRate(rate) {
  state.playbackRate = rate;
  state.isPlaying = true;
  dom.togglePlay.textContent = "暂停";
  scheduleNextFrame();
}

async function decodeWithImageDecoder(file) {
  const buffer = await file.arrayBuffer();
  const type = file.type || "image/webp";
  const decoder = new ImageDecoder({ data: buffer, type });
  const track = decoder.tracks.selectedTrack;
  const frames = [];
  let totalDurationMs = 0;
  let decodedCount = 0;
  let complete = false;
  while (!complete) {
    let result;
    try {
      result = await decoder.decode();
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "IndexSizeError" || error.name === "RangeError")
      ) {
        break;
      }
      throw error;
    }
    const { image, duration, complete: isComplete } = result;
    const rawDuration = typeof duration === "number" ? duration : 0;
    let durationMs = rawDuration;
    if (rawDuration > 1000) {
      durationMs = rawDuration / 1000;
    } else if (rawDuration > 0 && rawDuration < 1) {
      durationMs = rawDuration * 1000;
    } else if (rawDuration === 0) {
      durationMs = 1000 / Math.max(1, track?.frameRate || 24);
    }
    totalDurationMs += durationMs;
    frames.push({ bitmap: image, duration: durationMs });
    decodedCount += 1;
    complete = Boolean(isComplete);
    if (!complete && decodedCount > 500) {
      // safeguard against malformed files reporting infinite frames
      break;
    }
  }
  decoder.close?.();
  if (frames.length === 0) {
    throw new Error("未能解析出任何帧，请确认文件是否损坏。");
  }
  const fps =
    totalDurationMs > 0
      ? (frames.length / totalDurationMs) * 1000
      : track?.frameRate || 24;
  const firstBitmap = frames[0]?.bitmap;
  const fallbackWidth =
    track?.displayWidth || track?.codedWidth || track?.trackWidth || 0;
  const fallbackHeight =
    track?.displayHeight || track?.codedHeight || track?.trackHeight || 0;
  const width = Math.round(getBitmapWidth(firstBitmap) || fallbackWidth || 0);
  const height = Math.round(getBitmapHeight(firstBitmap) || fallbackHeight || 0);
  const trackFrameCount =
    track && Number.isFinite(track.frameCount) ? track.frameCount : frames.length;
  const finalFrameCount =
    frames.length || Math.max(trackFrameCount || 0, 1);
  const durationFallback =
    finalFrameCount *
    (1000 / Math.max(track?.frameRate || fps || 24, 1));
  return {
    frames,
    metadata: {
      width,
      height,
      frameCount: finalFrameCount,
      fps,
      totalDurationMs: totalDurationMs || durationFallback,
      sizeBytes: file.size,
      hasAnimation: finalFrameCount > 1,
      fileName: file.name
    }
  };
}

async function loadBitmapFromFile(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch (error) {
      log(`createImageBitmap 失败，尝试使用 <img> 加载。原因：${error.message}`);
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (typeof createImageBitmap === "function") {
        createImageBitmap(image)
          .then((bitmap) => {
            resolve(bitmap);
            image.remove();
          })
          .catch(() => resolve(image));
      } else {
        resolve(image);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法加载图片资源，请检查文件是否损坏。"));
    };
    image.src = url;
  });
}

async function decodeFallback(file) {
  const bitmap = await loadBitmapFromFile(file);
  const width = Math.round(getBitmapWidth(bitmap) || 0);
  const height = Math.round(getBitmapHeight(bitmap) || 0);
  return {
    frames: [{ bitmap, duration: 1000 / 24 }],
    metadata: {
      width,
      height,
      frameCount: 1,
      fps: 24,
      totalDurationMs: 1000,
      sizeBytes: file.size,
      hasAnimation: false,
      fileName: file.name
    }
  };
}

async function decodeWebpFile(file) {
  if (!file) return;
  log(`开始解析文件：${file.name}`);
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error("文件体积超过 50MB 限制。");
  }
  if (!(file.type || "").includes("webp")) {
    throw new Error("请选择 .webp 文件。");
  }
  if (typeof ImageDecoder === "undefined") {
    log("浏览器不支持 ImageDecoder，使用退化模式（仅首帧）。");
    return decodeFallback(file);
  }
  try {
    return await decodeWithImageDecoder(file);
  } catch (error) {
    log(`ImageDecoder 解析失败：${error.message}，使用兼容模式。`);
    return decodeFallback(file);
  }
}

async function handleFile(file) {
  try {
    const hadSession = Boolean(state.file || state.frames.length);
    resetState({ silent: !hadSession });
    state.file = file;

    const { frames, metadata } = await decodeWebpFile(file);
    state.frames = frames;
    const firstFrame = frames[0]?.bitmap;
    const ensuredWidth =
      metadata.width || getBitmapWidth(firstFrame) || 0;
    const ensuredHeight =
      metadata.height || getBitmapHeight(firstFrame) || 0;
    state.metadata = {
      ...metadata,
      width: ensuredWidth,
      height: ensuredHeight
    };
    state.settings.fps = Math.min(Math.round(metadata.fps || 24), 60);
    state.settings.quality = 80;
    dom.frameSlider.max = String(Math.max(frames.length - 1, 0));
    dom.frameSlider.value = "0";
    dom.fpsSlider.max = String(Math.max(1, Math.round(metadata.fps || 24)));
    dom.fpsSlider.value = String(state.settings.fps);
    dom.fpsLabel.textContent = `${state.settings.fps} fps`;
    dom.qualitySlider.value = String(state.settings.quality);
    dom.qualityLabel.textContent = String(state.settings.quality);
    dom.togglePlay.textContent = frames.length > 1 ? "暂停" : "单帧";
    dom.togglePlay.disabled = frames.length <= 1;
    dom.prevFrame.disabled = frames.length <= 1;
    dom.nextFrame.disabled = frames.length <= 1;
    dom.frameSlider.disabled = frames.length <= 1;
    dom.dropzone.classList.add("hidden");
    dom.content.classList.remove("hidden");
    drawFrame(0);
    updateMetrics();
    updateEstimate();
    scheduleNextFrame();
    log(`解析完成：${metadata.frameCount} 帧，${formatBytes(metadata.sizeBytes)}。`);
    if (frames.length === 1) {
      log("检测到静态 WebP，可直接调整质量后压缩。");
    }
  } catch (error) {
    resetState({ silent: true });
    log(error.message || "解析失败");
    alert(error.message || "解析失败，请检查文件。");
  }
}

async function compressWebp() {
  if (!state.metadata || state.frames.length === 0) {
    alert("请先导入 WebP 文件。");
    return;
  }
  dom.progressBox.classList.remove("hidden");
  dom.progressFill.style.width = "10%";
  dom.progressValue.textContent = "10%";
  log("开始压缩任务...");

  const { frameCount, hasAnimation } = state.metadata;
  const targetFps = Math.max(1, Math.min(state.settings.fps, Math.round(state.metadata.fps || 24)));
  const quality = Math.min(Math.max(state.settings.quality / 100, 0.05), 1);
  const scaleFactor = computeScaleFactor(hasAnimation, quality);

  try {
    let resolvedWidth = state.metadata.width;
    let resolvedHeight = state.metadata.height;
    const firstBitmap = state.frames[0]?.bitmap;
    if (!resolvedWidth || !resolvedHeight) {
      resolvedWidth = getBitmapWidth(firstBitmap) || resolvedWidth;
      resolvedHeight = getBitmapHeight(firstBitmap) || resolvedHeight;
    }
    if (!resolvedWidth || !resolvedHeight) {
      try {
        const fallbackBitmap = await loadBitmapFromFile(state.file);
        resolvedWidth = getBitmapWidth(fallbackBitmap);
        resolvedHeight = getBitmapHeight(fallbackBitmap);
        fallbackBitmap.close?.();
        if (resolvedWidth && resolvedHeight) {
          state.metadata.width = resolvedWidth;
          state.metadata.height = resolvedHeight;
        }
      } catch (loadError) {
        log(`重新加载文件以获取尺寸时失败：${loadError.message}`);
      }
    }
    if (!resolvedWidth || !resolvedHeight) {
      throw new Error("无法获取帧分辨率，压缩已中止。");
    }

    const targetWidth = Math.max(1, Math.round(resolvedWidth * scaleFactor));
    const targetHeight = Math.max(1, Math.round(resolvedHeight * scaleFactor));
    const resampledFrames = resampleFramesForFps(state.frames, state.metadata, targetFps);
    if (!resampledFrames.length) {
      throw new Error("暂无可压缩的帧数据。");
    }

    const isAnimatedSource = hasAnimation && frameCount > 1;
    const codecQuality = Math.max(1, Math.min(100, Math.round(state.settings.quality)));
    const codec = await ensureWasmWebpCodec();
    dom.progressFill.style.width = "25%";
    dom.progressValue.textContent = "25%";

    const scaledFrames = [];
    for (let i = 0; i < resampledFrames.length; i += 1) {
      const frame = resampledFrames[i];
      const { bitmap: scaledBitmap, release } = await getScaledBitmap(
        frame.bitmap,
        targetWidth,
        targetHeight
      );
      scaledFrames.push({
        bitmap: scaledBitmap,
        release,
        duration: Math.max(1, Math.round(frame.duration))
      });
      const progress = 25 + Math.round(((i + 1) / resampledFrames.length) * 25);
      dom.progressFill.style.width = `${progress}%`;
      dom.progressValue.textContent = `${progress}%`;
    }

    let blob;
    if (isAnimatedSource) {
      const framesForCodec = [];
      for (let i = 0; i < scaledFrames.length; i += 1) {
        const frame = scaledFrames[i];
        const imageData = await bitmapToImageData(frame.bitmap, targetWidth, targetHeight);
        framesForCodec.push({
          image: imageData,
          duration: frame.duration
        });
        const progress = 50 + Math.round(((i + 1) / scaledFrames.length) * 20);
        dom.progressFill.style.width = `${progress}%`;
        dom.progressValue.textContent = `${progress}%`;
      }
      const encoded = await codec.encodeAnimated(framesForCodec, {
        quality: codecQuality,
        loop: 0
      });
      blob = new Blob([encoded], { type: "image/webp" });
    } else {
      const frame = scaledFrames[0];
      const imageData = await bitmapToImageData(frame.bitmap, targetWidth, targetHeight);
      const encoded = await codec.encode(imageData, {
        quality: codecQuality
      });
      blob = new Blob([encoded], { type: "image/webp" });
    }

    scaledFrames.forEach(({ bitmap, release }) => {
      if (release && bitmap.close) bitmap.close();
    });

    dom.progressFill.style.width = "85%";
    dom.progressValue.textContent = "85%";

    if (state.resultUrl) {
      URL.revokeObjectURL(state.resultUrl);
    }
    const url = URL.createObjectURL(blob);
    state.resultUrl = url;

    const resultLines = [
      `原始：${formatFps(state.metadata.fps)} · ${formatBytes(state.metadata.sizeBytes)}`,
      `预设：${targetFps} fps · 质量 ${state.settings.quality}`
    ];

    if (scaleFactor !== 1 || targetWidth !== resolvedWidth || targetHeight !== resolvedHeight) {
      resultLines.push(
        `分辨率：${targetWidth} × ${targetHeight}（原始 ${resolvedWidth} × ${resolvedHeight}）`
      );
    }

    if (hasAnimation && frameCount > 1) {
      resultLines.push(`帧数：${state.metadata.frameCount} → ${resampledFrames.length}`);
    }

    resultLines.push(`结果：${formatBytes(blob.size)}`);

    const canExportAnimation = isAnimatedSource;
    const downloadLabel = canExportAnimation
      ? "下载压缩后的动画 WebP"
      : "下载压缩后的 WebP";

    dom.resultBox.innerHTML = `
      <p>${resultLines.join("<br>")}</p>
      <a href="${url}" download="${canExportAnimation ? "animated" : "compressed"}-${state.metadata.fileName}">
        ${downloadLabel}
      </a>
    `;

    dom.progressFill.style.width = "100%";
    dom.progressValue.textContent = "100%";
    log(
      canExportAnimation
        ? "压缩完成，已生成完整 WebP 动画文件。"
        : "压缩完成，已生成压缩 WebP 文件。"
    );
  } catch (error) {
    dom.progressBox.classList.add("hidden");
    dom.progressFill.style.width = "0%";
    dom.progressValue.textContent = "0%";
    log(error.message || "压缩失败");
    alert(error.message || "压缩失败，请稍后再试。");
  }
}

function toggleTheme() {
  const willBeDark = !dom.body.classList.contains("dark");
  applyTheme(willBeDark);
}

function applyTheme(isDark) {
  dom.body.classList.toggle("dark", isDark);
  const icon = dom.themeToggle.querySelector("i");
  if (icon) {
    icon.classList.remove("ri-moon-line", "ri-sun-line");
    icon.classList.add(isDark ? "ri-sun-line" : "ri-moon-line");
  }
}

function bindEvents() {
  dom.filePicker?.addEventListener("click", () => dom.fileInput?.click());

  dom.fileInput?.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (file) handleFile(file);
    event.target.value = "";
  });

  if (dom.dropzone) {
    ["dragenter", "dragover"].forEach((type) => {
      dom.dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        dom.dropzone.classList.add("dragover");
      });
    });

    ["dragleave", "dragend"].forEach((type) => {
      dom.dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dom.dropzone.classList.remove("dragover");
      });
    });

    dom.dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dom.dropzone.classList.remove("dragover");
      const file = event.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });
  }

  dom.clearButton?.addEventListener("click", () => resetState());

  dom.togglePlay?.addEventListener("click", () => {
    if (state.frames.length <= 1) return;
    state.isPlaying = !state.isPlaying;
    dom.togglePlay.textContent = state.isPlaying ? "暂停" : "播放";
    if (state.isPlaying) {
      scheduleNextFrame();
    } else {
      resetPlaybackTimer();
    }
  });

  dom.prevFrame?.addEventListener("click", () => {
    if (state.frames.length <= 1) return;
    resetPlaybackTimer();
    state.isPlaying = false;
    dom.togglePlay.textContent = "播放";
    state.frameIndex =
      (state.frameIndex - 1 + state.frames.length) % state.frames.length;
    drawFrame(state.frameIndex);
  });

  dom.nextFrame?.addEventListener("click", () => {
    if (state.frames.length <= 1) return;
    resetPlaybackTimer();
    state.isPlaying = false;
    dom.togglePlay.textContent = "播放";
    state.frameIndex = (state.frameIndex + 1) % state.frames.length;
    drawFrame(state.frameIndex);
  });

  dom.frameSlider?.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) {
      resetPlaybackTimer();
      state.isPlaying = false;
      dom.togglePlay.textContent = "播放";
      state.frameIndex = value;
      drawFrame(state.frameIndex);
    }
  });

  dom.playbackSpeedButtons?.forEach((button) =>
    button.addEventListener("click", () => {
      dom.playbackSpeedButtons.forEach((btn) =>
        btn.classList.toggle("chip--active", btn === button)
      );
      const speed = Number(button.dataset.speed);
      if (Number.isFinite(speed)) {
        setPlaybackRate(speed);
      }
    })
  );

  dom.fpsSlider?.addEventListener("input", (event) => {
    const value = Math.max(1, Number(event.target.value));
    state.settings.fps = value;
    if (dom.fpsLabel) dom.fpsLabel.textContent = `${value} fps`;
    updateEstimate();
  });

  dom.qualitySlider?.addEventListener("input", (event) => {
    const value = Math.max(1, Number(event.target.value));
    state.settings.quality = value;
    if (dom.qualityLabel) dom.qualityLabel.textContent = String(value);
    updateEstimate();
  });

  dom.compressButton?.addEventListener("click", compressWebp);
  dom.themeToggle?.addEventListener("click", toggleTheme);
}

function runInitialChecks() {
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    applyTheme(true);
  } else {
    applyTheme(false);
  }

  log(
    typeof ImageDecoder === "undefined"
      ? "当前浏览器不支持 ImageDecoder，将使用退化模式。"
      : "环境检查通过，可解析多帧 WebP 动画。"
  );
  log(
    supportsWebpEncoding()
      ? "检测到浏览器支持 WebP 静态编码，可离线压缩。"
      : "浏览器未检测到 WebP 静态编码支持，导出时可能失败。"
  );

  supportsAnimatedWebpEncoding().then((animatedSupport) => {
    log(
      animatedSupport
        ? "浏览器原生支持动画 WebP 编码，可与 WASM 编码器共同使用。"
        : "浏览器原生动画 WebP 编码不可用，将改用 WASM 编码器处理动画。"
    );
  });

  ensureWasmWebpCodec()
    .then(() => {
      log("WASM WebP 编码器加载完成，可离线压缩动画。");
    })
    .catch((error) => {
      log(`WASM WebP 编码器加载失败：${error.message}`);
    });
}

function init() {
  initDom();
  bindEvents();
  runInitialChecks();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
