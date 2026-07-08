import type { Client } from "@langchain/langgraph-sdk";

export function createThreadListAdapter(
  client: Client,
  userId: string,
) {
  return {
    async list() {
      if (!userId) return { threads: [] };

      const threads = await client.threads.search({
        metadata: { owner_user_id: userId },
        limit: 50,
        sortBy: "created_at",
        sortOrder: "desc",
      });

      return {
        threads: threads.map((t) => ({
          status: "regular" as const,
          remoteId: t.thread_id,
          externalId: t.thread_id,
          title: undefined,
          lastMessageAt: t.updated_at
            ? new Date(t.updated_at)
            : undefined,
        })),
      };
    },

    async initialize(_threadId: string) {
      const { thread_id } = await client.threads.create({
        metadata: { owner_user_id: userId },
      });
      return { remoteId: thread_id, externalId: thread_id };
    },

    async rename() {},
    async archive() {},
    async unarchive() {},

    async delete(remoteId: string) {
      await client.threads.delete(remoteId);
    },

    async generateTitle(): Promise<ReadableStream> {
      return new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
    },

    async fetch(threadId: string) {
      const thread = await client.threads.get(threadId);
      return {
        status: "regular" as const,
        remoteId: thread.thread_id,
        externalId: thread.thread_id,
        lastMessageAt: thread.updated_at
          ? new Date(thread.updated_at)
          : undefined,
      };
    },
  };
}
