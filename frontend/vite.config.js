import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,

    // --- Dev proxy ----------------------------------------------------------
    // In development, any request to /api/* gets forwarded to the Express
    // server running on port 5000. This means axios.get('/api/transactions')
    // just works without any CORS configuration during local development.
    //
    // In production, the frontend is deployed on Vercel and sets
    // VITE_API_BASE_URL to point at the Render backend URL directly -
    // the proxy config below is only active during `vite dev`.
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
