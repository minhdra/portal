import { ItemsView } from "@/components/ItemsView";

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItemsView topicId={id} />;
}
