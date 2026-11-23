import { fetchProjects } from "../api/projects";
import type { ProjectWithGit } from "../api/types";
import { useAsyncData } from "./useAsyncData";

export function useConfigProjects() {
  return useAsyncData<ProjectWithGit[]>(fetchProjects);
}
