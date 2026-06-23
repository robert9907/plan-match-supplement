import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  build: {
    // Lock the Vite default explicitly. Supplement handles PHI (MBI, DOB,
    // 12-question health screen, prescriber NPIs); shipping .map files
    // would expose the rating math, MBI regex, and health-screen scoring.
    sourcemap: false,
  },
});
