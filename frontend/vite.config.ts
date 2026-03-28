import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env variables seamlessly from both the parent root folder and local folder
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const localEnv = loadEnv(mode, __dirname, '');
  const finalEnv = { ...rootEnv, ...localEnv };
  
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    // Map the root MAPS_API_KEY seamlessly to the frontend
    // process.env takes precedence so Docker --build-arg injects the key during Cloud Build
    define: {
      'import.meta.env.VITE_MAPS_API_KEY': JSON.stringify(
        process.env.VITE_MAPS_API_KEY ||
        process.env.MAPS_API_KEY ||
        finalEnv.VITE_MAPS_API_KEY ||
        finalEnv.MAPS_API_KEY ||
        ""
      )
    },
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  };
});
