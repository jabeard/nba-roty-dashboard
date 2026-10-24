import { Dashboard } from "@/components/dashboard";
import { rookieProvider } from "@/lib/data";

export default async function Home() {
  const snapshot = await rookieProvider.getSnapshot();
  return <Dashboard snapshot={snapshot} />;
}
