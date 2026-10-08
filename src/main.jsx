// First, so the logs of every module below reach the log file
import "./utils/logForwarding.js"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@mui/material/styles"
import { CssBaseline } from "@mui/material"
import App from "./App.jsx"
import { theme } from "./theme.js"
import "./index.css"

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline /> {/* Resets CSS and applies theme background */}
            <App />
        </ThemeProvider>
    </StrictMode>,
)
