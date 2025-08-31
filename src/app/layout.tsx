import "../index.css";
import ChatWidget from "@/components/ChatWidget";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ChatWidget />
      </body>
    </html>
  );
}
