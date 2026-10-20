#!/usr/bin/env bash
# Thin wrapper around the mysql client for the project-local development server.
# Usage:  ./devdb.sh [mysql args...]        e.g.  ./devdb.sh blood_organ_network -e "SHOW TABLES;"
#         ./devdb.sh < file.sql
: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=3307}"
: "${DB_USER:=root}"
exec mysql --protocol=TCP -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" ${DB_PASSWORD:+-p"$DB_PASSWORD"} "$@"
