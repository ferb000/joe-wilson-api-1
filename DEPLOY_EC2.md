# Deploy the API and frontend to AWS EC2

This guide deploys the API and both frontend apps on one Ubuntu EC2 server. PostgreSQL and Redis run in Docker on a private Docker network. Uploaded media and HLS output are stored in a private S3 bucket. PM2 keeps the API, transcoding worker, email worker, and static frontend preview servers running. Nginx provides public HTTPS.

Run all application setup and deployment commands as the EC2 default `ubuntu` user. Do not switch to a root shell and do not run `git`, `npm`, or `pm2` with `sudo`. Use `sudo` only for operating-system packages, Docker group setup, Nginx, certificates, and other system files. This keeps the GitHub deploy keys, project files, and PM2 processes owned by `ubuntu`.

## Recommended EC2 size

- **Minimum for a small test:** 2 vCPU and 4 GiB RAM. Expect slow builds and run only one video transcode at a time.
- **Recommended for this project:** 4 vCPU and 8 GiB RAM, with at least 40 GiB gp3 storage. FFmpeg temporarily downloads each original and builds HLS output on local disk; the configured limits allow a 5 GiB source and up to 10 GiB output per job, plus operating-system and build space.
- For production traffic or frequent/large videos, use a separate larger worker instance and monitor memory, free disk, CPU, and S3 costs. Transcoding is CPU and disk intensive.

Ubuntu 24.04 LTS, x86_64, works with the included Docker image and its FFmpeg binary. Use the EC2 instance's **IAM instance profile** for S3 access; don't create long-lived AWS keys for the server.

## 1. Create the EC2 instance and network access

In AWS EC2, launch Ubuntu Server 24.04 LTS. Create or choose a key pair and save its `.pem` file privately. In the instance security group, allow:

| Port | Source                      | Purpose                                   |
| ---- | --------------------------- | ----------------------------------------- |
| 22   | Your current public IP only | SSH administration                        |
| 80   | `0.0.0.0/0` and `::/0`      | HTTP and HTTPS certificate setup/redirect |
| 443  | `0.0.0.0/0` and `::/0`      | Website and API HTTPS                     |

Do not allow public inbound access to PostgreSQL `5432` or Redis `6379`; Docker will keep both internal. Allocate and associate an Elastic IP if you use a domain, then create DNS records for the public site and API pointing to that address. The examples below use `example.com`, `www.example.com`, `api.example.com`, and `admin.example.com`; replace them with your domain names. You can use one domain with paths if you already have an Nginx layout, but separate subdomains are easier to follow.

## 2. Install Docker, Git, Node.js, PM2, and Nginx

SSH into the instance as `ubuntu` (the default for an Ubuntu EC2 AMI), then run these commands. Docker's official Ubuntu repository is used so Docker Compose v2 is installed as a plugin.

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
```

Log out and SSH back in as `ubuntu` so the Docker group change takes effect. Verify Docker without `sudo`:

```bash
docker --version
docker compose version
```

Install Node.js 22 LTS, then PM2 globally. Node 22 can build the frontend's Vite version and run this Node 20+ API. `sudo npm` is used only for this global system install; run later project npm commands as `ubuntu` without `sudo`.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install --global pm2
node --version
npm --version
pm2 --version
```

## 3. Create a restricted S3 bucket and EC2 role

1. Create a private S3 bucket in the AWS region near the EC2 server. Keep **Block all public access** enabled. The API uses private signed requests and protected playback; the bucket itself should not be public.
2. In IAM, create a policy that grants the app only the required actions on that bucket. Replace `YOUR_BUCKET` and `YOUR_REGION` below and attach this policy to an IAM role trusted by EC2:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
    }
  ]
}
```

3. Attach the role as an **instance profile** to EC2. The AWS SDK in this project automatically gets credentials from the instance profile when `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are empty.
4. If browsers upload directly to S3 using signed URLs, configure the bucket CORS to allow your website/admin origins and the methods/headers used by the app (`PUT`, `GET`, `HEAD`, `OPTIONS`; `Content-Type`, `Authorization`, and range headers). CORS does not make the bucket public.

