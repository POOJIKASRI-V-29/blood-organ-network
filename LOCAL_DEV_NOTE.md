# Note on the local development database

This project was built and verified against a **throwaway MySQL instance** created
just for development, because the MySQL server already installed on this machine
had a root password that was not available.

That instance runs on **port 3307** with its own data directory and socket
under `.devdb/` inside this folder. It is completely separate from your existing
MySQL on port 3306, which was never touched.

## Starting and stopping it

```bash
cd backend
./scripts/devdb-server.sh start     # start it (needed after a reboot)
./scripts/devdb-server.sh status    # check it
./scripts/devdb-server.sh stop      # shut it down cleanly
```

The instance does **not** start automatically at login, so run `start` before
`npm start` if you have rebooted.

## To run the project against your own MySQL

1. Edit `backend/.env` and set your real connection details:

   ```ini
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_actual_password
   ```

2. Rebuild the database:

   ```bash
   cd backend
   npm run db:setup
   ```

That is the only change needed — nothing in the code depends on port 3307.

## Cleaning up the development instance

The `.devdb/` directory is a MySQL data directory of roughly 100 MB. It is listed
in `.gitignore` and is safe to delete once you are running against your own server:

```bash
# stop the development instance first
pkill -f "port=3307"
rm -rf .devdb
```

The socket file lives at `.devdb/mysql.sock` and is disposable. (While the
project sat in the session's scratch directory a socket under `/tmp` was
required, because MySQL rejects socket paths longer than 103 characters and that
path was longer than that. From `~/blood-organ-network` the path is short enough
for the socket to live inside the project.)
