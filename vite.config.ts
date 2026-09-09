import { defineConfig } from 'vite';

export default defineConfig({
  // Served from https://ved1211.github.io/portfolio/, not a domain root.
  base: '/portfolio/',
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
