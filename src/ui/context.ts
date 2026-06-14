import { createContext, useContext } from "react";
import type { CardRepository } from "../obsidian/repo";

export const RepoContext = createContext<CardRepository | null>(null);

export function useRepo(): CardRepository {
  const repo = useContext(RepoContext);
  if (!repo) throw new Error("RepoContext is missing a provider");
  return repo;
}
