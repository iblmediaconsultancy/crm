export const publicTablesQuery = `
SELECT c.relname AS tablename
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'f')
ORDER BY c.relname
`;

export const publicColumnsQuery = `
SELECT
  c.relname AS table_name,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'f')
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.atttypid <> 0
ORDER BY c.relname, a.attnum
`;
