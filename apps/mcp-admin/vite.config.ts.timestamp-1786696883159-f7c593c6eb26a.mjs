// vite.config.ts
import { defineConfig } from "file:///Users/geekwen/workspace/web_system/node_modules/.pnpm/vite@5.4.21_@types+node@22.19.15_less@4.5.1_sass@1.98.0_terser@5.49.0/node_modules/vite/dist/node/index.js";
import vue from "file:///Users/geekwen/workspace/web_system/node_modules/.pnpm/@vitejs+plugin-vue@5.2.4_vite@5.4.21_@types+node@22.19.15_less@4.5.1_sass@1.98.0_terser@5.49._ocep7fyqvminavqjj6sqdeceau/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import { resolve } from "path";
var __vite_injected_original_dirname = "/Users/geekwen/workspace/web_system/apps/mcp-admin";
var vite_config_default = defineConfig({
  base: "/mcp-admin/",
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__vite_injected_original_dirname, "src")
    }
  },
  server: {
    port: 5175,
    host: "0.0.0.0",
    proxy: {
      // 本地开发直连 mcp-gateway（生产走 gateway 的 /api/mcp 代理转发）
      "/api/mcp": {
        target: "http://localhost:6006",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/mcp/, "/api")
      }
    }
  },
  build: {
    outDir: "dist",
    sourcemap: false
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvZ2Vla3dlbi93b3Jrc3BhY2Uvd2ViX3N5c3RlbS9hcHBzL21jcC1hZG1pblwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL2dlZWt3ZW4vd29ya3NwYWNlL3dlYl9zeXN0ZW0vYXBwcy9tY3AtYWRtaW4vdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL2dlZWt3ZW4vd29ya3NwYWNlL3dlYl9zeXN0ZW0vYXBwcy9tY3AtYWRtaW4vdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCB2dWUgZnJvbSAnQHZpdGVqcy9wbHVnaW4tdnVlJztcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgYmFzZTogJy9tY3AtYWRtaW4vJyxcbiAgcGx1Z2luczogW3Z1ZSgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHJlc29sdmUoX19kaXJuYW1lLCAnc3JjJyksXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3NSxcbiAgICBob3N0OiAnMC4wLjAuMCcsXG4gICAgcHJveHk6IHtcbiAgICAgIC8vIFx1NjcyQ1x1NTczMFx1NUYwMFx1NTNEMVx1NzZGNFx1OEZERSBtY3AtZ2F0ZXdheVx1RkYwOFx1NzUxRlx1NEVBN1x1OEQ3MCBnYXRld2F5IFx1NzY4NCAvYXBpL21jcCBcdTRFRTNcdTc0MDZcdThGNkNcdTUzRDFcdUZGMDlcbiAgICAgICcvYXBpL21jcCc6IHtcbiAgICAgICAgdGFyZ2V0OiAnaHR0cDovL2xvY2FsaG9zdDo2MDA2JyxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICByZXdyaXRlOiAocGF0aCkgPT4gcGF0aC5yZXBsYWNlKC9eXFwvYXBpXFwvbWNwLywgJy9hcGknKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICBvdXREaXI6ICdkaXN0JyxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXdVLFNBQVMsb0JBQW9CO0FBQ3JXLE9BQU8sU0FBUztBQUNoQixTQUFTLGVBQWU7QUFGeEIsSUFBTSxtQ0FBbUM7QUFJekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsTUFBTTtBQUFBLEVBQ04sU0FBUyxDQUFDLElBQUksQ0FBQztBQUFBLEVBQ2YsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxRQUFRLGtDQUFXLEtBQUs7QUFBQSxJQUMvQjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQTtBQUFBLE1BRUwsWUFBWTtBQUFBLFFBQ1YsUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLFFBQ2QsU0FBUyxDQUFDLFNBQVMsS0FBSyxRQUFRLGVBQWUsTUFBTTtBQUFBLE1BQ3ZEO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUNSLFdBQVc7QUFBQSxFQUNiO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
