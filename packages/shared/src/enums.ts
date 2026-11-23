import { z } from "zod";

export const StatusSchema = z.enum([
  "backlog",
  "ready",
  "in_progress",
  "needs_input",
  "done",
  "cancelled",
]);
export type Status = z.infer<typeof StatusSchema>;

export const PrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const CommentKindSchema = z.enum(["comment", "doubt", "progress", "decision"]);
export type CommentKind = z.infer<typeof CommentKindSchema>;

export const AuthorTypeSchema = z.enum(["human", "agent"]);
export type AuthorType = z.infer<typeof AuthorTypeSchema>;