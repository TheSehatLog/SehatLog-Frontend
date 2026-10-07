import { LiveSession } from "@/components/live/LiveSession";

// The live app: talks to the real Go API; all clinical crypto happens in the browser.
export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return <LiveSession>{children}</LiveSession>;
}
