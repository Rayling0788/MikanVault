# MikanVault MCP Server · Agent Quick Reference

This directory implements the standalone **MikanVault Model Context Protocol (MCP)** stdio server (`mikanvault-mcp.cjs`), enabling AI Agents to search Mikan Project, manage qBittorrent downloads and RSS auto-subscriptions, inspect/scrape the local+cloud anime library, and safely upload or cancel Google Drive transfers.

## Key Properties for AI Agents
- **Transport**: JSON-RPC 2.0 over `stdin` / `stdout` (`2025-03-26` & `2024-11-05`). Diagnostics go to `stderr` only.
- **Shared State Directory**: Reads and writes `%APPDATA%\mikan-vault` (overridable via `MIKANVAULT_DATA_DIR`), synced automatically with the desktop Electron UI.
- **Safe Cloud Upload Semantics**:
  - Uses standard OS file copy (`fs.promises.copyFile`) + post-copy byte-size verification (`dest.size === src.size`).
  - `cloud_upload_library` requires explicit `deleteLocal: boolean` and **never deletes local source files** if copy/verification fails or if cancelled via `cloud_cancel_job`.
  - Automatically migrates scraped covers, ratings, Mikan IDs, and episode watched states to the cloud library folder.

## Typical Agent Call Sequences

### A. Find & Download Anime
1. `mikan_search({ query: "..." })` -> pick `bangumiId`.
2. `mikan_get_bangumi_detail({ bangumiId, expandEpisodes: true })` -> inspect subgroups & episodes.
3. `qb_status()` -> if disconnected, call `qb_launch()`.
4. `qb_add_download({ items: [...], offloadToGoogleDrive: true, deleteLocalAfterCloudMove: true })`.

### B. Offload Local Library Anime to Google Drive
1. `library_scan({ onlyLocal: true })` & `cloud_status()`.
2. Confirm with user whether `deleteLocal` should be `true` or `false`.
3. `cloud_upload_library({ seriesId, deleteLocal, background: false })` (or `background: true` + monitor `cloud_status` / cancel via `cloud_cancel_job`).

## Tools Summary (16)
- **Search / Library**: `mikan_search`, `mikan_get_schedule`, `mikan_get_bangumi_detail`, `library_scan`, `library_scrape`
- **Downloads / Subscriptions**: `qb_status`, `qb_launch`, `qb_add_download`, `qb_control_torrent`, `subscription_list`, `subscription_upsert`, `subscription_check_now`
- **Google Drive Cloud**: `cloud_status`, `cloud_upload_library`, `cloud_cancel_job`, `cloud_process_now`

## Resources Summary (6)
- `mikanvault://guide`
- `mikanvault://settings` (`qbPassword` redacted)
- `mikanvault://library`
- `mikanvault://torrents`
- `mikanvault://cloud-jobs`
- `mikanvault://subscriptions`

## Prompts Summary (2)
- `find_and_download_anime` (`query`, `to_cloud`)
- `offload_local_library_to_cloud` (`title`, `delete_local`)
