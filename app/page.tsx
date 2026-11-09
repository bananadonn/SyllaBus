import { googleConfigured } from "@/auth";
import SyllabusApp from "./components/SyllabusApp";

export default function Home() {
  return <SyllabusApp googleEnabled={googleConfigured} />;
}
