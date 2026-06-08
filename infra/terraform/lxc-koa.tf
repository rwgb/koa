# ── LXC 200: Koa AI assistant ─────────────────────────────────────────────────
resource "proxmox_virtual_environment_container" "koa" {
  node_name   = var.proxmox_node
  vm_id       = 200
  description = "Koa AI assistant — Node.js + Caddy"
  started     = true

  cpu {
    cores = 2
  }

  memory {
    dedicated = 2048
  }

  disk {
    datastore_id = "local-lvm"
    size         = 16
  }

  network_interface {
    name   = "eth0"
    bridge = var.bridge
  }

  operating_system {
    template_file_id = proxmox_download_file.debian12_lxc.id
    type             = "debian"
  }

  initialization {
    hostname = "koa"

    ip_config {
      ipv4 {
        address = "${var.koa_ip}/24"
        gateway = var.gateway
      }
    }

    user_account {
      keys = [var.ssh_public_key]
    }

    dns {
      servers = ["1.1.1.1", "8.8.8.8"]
    }
  }
}

# ── Bootstrap: install runtime, deploy service, connect Tailscale ─────────────
# Standard Proxmox LXC templates do not run cloud-init; remote-exec fills the gap.
# SSH agent forwarding is used — run `ssh-add` before `terraform apply`.
resource "null_resource" "koa_bootstrap" {
  depends_on = [proxmox_virtual_environment_container.koa]

  triggers = {
    container_id = proxmox_virtual_environment_container.koa.id
  }

  connection {
    type    = "ssh"
    host    = var.koa_ip
    user    = "root"
    agent   = true
    timeout = "5m"
  }

  provisioner "file" {
    source      = "${path.module}/../../deploy/bootstrap.sh"
    destination = "/tmp/bootstrap.sh"
  }

  provisioner "file" {
    source      = "${path.module}/../../deploy/koa.service"
    destination = "/tmp/koa.service"
  }

  provisioner "remote-exec" {
    inline = [
      "apt-get update -qq",
      "apt-get install -y -qq curl",
      "chmod +x /tmp/bootstrap.sh",
      "/tmp/bootstrap.sh",
      # Override the Ollama URL placeholder set by bootstrap.sh
      "grep -q KOA_OLLAMA_BASE_URL /etc/koa/env || echo 'KOA_OLLAMA_BASE_URL=http://${var.ollama_ip}:11434' >> /etc/koa/env",
      "sed -i 's|KOA_OLLAMA_BASE_URL=.*|KOA_OLLAMA_BASE_URL=http://${var.ollama_ip}:11434|' /etc/koa/env",
      # Install Tailscale
      "curl -fsSL https://tailscale.com/install.sh | sh",
      "tailscale up --authkey=${var.tailscale_authkey} --hostname=koa --accept-routes",
    ]
  }
}
