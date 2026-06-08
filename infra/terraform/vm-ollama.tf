# ── VM 201: Ollama LLM server ─────────────────────────────────────────────────
# Cloned from a Packer-built template (VMID var.ollama_template_vm_id).
# All software is pre-installed in the template; Terraform only sets the IP,
# SSH key, and hostname. No cloud-init scripts, no null_resource.
resource "proxmox_virtual_environment_vm" "ollama" {
  node_name   = var.proxmox_node
  vm_id       = 201
  name        = "ollama"
  description = "Ollama LLM server — CPU-only inference (cloned from Packer template)"
  started     = true

  clone {
    vm_id = var.ollama_template_vm_id
    full  = true
  }

  agent {
    enabled = true
  }

  cpu {
    cores = 8
    type  = "host"
  }

  memory {
    dedicated = 16384
  }

  # Expand the root disk from the template size to 60 GB
  disk {
    datastore_id = "local-lvm"
    interface    = "scsi0"
    size         = 60
  }

  network_device {
    bridge = var.bridge
    model  = "virtio"
  }

  initialization {
    ip_config {
      ipv4 {
        address = "${var.ollama_ip}/24"
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
