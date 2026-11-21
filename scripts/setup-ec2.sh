#!/usr/bin/env bash
set -euo pipefail

# ShopNest EC2 Provisioning Script (Ubuntu 24.04 LTS)
# Run once on a fresh EC2 instance: bash setup-ec2.sh

echo "==> [1/6] Updating packages and installing prerequisites..."
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates gnupg nginx jq tar postgresql-client

echo "==> [2/6] Configuring 1GB swap space (safe memory buffer for micro instances)..."
if ! swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 1G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=1024
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi
fi

echo "==> [3/6] Installing Node.js (v20+) and PM2..."
if ! command -v node >/dev/null 2>&1; then
  if curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -; then
    sudo apt-get install -y nodejs
  else
    echo "NodeSource unavailable for this Ubuntu release; installing Ubuntu repository nodejs + npm..."
    sudo apt-get install -y nodejs npm
  fi
fi
if ! command -v npm >/dev/null 2>&1; then
  sudo apt-get install -y npm
fi
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

echo "==> [4/6] Creating ShopNest release, log, and Nginx slot directories..."
sudo mkdir -p \
  /var/www/shopnest/prod/releases \
  /var/www/shopnest/prod/logs \
  /var/www/shopnest/staging/releases \
  /var/www/shopnest/staging/logs \
  /var/www/shopnest/nginx \
  /var/www/shopnest/placeholder

cat <<'EOF' | sudo tee /var/www/shopnest/placeholder/index.html >/dev/null
<!doctype html>
<html><head><title>ShopNest</title></head>
<body style="font-family:sans-serif;text-align:center;padding:3rem;">
<h1>ShopNest</h1><p>Awaiting first automated CI/CD deployment...</p>
</body></html>
EOF

for env_name in prod staging; do
  slot_file="/var/www/shopnest/nginx/${env_name}-slot.inc"
  if [ ! -f "$slot_file" ]; then
    cat <<'EOF' | sudo tee "$slot_file" >/dev/null
root /var/www/shopnest/placeholder;
index index.html;
EOF
  fi
done

sudo chown -R "$USER:$USER" /var/www/shopnest

echo "==> [5/6] Configuring Nginx reverse proxy for Production (:80) and Staging (:8080)..."
cat <<'EOF' | sudo tee /etc/nginx/sites-available/shopnest-prod >/dev/null
server {
    listen 80 default_server;
    server_name _;

    include /var/www/shopnest/nginx/prod-slot.inc;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

cat <<'EOF' | sudo tee /etc/nginx/sites-available/shopnest-staging >/dev/null
server {
    listen 8080 default_server;
    server_name _;

    include /var/www/shopnest/nginx/staging-slot.inc;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sfn /etc/nginx/sites-available/shopnest-prod /etc/nginx/sites-enabled/shopnest-prod
sudo ln -sfn /etc/nginx/sites-available/shopnest-staging /etc/nginx/sites-enabled/shopnest-staging

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

echo "==> [6/6] Granting least-privilege Nginx reload permission and enabling PM2 startup..."
cat <<EOF | sudo tee /etc/sudoers.d/shopnest-nginx >/dev/null
${USER} ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t, /usr/sbin/nginx -s reload
EOF
sudo chmod 440 /etc/sudoers.d/shopnest-nginx

pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1 | grep -E '^sudo ' | bash || true

echo "==> ShopNest EC2 provisioning complete!"
echo "Node: $(node -v) | npm: $(npm -v) | PM2: $(pm2 -v) | Nginx: $(nginx -v 2>&1)"
