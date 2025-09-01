import "../index.css";
import ChatWidget from "@/components/ChatWidget";

export const metadata = {
  title: "Blueridge AI Agency",
  icons: {
    icon: "/Bluerigde Logo sm.png",
    shortcut: "/Bluerigde Logo sm.png",
    apple: "/Bluerigde Logo sm.png",
  },
};

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
