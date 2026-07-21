import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        includeAssets: ['manifest.json'],
        manifest: false,
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // Assets do jogo Escape (Mundo Perdido) somam ~130MB — ficam fora
          // do precache do service worker e carregam sob demanda.
          globIgnores: ['escape-assets/**'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.PIXABAY_API_KEY': JSON.stringify(env.PIXABAY_API_KEY),
    },
    build: {
      rollupOptions: {
        output: {
          // Separa vendors estáveis do código do app: mudanças no App.tsx não
          // invalidam mais o cache de firebase/react/ícones no navegador, e o
          // download inicial acontece em paralelo.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return;
            if (id.includes('firebase') || id.includes('@grpc') || id.includes('protobuf')) return 'vendor-firebase';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('@google/genai')) return 'vendor-genai';
            if (/node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//.test(id)) return 'vendor-motion';
            if (/node_modules\/(react-markdown|remark|rehype|micromark|mdast|unist|hast|unified|vfile|bail|trough|zwitch|comma-separated|space-separated|property-information|devlop|estree|character-entities|decode-named|trim-lines|html-url-attributes)/.test(id)) return 'vendor-markdown';
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
