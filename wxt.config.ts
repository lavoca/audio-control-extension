import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    permissions: ['storage'],
    host_permissions: ["127.0.0.1"],
    minimum_chrome_version: "116",
  },
  
});
