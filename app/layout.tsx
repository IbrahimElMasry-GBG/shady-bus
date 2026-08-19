import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bus Sun-Side Advisor",
  description:
    "Work out which side of a bus stays in the shade for a given route, date and departure time.",
};

// No webfont is loaded on purpose: the UI uses the system sans stack, which
// removes a build-time network fetch and a render-blocking request.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
