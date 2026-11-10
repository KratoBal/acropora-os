import type { ContentChannel } from "@acropora/types";

/**
 * WHAT A MACHINE AGENT SEES OF ITS OWN SUBMISSIONS (card c5a8e6d6: the machine entry point was one-way, an agent could write
 * and could not read the answer back). Pure functions, so the words it may and may not carry can fail by name.
 *
 * ONLY THE AUTHOR'S OWN ITEMS (the service checks; another author's item is "not found", not "forbidden": its existence is not
 * the caller's to learn). WHAT IS IN: the item's text and state, the approval history (who moved it where and when, with the note
 * of a send-back or a discard), and the discussion on it with who wrote each comment. WHAT IS NOT: user identifiers (a name,
 * never an id), the reviewer's and the approver's assignments, the channel's external post data and anything the agent did
 * not write or is not meant to answer.
 */
export interface AgentItemSummary {
  id: string;
  title: string;
  channel: ContentChannel;
  state: string;
  updatedAt: string;
}

export interface AgentItemSource {
  id: string;
  title: string;
  channel: ContentChannel;
  state: string;
  updatedAt: Date;
}

export function agentItemSummary(item: AgentItemSource): AgentItemSummary {
  return {
    id: item.id,
    title: item.title,
    channel: item.channel,
    state: item.state,
    updatedAt: item.updatedAt.toISOString(),
  };
}

export interface AgentHistoryEntry {
  fromState: string | null;
  toState: string;
  /** a name, never an identifier; `null` for a move the system made */
  actorName: string | null;
  /** the send-back's note or the discard's reason, when there is one */
  note: string | null;
  createdAt: string;
}

export interface AgentCommentEntry {
  authorName: string | null;
  body: string;
  createdAt: string;
  /** true when the agent itself wrote it (a machine revision leaves a trace comment under the agent's name) */
  mine: boolean;
}

export interface AgentItemView extends AgentItemSummary {
  body: string | null;
  imageRequired: boolean;
  imageAttached: boolean;
  plannedFor: string | null;
  history: AgentHistoryEntry[];
  comments: AgentCommentEntry[];
}

export interface AgentItemDetailSource {
  id: string;
  title: string;
  channel: ContentChannel;
  state: string;
  updatedAt: Date;
  body: string | null;
  imageRequired: boolean;
  imageAttachedAt: Date | null;
  plannedFor: Date | null;
  history: {
    fromState: string | null;
    toState: string;
    actorName: string | null;
    note: string | null;
    createdAt: string;
  }[];
  comments: {
    authorId: string | null;
    body: string;
    createdAt: Date;
  }[];
}

export function agentItemView(
  item: AgentItemDetailSource,
  agentId: string,
  commentAuthorNames: ReadonlyMap<string, string>,
): AgentItemView {
  return {
    ...agentItemSummary(item),
    body: item.body,
    imageRequired: item.imageRequired,
    imageAttached: item.imageAttachedAt !== null,
    plannedFor: item.plannedFor ? item.plannedFor.toISOString() : null,
    history: item.history.map((event) => ({
      fromState: event.fromState,
      toState: event.toState,
      actorName: event.actorName,
      note: event.note,
      createdAt: event.createdAt,
    })),
    comments: item.comments.map((comment) => ({
      authorName: comment.authorId
        ? (commentAuthorNames.get(comment.authorId) ?? null)
        : null,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      mine: comment.authorId === agentId,
    })),
  };
}
