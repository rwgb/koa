variable "proxmox_url" {
  description = "Proxmox API endpoint URL"
  type        = string
  default     = "https://192.168.1.161:8006/api2/json"
}

variable "proxmox_username" {
  description = "Proxmox login in PAM format (e.g. root@pam)"
  type        = string
  default     = "root@pam"
}

variable "proxmox_password" {
  description = "Proxmox password (store in terraform.tfvars, never commit)"
  type        = string
  sensitive   = true
}

variable "proxmox_node" {
  description = "Proxmox node name"
  type        = string
  default     = "skull"
}

variable "koa_ip" {
  description = "Static IPv4 address for the Koa LXC container"
  type        = string
  default     = "192.168.1.200"
}

variable "ollama_ip" {
  description = "Static IPv4 address for the Ollama VM"
  type        = string
  default     = "192.168.1.201"
}

variable "gateway" {
  description = "Default gateway for both resources"
  type        = string
  default     = "192.168.1.1"
}

variable "bridge" {
  description = "Proxmox Linux bridge for both resources"
  type        = string
  default     = "vmbr0"
}

variable "tailscale_authkey" {
  description = "Tailscale one-time auth key (tskey-auth-...); generate at tailscale.com/admin/settings/keys"
  type        = string
  sensitive   = true
}

variable "ssh_public_key" {
  description = "SSH public key injected into root on both LXC and VM (e.g. contents of ~/.ssh/id_ed25519.pub)"
  type        = string
}

variable "ollama_template_vm_id" {
  description = "VMID of the Packer-built Ollama template to clone from"
  type        = number
  default     = 9001
}
