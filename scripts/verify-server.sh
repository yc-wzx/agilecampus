#!/usr/bin/env bash
# Read deployment state; optionally verify a fresh backup in an independent database.
set -euo pipefail
mode="${1:-status}"
case "$mode" in status|backup-drill) ;; *) exit 2 ;; esac
cd /opt/agilecampus
node=/opt/agilecampus-runtime/node/bin/node
export APP_IMAGE="$("$node" -p 'JSON.parse(require("fs").readFileSync(".release.json","utf8")).image')"
export MIGRATE_IMAGE="$("$node" -p 'JSON.parse(require("fs").readFileSync(".release.json","utf8")).migrationImage')"
compose=(docker compose --project-name agilecampus --file docker-compose.prod.yml)
if "$node" -e 'const fs=require("fs"),{parseEnv}=require("util");process.exit(parseEnv(fs.readFileSync(".env","utf8")).SMALL_SERVER==="true"?0:1)'; then
  compose+=(--file docker-compose.2gb.yml)
fi
"$node" scripts/ops.mjs status
"${compose[@]}" --profile https ps
for service in db app reminders edge; do
  id="$("${compose[@]}" --profile https ps -q "$service")"
  test -n "$id"
  docker inspect --format '{{.Name}} state={{.State.Status}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}' "$id"
done
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'
free -m
df -h /opt
"${compose[@]}" exec -T db psql -U agilecampus -d agilecampus -At -c "select 'migrations',count(*) from drizzle.__drizzle_migrations union all select 'users',count(*) from users union all select 'projects',count(*) from projects union all select 'tasks',count(*) from tasks" </dev/null
"${compose[@]}" logs --tail 25 edge reminders
if test "$mode" = backup-drill; then
  dump="$("$node" scripts/ops.mjs backup)"
  [[ "$dump" == /opt/agilecampus/backups/agilecampus-*.dump ]]
  "$node" scripts/ops.mjs restore-drill "$dump"
  restored="$("$node" -e 'const fs=require("fs");console.log(JSON.parse(fs.readFileSync(process.argv[1]+".restore.json","utf8")).database)' "$dump")"
  [[ "$restored" =~ ^agilecampus_restore_[0-9]+$ ]]
  # Delete only the independent database just created by this verification.
  "${compose[@]}" exec -T db dropdb -U agilecampus "$restored" </dev/null
  printf 'Backup and independent restore verified; production retained.\n'
fi