For public website images, choose a delivery URL separately and set `S3_PUBLIC_BASE_URL` to it. Ensure it serves only the bucket's `public/` prefix. Private resources and `transcoded/` video files must remain private.

## 4. Create GitHub deploy keys

Create a separate read-only SSH deploy key for each private repository. Run as `ubuntu`:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keygen -t ed25519 -C "ec2-joe-wilson-api-deploy" -f ~/.ssh/joe-wilson-api -N ""
ssh-keygen -t ed25519 -C "ec2-joe-wilson-frontend-deploy" -f ~/.ssh/joe-wilson-frontend -N ""
```

Display and copy each `.pub` value into the matching GitHub repository's **Settings → Deploy keys → Add deploy key**. Leave **Allow write access** unchecked.

```bash
cat ~/.ssh/joe-wilson-api.pub
cat ~/.ssh/joe-wilson-frontend.pub
```

Configure SSH to select the correct key. Replace `YOUR_GITHUB_ORG` and repository names:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-joe-api
  HostName github.com
  User git
  IdentityFile ~/.ssh/joe-wilson-api
  IdentitiesOnly yes

Host github-joe-frontend
  HostName github.com
  User git
  IdentityFile ~/.ssh/joe-wilson-frontend
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config ~/.ssh/joe-wilson-api ~/.ssh/joe-wilson-frontend
ssh-keyscan github.com >> ~/.ssh/known_hosts
chmod 600 ~/.ssh/known_hosts
```

Clone both repos (replace the org and repo names with the actual GitHub paths):

```bash
sudo mkdir -p /var/www
sudo chown ubuntu:ubuntu /var/www
git clone git@github-joe-api:YOUR_GITHUB_ORG/joe-wilson-api.git /var/www/joe-wilson-api
git clone git@github-joe-frontend:YOUR_GITHUB_ORG/joe-wilson-portfolio-main.git /var/www/joe-wilson-portfolio-main
```

The deploy key only grants read access to its repository. To update later, run `git pull` in each checkout and follow the update steps below.

## 5. Configure the API environment

Create the API `.env` file. Run the random secret generator twice and use the two different outputs in the file. Choose strong unique database and Redis passwords and URL-encode special characters if you include them in a URL.

```bash
cd /var/www/joe-wilson-api
openssl rand -hex 48
openssl rand -hex 48
openssl rand -base64 32
openssl rand -base64 32
```

Create `.env` with `nano .env` and paste the template. Replace every `CHANGE_ME` value and all example hostnames/addresses:

