This directory must contain the WASM WebP encoder assets.

The recommended source is GoogleChromeLabs' `@squoosh/lib`, which bundles the official libwebp encoder compiled to WebAssembly.

Download **both** of the following files and place them in this folder:
  • `webp_enc.wasm`  – the WebAssembly binary
  • `webp_enc.mjs`   – the ES module glue code（保持文件名不变）

### Option A · npm (requires network access)
1. `npm install @squoosh/lib@latest`
2. `cp node_modules/@squoosh/lib/build/webp_enc.wasm libs/webp/`
3. `cp node_modules/@squoosh/lib/build/webp_enc.mjs libs/webp/`

### Option B · 直接下载发布文件
从官方 CDN 获取最新构建并保存到此目录：
  - https://unpkg.com/@squoosh/lib@latest/build/webp_enc.wasm
  - https://unpkg.com/@squoosh/lib@latest/build/webp_enc.mjs

完成复制后刷新页面，控制台将显示：
  "WASM WebP 编码器加载完成，可离线压缩动画。"
