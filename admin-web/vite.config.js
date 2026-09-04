import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000', // 转发到Node后端
      '/uploads': 'http://127.0.0.1:3000' // 用户头像静态文件
    }
  }
});
