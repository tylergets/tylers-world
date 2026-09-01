import { defineConfig } from 'vite';

export default defineConfig({
  base: '/tylers-world/',
  server: { port: 5173, open: false },
  build: { target: 'es2022', outDir: 'dist' },
});
