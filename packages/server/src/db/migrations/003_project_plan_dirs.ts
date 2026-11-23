export const PROJECT_PLAN_DIRS_SQL = `
ALTER TABLE projects ADD COLUMN plan_dirs_json TEXT;
`;
