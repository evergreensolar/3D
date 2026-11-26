import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { templates } from "@/lib/notify/templates";
import { logEvent } from "@/lib/projects";
import { addressCustomer } from "@/lib/notify/address";

export interface CommentDTO {
  id: string;
  n: number; // pin number
  body: string;
  anchor: { point: [number, number, number] } | null;
  author: string;
  fromCustomer: boolean;
  createdAt: string;
  resolvedAt: string | null;
  replies: { id: string; body: string; author: string; fromCustomer: boolean; createdAt: string }[];
}

export async function commentThreads(versionId: string, customerLabel: string): Promise<CommentDTO[]> {
  const rows = await db.comment.findMany({
    where: { versionId, parentId: null },
    orderBy: { createdAt: "asc" },
    include: { authorUser: { select: { name: true } }, replies: { orderBy: { createdAt: "asc" }, include: { authorUser: { select: { name: true } } } } },
  });
  return rows.map((c, i) => ({
    id: c.id, n: i + 1, body: c.body, anchor: (c.anchor as CommentDTO["anchor"]) ?? null,
    author: c.authorType === "CUSTOMER" ? customerLabel : c.authorUser?.name ?? "Evergreen Solar",
    fromCustomer: c.authorType === "CUSTOMER", createdAt: c.createdAt.toISOString(), resolvedAt: c.resolvedAt?.toISOString() ?? null,
    replies: c.replies.map((r) => ({
      id: r.id, body: r.body, author: r.authorType === "CUSTOMER" ? customerLabel : r.authorUser?.name ?? "Evergreen Solar",
      fromCustomer: r.authorType === "CUSTOMER", createdAt: r.createdAt.toISOString(),
    })),
  }));
}

export interface NewComment {
  body: string;
  anchor?: { point: [number, number, number] } | null;
  parentId?: string | null;
}

/** Saves a customer or team comment and notifies the other side. */
export async function addComment(o: { projectId: string; versionId: string; by: { customer: true } | { userId: string }; c: NewComment }) {
  const project = await db.project.findUniqueOrThrow({ where: { id: o.projectId }, include: { designer: true } });
  if (o.c.parentId) {
    const parent = await db.comment.findFirst({ where: { id: o.c.parentId, versionId: o.versionId, parentId: null } });
    if (!parent) throw new Error("Comment not found");
  }
  const fromCustomer = "customer" in o.by;
  const created = await db.comment.create({
    data: {
      projectId: o.projectId, versionId: o.versionId, parentId: o.c.parentId ?? null,
      authorType: fromCustomer ? "CUSTOMER" : "TEAM", authorUserId: fromCustomer ? null : (o.by as { userId: string }).userId,
      body: o.c.body.trim().slice(0, 4000),
      anchor: o.c.parentId || !o.c.anchor ? undefined : (o.c.anchor as Prisma.InputJsonValue),
    },
  });
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  if (fromCustomer) {
    if (["UPLOADED", "SENT_TO_CUSTOMER", "REVISED"].includes(project.status)) await db.project.update({ where: { id: project.id }, data: { status: "COMMENTS_PENDING" } });
    await logEvent(project.id, "comment.customer", "customer", { reply: !!o.c.parentId });
    if (project.designer?.email) {
      await dispatch({
        projectId: project.id, template: "comment_team", channels: ["EMAIL"], to: { email: project.designer.email },
        rendered: { subject: `New customer comment — ${project.code}`, text: `${addressCustomer(project)} commented on ${project.code}:\n\n"${created.body}"\n\nReply: ${appUrl}/team/projects/${project.id}`, params: [] },
      });
    }
  } else {
    await logEvent(project.id, "comment.team", `user:${(o.by as { userId: string }).userId}`, { reply: !!o.c.parentId });
    await dispatch({
      projectId: project.id, template: "comment_reply", channels: ["WHATSAPP", "SMS"], to: { mobile: project.customerMobile },
      rendered: templates.commentReply(project, { projectCode: project.code, link: `${appUrl}/p/${project.shareToken}` }),
    });
  }
  return created;
}
