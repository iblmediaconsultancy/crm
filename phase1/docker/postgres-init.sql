CREATE ROLE ibl_v2_migration LOGIN PASSWORD 'ibl_v2_migration_local' BYPASSRLS;
CREATE ROLE ibl_v2_app LOGIN PASSWORD 'ibl_v2_app_local' NOBYPASSRLS;
CREATE DATABASE ibl_command_center_v2 OWNER ibl_v2_migration;
GRANT CONNECT ON DATABASE ibl_command_center_v2 TO ibl_v2_app;
