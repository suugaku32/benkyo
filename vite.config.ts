import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Estampille le HTML pour qu'une capture d'écran suffise à savoir quelle version
// est réellement servie. Sans ça, impossible de distinguer « le correctif ne
// marche pas » de « le navigateur sert encore l'ancienne page ».
const BUILD_STAMP = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

function buildStamp() {
  return {
    name: 'build-stamp',
    transformIndexHtml(html: string) {
      return html.replace(/__BUILD__/g, BUILD_STAMP);
    },
  };
}

export default defineConfig({
  base: './',
  // Vite 8 vise par défaut safari16.4 / ios16.4. Un iPhone resté sur une version
  // antérieure ne sait alors pas analyser le bundle : erreur de syntaxe, rien ne
  // s'exécute, page blanche. On descend la cible pour couvrir les iOS plus anciens.
  build: {
    target: ['es2020', 'safari14', 'ios14', 'chrome87', 'firefox78', 'edge88'],
  },
  plugins: [react(), buildStamp()],
})