```dotenv
NODE_ENV=production
PORT=3001

# Keep the DB private on the Docker network. URL-encode the password if needed.
POSTGRES_USER=mrwilson
POSTGRES_PASSWORD=CHANGE_ME_LONG_RANDOM_DATABASE_PASSWORD
POSTGRES_DB=mrwilson
DATABASE_URL=postgresql://mrwilson:CHANGE_ME_LONG_RANDOM_DATABASE_PASSWORD@127.0.0.1:5432/mrwilson?schema=public

# Use a separate strong password from the database password.
REDIS_PASSWORD=CHANGE_ME_DIFFERENT_LONG_RANDOM_REDIS_PASSWORD
REDIS_URL=redis://:CHANGE_ME_DIFFERENT_LONG_RANDOM_REDIS_PASSWORD@127.0.0.1:6379
REDIS_ENABLED=true

# Generate two different values with: openssl rand -hex 48
JWT_SECRET=CHANGE_ME_FIRST_RANDOM_SECRET
JWT_REFRESH_SECRET=CHANGE_ME_SECOND_DIFFERENT_RANDOM_SECRET
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

# Public HTTPS origins; no trailing slash. Checkout return URLs use this list.
FRONTEND_URLS=https://example.com,https://www.example.com,https://admin.example.com
# Direct browser calls from the static sites use CORS; local Vite proxy doesn't need localhost here.
CORS_ORIGINS=https://example.com,https://www.example.com,https://admin.example.com
API_PUBLIC_URL=https://api.example.com
DOCS_TOKEN=CHANGE_ME_LONG_RANDOM_DOCS_PASSWORD

# S3 uses the EC2 instance profile. Keep the bucket private.
S3_BUCKET=CHANGE_ME_YOUR_PRIVATE_BUCKET_NAME
S3_REGION=us-east-1
S3_ENDPOINT=
S3_PUBLIC_BASE_URL=https://CHANGE_ME_PUBLIC_IMAGE_CDN_OR_BASE_URL
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
STORAGE_DRIVER=s3
S3_MAX_UPLOAD_BYTES=5368709120

# Email: leave RESEND_API_KEY empty to disable password reset email in production.
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@example.com
ADMIN_EMAIL=you@example.com

# Stripe test keys for test mode; leave empty if not testing checkout yet.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# FFmpeg is in the Docker image. The video worker needs this same env file.
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
VIDEO_MAX_DURATION_SECONDS=14400
VIDEO_MAX_OUTPUT_BYTES=10737418240
VIDEO_TRANSCODE_TIMEOUT_SECONDS=21600
VIDEO_TRANSCODE_THREADS=2
VIDEO_TRANSCODE_ATTEMPTS=3
VIDEO_PLAYBACK_TTL_SECONDS=3600
```

Set a real `S3_PUBLIC_BASE_URL` if the admin/public site needs public image previews; otherwise leave it empty until public image delivery is configured. Set `DOCS_TOKEN` to a unique random value. API docs stay hidden in production when it is empty; with a value set, use HTTP Basic user `docs` and that value as its password. Keep Stripe keys in test mode while testing. Email reset requests return an error until you configure a verified Resend sender and `RESEND_API_KEY`.

Protect the file:

```bash
chmod 600 .env
```

The API Dockerfile does not copy `.env` into the image; PM2 loads it on the EC2 host. Never commit it.

## 6. Start PostgreSQL and Redis in Docker

The checked-in `docker-compose.yml` exposes neither service publicly. They share a private Compose network, use persistent Docker volumes, have health checks, and read passwords from `.env`.

```bash
cd /var/www/joe-wilson-api
docker compose up -d db redis
docker compose ps
```

Wait until both show `healthy`. PostgreSQL/Redis bind to loopback for host-run API/PM2 processes. Confirm EC2 security group inbound rules still do not allow ports 5432 or 6379.

## 7. Install and build the API

```bash
cd /var/www/joe-wilson-api
docker build -t joe-wilson-api:latest .
npm ci
npx prisma generate
npm run db:deploy
npm run build
```

The Docker image includes FFmpeg and ffprobe. The host build is used by PM2, so the video worker can read its FFmpeg binary from the host. On Ubuntu, install FFmpeg if the host doesn't already provide it:

```bash
sudo apt install -y ffmpeg
ffmpeg -encoders | grep libx264
```

The output should include `libx264`. The Dockerfile is also built here to validate it and provide a ready production image, but this PM2 guide runs the API and workers on the host so PM2 can manage each process. `start.sh` runs Prisma migrations and starts the server if you run the API container directly; do not run both container startup migrations and host `npm run db:deploy` concurrently.

## 8. Build the frontend

The frontend has two apps, the public client and admin dashboard. They are served as separate Vite Preview processes by PM2 and Nginx. The client uses the root path; admin is built for `/admin/`.

```bash
cd /var/www/joe-wilson-portfolio-main
npm ci
VITE_API_BASE_URL=https://api.example.com BASE_PATH=/ npm run build:client
VITE_API_BASE_URL=https://api.example.com BASE_PATH=/admin/ npm run build:admin
```

Check that output folders exist:

```bash
test -f apps/client/out/index.html && test -f apps/admin/out/index.html && echo "Both frontend builds are ready"
```

## 9. Start API, FFmpeg, email, and frontend with PM2

