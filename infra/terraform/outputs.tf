output "koa_vmid" {
  description = "Koa LXC container VMID"
  value       = proxmox_virtual_environment_container.koa.vm_id
}

output "koa_ip" {
  description = "Koa LXC container IP address"
  value       = var.koa_ip
}

output "ollama_vmid" {
  description = "Ollama VM ID"
  value       = proxmox_virtual_environment_vm.ollama.vm_id
}

output "ollama_ip" {
  description = "Ollama VM IP address"
  value       = var.ollama_ip
}

output "ssh_alias" {
  description = "Add to ~/.zshrc to use koa TUI from your Mac over SSH"
  value       = "alias koa='ssh -t root@${var.koa_ip} koa'"
}

output "next_steps" {
  description = "Post-apply checklist"
  value       = <<-EOT
    1. Verify Ollama VM is up:   ssh root@${var.ollama_ip} "ollama list"
    2. Deploy the app:           KOA_HOST=root@${var.koa_ip} ./scripts/deploy.sh
    3. Pull a model (optional):  ssh root@${var.ollama_ip} "ollama pull llama3.2:3b"
    4. Set KOA_PROVIDER=ollama and KOA_WEB_TOKEN in /etc/koa/env on the LXC, then restart: ssh root@${var.koa_ip} "systemctl restart koa"
    5. Add the SSH alias:        alias koa='ssh -t root@${var.koa_ip} koa'
  EOT
}
