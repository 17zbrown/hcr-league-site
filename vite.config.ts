import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 4173,
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        // The heavy vendor libraries change on dependency bumps, not on every site
        // edit — splitting them out keeps the main chunk under Vite's 500 kB warning
        // and lets a returning visitor reuse the cached vendor chunks after a deploy
        // that only touched app code. React itself deliberately stays in the main
        // chunk: splitting it invites load-order pitfalls for no cache win, since
        // almost every app edit ships with the main chunk anyway.
        manualChunks: {
          'vendor-motion': ['framer-motion'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
})
