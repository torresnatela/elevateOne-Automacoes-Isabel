import { redirect } from "next/navigation";
import { chatService } from "@/server/container";
import { getCurrentUser } from "@/server/lib/current-user";
import { ChatView } from "@/views/components/ChatView";

export const metadata = { title: "Chat | ElevateOne" };

export default async function ChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const conversations = await chatService.list(user.id);
  return (
    <ChatView initialConversations={conversations.map((c) => ({ id: c.id, title: c.title }))} />
  );
}
