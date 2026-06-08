# ── Debian 12 LXC template (for Koa container) ───────────────────────────────
resource "proxmox_download_file" "debian12_lxc" {
  content_type = "vztmpl"
  datastore_id = "local"
  node_name    = var.proxmox_node
  url          = "http://download.proxmox.com/images/system/debian-12-standard_12.12-1_amd64.tar.zst"
  overwrite    = false
}
