import { execFileSync } from "node:child_process";
import { BACKEND } from "./helpers";

// A fresh stack with the demo story seeded (scripts\demo-reset.ps1), so every run starts the same.
export default function globalSetup() {
  if (process.env.SEHATLOG_E2E_RESET === "0") return;
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", `${BACKEND}scripts\\demo-reset.ps1`], { stdio: "inherit" });
}
