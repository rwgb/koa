terraform {
  required_version = ">= 1.7.0"
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "~> 0.66"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

provider "proxmox" {
  endpoint = var.proxmox_url
  username = var.proxmox_username
  password = var.proxmox_password
  insecure = true # homelab: self-signed TLS cert on PVE web UI
}
