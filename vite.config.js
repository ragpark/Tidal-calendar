import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  preview: {
    port: process.env.PORT || 3000
  },
  build: {
    modulePreload: false,
    // Optimize build for Railway's memory constraints
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    },
    // Use esbuild minification (faster and lower memory)
    minify: 'esbuild',
    target: 'es2015'
  }
})
