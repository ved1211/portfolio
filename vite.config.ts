import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Served from https://ved1211.github.io/portfolio/, not a domain root.
  base: '/portfolio/',
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    rollupOptions: {
      // Every page is its own entry. Case studies live under /projects/.
      input: {
        main: resolve(__dirname, 'index.html'),
        deliveryFlow: resolve(__dirname, 'projects/delivery-flow/index.html'),
      },
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
