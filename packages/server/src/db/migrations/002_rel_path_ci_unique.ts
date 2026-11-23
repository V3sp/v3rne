export const REL_PATH_CI_UNIQUE_SQL = `
CREATE UNIQUE INDEX idx_projects_rel_path_lower ON projects (lower(rel_path));
`;
