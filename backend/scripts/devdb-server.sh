#!/usr/bin/env bash
#
# Start / stop / check the project-local MySQL instance used for development.
#
# This is a throwaway server on port 3307 with its own data directory at
# <project>/.devdb.  It exists only because the MySQL already installed on this
# machine is password-protected.  It does not touch your MySQL on port 3306.
#
#   ./devdb-server.sh start     start it (no-op if already running)
#   ./devdb-server.sh stop      shut it down cleanly
#   ./devdb-server.sh status    is it up?
#   ./devdb-server.sh logs      tail the error log
#
# To use your own MySQL instead, edit backend/.env (DB_PORT / DB_USER /
# DB_PASSWORD) and run `npm run db:setup`.  Then this script is not needed.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_HOME="$PROJECT_ROOT/.devdb"
PORT=3307

is_running() {
  mysqladmin --protocol=TCP -h 127.0.0.1 -P "$PORT" -u root ping >/dev/null 2>&1
}

case "${1:-status}" in
  start)
    if is_running; then
      echo "MySQL is already running on port $PORT"
      exit 0
    fi
    if [ ! -d "$DATA_HOME/data" ]; then
      echo "No data directory at $DATA_HOME/data — initialising a new one."
      mkdir -p "$DATA_HOME"
      mysqld --initialize-insecure --datadir="$DATA_HOME/data" \
             --log-error="$DATA_HOME/init.log"
    fi

    nohup mysqld \
      --datadir="$DATA_HOME/data" \
      --port="$PORT" \
      --socket="$DATA_HOME/mysql.sock" \
      --pid-file="$DATA_HOME/mysql.pid" \
      --log-error="$DATA_HOME/error.log" \
      --bind-address=127.0.0.1 \
      --mysqlx=OFF \
      > "$DATA_HOME/stdout.log" 2>&1 &

    printf "Starting MySQL on port %s " "$PORT"
    for _ in $(seq 1 30); do
      if is_running; then echo " ready."; exit 0; fi
      printf "."
      sleep 1
    done
    echo " failed. Last lines of the error log:"
    tail -20 "$DATA_HOME/error.log"
    exit 1
    ;;

  stop)
    if ! is_running; then echo "MySQL is not running on port $PORT"; exit 0; fi
    mysqladmin --protocol=TCP -h 127.0.0.1 -P "$PORT" -u root shutdown
    echo "Stopped."
    ;;

  status)
    if is_running; then
      echo "MySQL is running on port $PORT"
      mysql --protocol=TCP -h 127.0.0.1 -P "$PORT" -u root \
        -e "SELECT @@version AS version, @@datadir AS datadir;" 2>/dev/null
    else
      echo "MySQL is NOT running on port $PORT — start it with: $0 start"
      exit 1
    fi
    ;;

  logs)
    tail -f "$DATA_HOME/error.log"
    ;;

  *)
    echo "Usage: $0 {start|stop|status|logs}" >&2
    exit 1
    ;;
esac
