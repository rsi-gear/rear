import type { Metadata } from "next";
import { RearDashboard } from "./rear-dashboard";

export const metadata: Metadata = {
  title: "REAR — Runtime Experience Analysis & Replay",
  description: "Harbor benchmark runs, runtime analysis, and trajectory replay.",
};

export default function Home() {
  return <RearDashboard />;
}
