import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['bin/lark-copilot-bridge.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  // 把依赖打包进产物会导致 @larksuiteoapi/node-sdk 里的原生逻辑出问题，保持外部引用
  noExternal: [],
});
