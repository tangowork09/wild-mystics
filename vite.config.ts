import { defineConfig } from 'vite';

export default defineConfig({
  // relative URLs: works from any sub-path (GitHub Pages) and inside the Capacitor shells
  base: './',
  server: { port: 5180, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