The checked-in `ecosystem.config.cjs` expects these API and frontend directories:

- `/var/www/joe-wilson-api`
- `/var/www/joe-wilson-portfolio-main`

If you chose different paths, edit `cwd` values in that file. Start the services:

```bash
cd /var/www/joe-wilson-api
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs --lines 100
```

The API, video worker, email worker, public UI, and admin UI will run as separate PM2 processes. The transcoder polls the database for queued media and writes private HLS output into S3. It uses local temporary disk while processing. Do not run the PM2 API or workers inside the API Docker container; Docker here is for PostgreSQL and Redis.

Save PM2 startup across server reboots:

```bash
pm2 save
pm2 startup
```

PM2 prints a `sudo env PATH=... pm2 startup ...` command. Copy and run the exact command it prints, then run `pm2 save` again.

## 10. Configure Nginx and HTTPS

Create `/etc/nginx/sites-available/joe-wilson` with `sudo nano /etc/nginx/sites-available/joe-wilson` and paste this. Replace the domains:

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    location / { proxy_pass http://127.0.0.1:4173; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }
}
server {
    listen 80;
    server_name admin.example.com;
    location / { proxy_pass http://127.0.0.1:4174; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }
}
server {
    listen 80;
    server_name api.example.com;
    client_max_body_size 100m;
    location / { proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }
}
```

Enable and validate it:

```bash
sudo ln -s /etc/nginx/sites-available/joe-wilson /etc/nginx/sites-enabled/joe-wilson
sudo nginx -t
sudo systemctl reload nginx
```

Install a Let's Encrypt certificate after DNS resolves to the EC2 Elastic IP:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com -d admin.example.com -d api.example.com
```

Certbot adjusts Nginx to serve HTTPS and renews certificates automatically. Confirm ports 80 and 443 are open in the EC2 security group.

## 11. Verify deployment

```bash
curl -i https://api.example.com/health
curl -i https://api.example.com/ready
pm2 status
docker compose ps
```

Open `https://example.com`, `https://admin.example.com`, and `https://api.example.com/health`. The `/ready` endpoint should return ready when PostgreSQL and Redis are reachable. Use `pm2 logs mr-wilson-api`, `pm2 logs mr-wilson-video-worker`, or `pm2 logs mr-wilson-email-worker` if needed. The public API docs are at `/docs` only when `DOCS_TOKEN` is set.

After the deployment works, create the production owner account from the API checkout using the project's owner creation script and credentials you enter interactively or securely in the shell environment. Do not seed demo users into production.

## 12. Deploy updates from GitHub

After pushing changes to GitHub, update the server:

```bash
cd /var/www/joe-wilson-api && git pull --ff-only
cd /var/www/joe-wilson-portfolio-main && git pull --ff-only
cd /var/www/joe-wilson-api && npm ci && npx prisma generate && npm run db:deploy && npm run build
cd /var/www/joe-wilson-portfolio-main && npm ci && VITE_API_BASE_URL=https://api.example.com BASE_PATH=/ npm run build:client && VITE_API_BASE_URL=https://api.example.com BASE_PATH=/admin/ npm run build:admin
cd /var/www/joe-wilson-api && pm2 reload ecosystem.config.cjs --update-env && pm2 save
```

Back up PostgreSQL before schema changes and test migrations before applying them to production. Database data is stored in Docker's `postgres_data` volume. S3 holds uploaded files; losing the EC2 instance does not remove S3 objects. Keep independent database backups in S3 or another account/region.

## Important notes

- Keep only SSH, HTTP, and HTTPS open to the internet. PostgreSQL/Redis ports must never be in the EC2 security group's inbound rules.
- This one-instance layout has a single point of failure. Use RDS/ElastiCache or another managed setup for a production service that needs high availability and easier recovery.
- FFmpeg uses CPU, memory, and temporary local disk. The worker handles one job at a time; do not run multiple copies on a small instance.
- EC2, EBS, S3, data transfer, domain, and email services can incur charges. A free tier is not guaranteed for every AWS account or region.
