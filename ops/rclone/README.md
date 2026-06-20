# Rclone backup sync

Put a production `rclone.conf` in this directory before enabling the optional backup profile:

```bash
mkdir -p ops/rclone
rclone config file
rclone config
```

Set `RCLONE_REMOTE` in `.env` to the destination path, for example `club-backups:escola-xadrez/backups`, then run:

```bash
docker compose --profile backup up -d backup-sync
```

This service syncs the generated database backup files from the Docker `uploads` volume path `/data/backups` to the configured remote.
