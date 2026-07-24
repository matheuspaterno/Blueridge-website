import type { Metadata } from "next";
import VoiceSimulatorClient from "./VoiceSimulatorClient";

export const metadata: Metadata = {
  title: "Rick Voice Agent Simulator",
  robots: { index: false, follow: false },
};

export default function VoiceSimulatorPage() {
  return <VoiceSimulatorClient />;
}
