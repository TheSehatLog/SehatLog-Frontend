import { AppShell } from "@/components/AppShell";
import { SehatProvider } from "@/lib/store";

// The clickable prototype: simulated server, real in-browser encryption.
export default function PrototypeLayout({ children }: { children: React.ReactNode }) {
  return (
    <SehatProvider>
      <AppShell>{children}</AppShell>
    </SehatProvider>
  );
}
