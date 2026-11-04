import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Bản Android (mode android, android-qa) luôn chỉ có chức năng người dân; mode android-officer là app dành riêng cho cán bộ CSKV
// (đủ chức năng cổng nghiệp vụ như bản web). Website giữ cả hai cổng trừ khi đặt VITE_AUDIENCE=citizen.
// Dùng `define` để bundler loại hẳn mã cán bộ (hằng số xuyên module không được gấp).
export default defineConfig(({ mode }) => ({
  define: {
    __CITIZEN_ONLY__: JSON.stringify((mode.startsWith('android') && mode !== 'android-officer') || loadEnv(mode, process.cwd(), 'VITE_').VITE_AUDIENCE === 'citizen'),
    __OFFICER_APP__: JSON.stringify(mode === 'android-officer'),
  },
  build: { outDir: mode.startsWith('android') ? 'dist-android' : 'dist' },
  plugins: [react()],
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
}));
