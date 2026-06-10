packer {
  required_plugins {
    proxmox = {
      version = ">= 1.2.0"
      source  = "github.com/hashicorp/proxmox"
    }
  }
}

# ── Variables ─────────────────────────────────────────────────────────────────

variable "proxmox_url" {
  type    = string
  default = "https://192.168.1.161:8006/api2/json"
}

variable "proxmox_username" {
  type    = string
  default = "root@pam"
}

variable "proxmox_password" {
  type      = string
  sensitive = true
}

variable "proxmox_node" {
  type    = string
  default = "skull"
}

variable "clone_vm_id" {
  type        = number
  default     = 100
  description = "VMID of the existing Debian 13 template to clone from"
}

variable "template_vm_id" {
  type        = number
  default     = 9001
  description = "VMID for the resulting Ollama template"
}

variable "ssh_public_key" {
  type        = string
  description = "SSH public key injected into root during build"
}

# ── Source ────────────────────────────────────────────────────────────────────

source "proxmox-clone" "ollama" {
  proxmox_url              = var.proxmox_url
  username                 = var.proxmox_username
  password                 = var.proxmox_password
  insecure_skip_tls_verify = true
  node                     = var.proxmox_node

  clone_vm_id = var.clone_vm_id
  vm_id       = var.template_vm_id
  vm_name     = "ollama-template"

  cpu_type = "host"
  cores    = 4
  memory   = 8192

  network_adapters {
    bridge = "vmbr0"
    model  = "virtio"
  }

  communicator     = "ssh"
  ssh_username     = "debian"
  ssh_password     = "debian"
  ssh_wait_timeout = "5m"
  task_timeout     = "10m"

  template_name        = "ollama-debian13"
  template_description = "Debian 13 + Ollama — built by Packer on ${formatdate("YYYY-MM-DD", timestamp())}"
}

# ── Build ─────────────────────────────────────────────────────────────────────

build {
  sources = ["source.proxmox-clone.ollama"]

  # All provisioners run via sudo since we connect as 'debian'
  # Install Ollama (CPU-only — skull has no usable GPU)
  provisioner "shell" {
    execute_command = "echo 'debian' | sudo -S bash -c '{{.Vars}} {{.Path}}'"
    inline = [
      "set -euo pipefail",
      "apt-get update -qq",
      "apt-get install -y --no-install-recommends ufw curl ca-certificates",
      "curl -fsSL https://ollama.com/install.sh | sh",
      "systemctl enable ollama",
      "systemctl start ollama",
      "sleep 5",
      "ollama pull qwen2.5:7b || true",
    ]
  }

  # Inject SSH key into root, disable password auth
  provisioner "shell" {
    execute_command = "echo 'debian' | sudo -S bash -c '{{.Vars}} {{.Path}}'"
    inline = [
      "mkdir -p /root/.ssh",
      "chmod 700 /root/.ssh",
      "echo '${var.ssh_public_key}' > /root/.ssh/authorized_keys",
      "chmod 600 /root/.ssh/authorized_keys",
      "sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config",
      "sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config",
    ]
  }

  # Firewall: SSH + Ollama port from LAN only
  provisioner "shell" {
    execute_command = "echo 'debian' | sudo -S bash -c '{{.Vars}} {{.Path}}'"
    inline = [
      "ufw --force reset",
      "ufw default deny incoming",
      "ufw default allow outgoing",
      "ufw allow from 192.168.1.0/24 to any port 22 proto tcp",
      "ufw allow from 192.168.1.0/24 to any port 11434 proto tcp",
      "ufw --force enable",
    ]
  }

  # Reset machine-id so each clone gets a unique identity
  provisioner "shell" {
    execute_command = "echo 'debian' | sudo -S bash -c '{{.Vars}} {{.Path}}'"
    inline = [
      "apt-get clean",
      "rm -rf /var/lib/apt/lists/*",
      "truncate -s 0 /etc/machine-id",
      "rm -f /var/lib/dbus/machine-id",
      "ln -sf /etc/machine-id /var/lib/dbus/machine-id",
    ]
  }
}
