import { createLogger, defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Vite's line for every edit ("hmr update /src/...", "page reload ...") is
// left out of the dev terminal, where BeePEE's own log goes too. Everything
// else (errors, warnings, the server address) still shows.
const logger = createLogger()
const logInfo = logger.info
logger.info = (message, options) => {
    if (/hmr update|hmr invalidate|page reload/.test(message)) return
    logInfo(message, options)
}

// https://vite.dev/config/
export default defineConfig(({ command }) => {
    const isServe = command === "serve"

    // Logs the requests for Vite's client files, to debug them loading:
    // set BEEPEE_DEBUG_VITE=1 to turn it on
    const debugEnvPlugin = isServe && process.env.BEEPEE_DEBUG_VITE
        ? {
              name: "beepee-debug-env-requests",
              configureServer(server) {
                  server.middlewares.use((req, res, next) => {
                      if (
                          req.url?.includes("env.mjs") ||
                          req.url?.includes("@vite/env") ||
                          req.url?.includes("client.mjs") ||
                          req.url?.includes("@vite/client")
                      ) {
                          console.log(`[vite] dev asset request: ${req.method} ${req.url}`)
                      }
                      next()
                  })
              },
          }
        : null

    return {
        customLogger: logger,
        plugins: [react(), ...(debugEnvPlugin ? [debugEnvPlugin] : [])],
        // Use absolute paths during dev so Vite's client assets load via HTTP,
        // but switch to relative paths for the packaged file:// protocol.
        base: isServe ? "/" : "./",
        server: {
            watch: {
                // Ignore packages folder to prevent file locks on Windows
                // This folder contains extracted BEE2 packages and is managed by Electron
                ignored: ["**/packages/**", "**/node_modules/**"],
            },
        },
    }
})
